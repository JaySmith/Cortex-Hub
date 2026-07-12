import http from "node:http";
import { execSync } from "node:child_process";

function req(body, sessionId) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const r = http.request({ hostname: "localhost", port: 4096, path: "/mcp", method: "POST", headers }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ body: t, headers: res.headers }));
    });
    if (data) r.write(data);
    r.end();
  });
}

function parseSSE(text) {
  return text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch {} }).filter(Boolean);
}

async function callTool(name, args, sessionId) {
  const res = await req({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }, sessionId);
  for (const msg of parseSSE(res.body)) {
    if (msg.result) {
      const text = JSON.parse(msg.result.content[0].text);
      return text;
    }
  }
  return null;
}

function detectTool(name, versionFlag) {
  try {
    const out = execSync(`${name} ${versionFlag}`, { encoding: "utf8", timeout: 5000 }).trim();
    return { name, version: out.split("\n")[0].trim() };
  } catch {
    return null;
  }
}

function detectCapabilities() {
  const checks = [
    { name: "python", flag: "--version" },
    { name: "python3", flag: "--version" },
    { name: "node", flag: "--version" },
    { name: "npm", flag: "--version" },
    { name: "git", flag: "--version" },
    { name: "docker", flag: "--version" },
    { name: "go", flag: "version" },
    { name: "rustc", flag: "--version" },
    { name: "cargo", flag: "--version" },
    { name: "java", flag: "-version" },
    { name: "ollama", flag: "--version" },
    { name: "tsx", flag: "--version" },
    { name: "npx", flag: "--version" },
  ];
  return checks.map((c) => detectTool(c.name, c.flag)).filter(Boolean);
}

async function main() {
  const agentName = process.argv[2] || "compute";
  const hostname = process.argv[3] || `${agentName}.local`;
  console.log(`Starting ${agentName} startup procedure...\n`);

  const init = await req({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: `${agentName}-startup`, version: "1.0.0" } } });
  const sid = init.headers["mcp-session-id"];
  await req({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);

  console.log(`Step 1: Registering ${agentName}...`);
  const reg = await callTool("hub_agent_register", { name: agentName, hostname }, sid);
  console.log("  Registered:", reg.name, "on", reg.hostname);

  console.log("Step 2: Setting heartbeat...");
  const hb = await callTool("hub_memory_set", { key: `hive/nodes/${agentName}`, value: "online", tags: ["hive", "status"], agent: agentName }, sid);
  console.log("  Memory set:", hb.key);

  console.log("Step 3: Polling for messages...");
  const msgs = await callTool("hub_poll", { agent: agentName }, sid);
  const count = Array.isArray(msgs) ? msgs.length : 0;
  console.log("  Unread messages:", count);
  if (count > 0) console.log("  Messages:", JSON.stringify(msgs, null, 2));

  console.log("Step 4: Syncing hive context...");
  const ctx = await callTool("hub_memory_search", { query: "hive/" }, sid);
  if (Array.isArray(ctx)) {
    console.log("  Memories found:", ctx.length);
    for (const m of ctx) {
      console.log(`    ${m.key} (${m.agent}) — tags: [${m.tags.join(", ")}]`);
    }
  }

  console.log("Step 5: Detecting capabilities...");
  const caps = detectCapabilities();
  if (caps.length === 0) {
    console.log("  No common tools detected (this machine may be minimal).");
  } else {
    console.log(`  Found ${caps.length} tools:`);
    for (const c of caps) {
      console.log(`    ${c.name}: ${c.version}`);
    }
  }

  console.log("Step 6: Declaring capabilities to hub...");
  const declared = await callTool("hub_agent_set_capabilities", { agent: agentName, capabilities: JSON.stringify(caps) }, sid);
  console.log("  Declared:", declared.length, "capabilities");

  console.log("Step 7: Checking readiness against skill manifest...");
  const ready = await callTool("hub_agent_check_readiness", { agent: agentName }, sid);
  if (ready) {
    if (ready.ready) {
      console.log("  Ready!");
    } else if (ready.missing && ready.missing.length > 0) {
      console.log("  Missing required tools:");
      for (const m of ready.missing) {
        console.log(`    ${m.name}: ${m.version}`);
      }
      console.log("\n  Install missing tools and re-run startup, or set a skill manifest via hub_skill_manifest_set.");
    }
  }

  console.log("\nStartup complete.");
}

main().catch(console.error);
