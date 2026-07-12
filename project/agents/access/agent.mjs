import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { DaemonAgent, loadConfig } from "@cortex/agent-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(resolve(__dirname, "config.json"));

class AccessAgent extends DaemonAgent {
  constructor() {
    super(
      {
        agentName: config.agentName,
        hostname: config.hostname,
        checkIntervalMs: config.checkIntervalMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
      },
      { hostname: config.hubHost, port: config.hubPort },
    );
  }

  async tick(ctx) {
    await this._checkSSHKeys(ctx);
    await this._checkCerts(ctx);
    await this._writeAuditLog(ctx);
  }

  async _checkSSHKeys(ctx) {
    const results = [];
    for (const pattern of config.sshKeyPaths || []) {
      try {
        const expanded = pattern.includes("*")
          ? this._exec(`ls -1d ${pattern} 2>/dev/null || true`).stdout.trim().split("\n").filter(Boolean)
          : [pattern];

        for (const keyPath of expanded) {
          const age = this._getFileAge(keyPath);
          const expiryDays = config.keyRotationDays - age;
          const status = expiryDays <= 0 ? "expired" : expiryDays <= 7 ? "expiring" : "valid";

          results.push({
            path: keyPath,
            ageDays: age,
            expiryDays,
            status,
          });

          if (status === "expiring") {
            ctx.log.warn({ key: keyPath, daysLeft: expiryDays }, "SSH key approaching rotation");
          }
          if (status === "expired") {
            ctx.log.error({ key: keyPath }, "SSH key past rotation window");
          }
        }
      } catch (err) {
        ctx.log.warn({ pattern, error: err.message }, "Failed to check SSH keys");
      }
    }

    await this.hub.memorySet(
      "access/audit/ssh-keys",
      JSON.stringify({ checkedAt: new Date().toISOString(), keys: results }, null, 2),
      ["access", "audit", "ssh"],
    );

    const expired = results.filter((r) => r.status === "expired");
    if (expired.length > 0) {
      await this.hub.sendMessage(
        "oncall",
        `[WARNING] ${expired.length} SSH key(s) past rotation`,
        expired.map((r) => `${r.path}: ${r.ageDays} days old`).join("\n"),
      );
    }
  }

  async _checkCerts(ctx) {
    const results = [];
    for (const certDir of config.certPaths || []) {
      try {
        const certs = this._exec(`find ${certDir} -name "*.pem" -o -name "*.crt" -o -name "fullchain.pem" 2>/dev/null || true`)
          .stdout.trim().split("\n").filter(Boolean);

        for (const certPath of certs) {
          try {
            const expiryStr = this._exec(
              `openssl x509 -enddate -noout -in ${certPath} 2>/dev/null || true`,
            ).stdout.trim();
            const match = expiryStr.match(/notAfter=(.+)/);
            if (!match) continue;

            const expiryDate = new Date(match[1]);
            const daysLeft = Math.floor((expiryDate.getTime() - Date.now()) / 86400000);
            const status = daysLeft <= 0 ? "expired" : daysLeft <= config.certRenewalDays ? "expiring" : "valid";

            results.push({
              path: certPath,
              expiresAt: expiryDate.toISOString(),
              daysLeft,
              status,
            });

            if (daysLeft <= config.certRenewalDays && daysLeft > 0) {
              ctx.log.warn({ cert: certPath, daysLeft }, "Certificate approaching expiry");
            }
            if (daysLeft <= 0) {
              ctx.log.error({ cert: certPath }, "Certificate expired");
            }
          } catch {
            // skip unreadable certs
          }
        }
      } catch (err) {
        ctx.log.warn({ certDir, error: err.message }, "Failed to scan certificates");
      }
    }

    await this.hub.memorySet(
      "access/audit/certificates",
      JSON.stringify({ checkedAt: new Date().toISOString(), certs: results }, null, 2),
      ["access", "audit", "certs"],
    );

    const expired = results.filter((r) => r.status === "expired" || r.status === "expiring");
    if (expired.length > 0) {
      await this.hub.sendMessage(
        "oncall",
        `[WARNING] ${expired.length} certificate(s) expiring soon`,
        expired.map((r) => `${r.path}: ${r.daysLeft} days left`).join("\n"),
      );
    }
  }

  async _writeAuditLog(ctx) {
    const log = {
      timestamp: new Date().toISOString(),
      agent: config.agentName,
      hostname: config.hostname,
      checks: ["ssh-keys", "certificates"],
    };
    await this.hub.memorySet(
      `access/audit/${new Date().toISOString().slice(0, 10)}`,
      JSON.stringify(log, null, 2),
      ["access", "audit", "daily"],
    );
  }

  _getFileAge(filePath) {
    try {
      const out = execSync(
        `stat -c %Y ${filePath} 2>/dev/null || stat -f %m ${filePath} 2>/dev/null`,
        { encoding: "utf8", timeout: 5000 },
      ).trim();
      const mtime = parseInt(out, 10) * 1000;
      return Math.floor((Date.now() - mtime) / 86400000);
    } catch {
      return 999;
    }
  }

  _exec(cmd) {
    return execSync(cmd, { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  }
}

const agent = new AccessAgent();
agent.registerShutdownHooks();
agent.run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
