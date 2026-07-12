import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { DaemonAgent } from "@cortex/agent-sdk";
import { loadConfig } from "./lib/config.mjs";
import { runChecks } from "./lib/checks.mjs";
import { AlertManager } from "./lib/alerts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = loadConfig(resolve(__dirname, "config.json"));

class WatchdogAgent extends DaemonAgent {
  constructor() {
    super(
      {
        agentName: config.agentName,
        hostname: config.hostname,
        checkIntervalMs: config.checkIntervalMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
      },
      {
        hostname: config.hubHost,
        port: config.hubPort,
      },
    );
    this.alerts = new AlertManager(this.hub, config.agentName, config.alertRules);
    this.targets = config.targets;
  }

  async startup() {
    await super.startup();

    this.log.info("Detecting capabilities...");
    const caps = detectCapabilities();
    for (const c of caps) this.log.info({ cap: c }, "Capability detected");

    await this.hub.callTool("hub_agent_set_capabilities", {
      agent: config.agentName,
      capabilities: JSON.stringify(caps),
    });
    this.log.info(`${caps.length} capabilities declared`);

    const ready = await this.hub.callTool("hub_agent_check_readiness", {
      agent: config.agentName,
    });
    if (ready?.ready) {
      this.log.info("Readiness check passed");
    } else if (ready?.missing?.length) {
      this.log.warn({ missing: ready.missing.map((m) => m.name) }, "Missing capabilities");
    }
  }

  async tick(ctx) {
    // 1. Poll for messages
    await this._handleMessages();

    // 2. Run health checks
    const results = await runChecks(this.targets);
    for (const r of results) {
      ctx.log.info({ target: r.target, status: r.status, latency: r.latency }, "Check result");
    }

    // 3. Evaluate alert rules
    const triggered = await this.alerts.evaluate(results);
    if (triggered.length > 0) {
      await this.alerts.sendAlerts(triggered);
    }

    // 4. Write periodic report
    const allUp = results.every((r) => r.status === "up");
    await this.alerts.writeReport(results, allUp);
  }

  async _handleMessages() {
    try {
      const msgs = await this.hub.poll();
      if (!msgs || msgs.length === 0) return;

      for (const msg of msgs) {
        this.log.info({ from: msg.from, subject: msg.subject }, "Received message");
        await this._handleCommand(msg);
        await this.hub.callTool("hub_mark_read", { messageId: msg.id });
      }
    } catch (err) {
      this.log.error({ err }, "Poll failed");
    }
  }

  async _handleCommand(msg) {
    const body = msg.body || "";
    const subject = (msg.subject || "").toLowerCase();

    if (subject === "ping" || body.trim() === "ping") {
      await this.hub.sendMessage(
        msg.from,
        "pong",
        JSON.stringify({ status: "online", uptime: process.uptime() }),
      );
    }

    if (subject.startsWith("check") || body.startsWith("check")) {
      const name = body.replace(/^check\s*/i, "").trim();
      if (name) {
        const target = this.targets.find((t) => t.name === name);
        if (target) {
          const results = await runChecks([target]);
          await this.hub.sendMessage(msg.from, `check_result: ${name}`, JSON.stringify(results[0]));
        } else {
          await this.hub.sendMessage(msg.from, "check_error", `Unknown target: ${name}`);
        }
      } else {
        const results = await runChecks(this.targets);
        const summary = results.map((r) => `${r.target}: ${r.status} (${r.latency}ms)`).join("\n");
        await this.hub.sendMessage(msg.from, "check_all", summary);
      }
    }

    if (subject === "status" || body === "status") {
      const stats = await this.hub.callTool("hub_stats", {});
      await this.hub.sendMessage(msg.from, "watchdog_status", JSON.stringify(stats));
    }
  }
}

function detectCapabilities() {
  const checks = [
    { name: "node", flag: "--version" },
    { name: "curl", flag: "--version" },
    { name: "ping", flag: process.platform === "win32" ? "/?" : "-c 1 localhost" },
  ];
  return checks
    .map((c) => {
      try {
        const out = execSync(`${c.name} ${c.flag}`, { encoding: "utf8", timeout: 3000 });
        return { name: c.name, version: out.split("\n")[0].trim() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const agent = new WatchdogAgent();
agent.registerShutdownHooks();
agent.run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
