import http from "node:http";

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

async function callTool(name, args, sid) {
  const res = await req({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }, sid);
  for (const msg of parseSSE(res.body)) {
    if (msg.result) return msg.result;
  }
  return null;
}

async function main() {
  const agentName = process.argv[2] || "compute";

  const init = await req({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: `${agentName}-inbox`, version: "1.0.0" } } });
  const sid = init.headers["mcp-session-id"];
  await req({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);

  const poll = await callTool("hub_poll", { agent: agentName }, sid);
  const pollContent = JSON.parse(poll.content[0].text);
  const unread = Array.isArray(pollContent) ? pollContent : [];

  if (unread.length === 0) {
    console.log("No unread messages.");
  } else {
    console.log(`Unread messages: ${unread.length}`);
    for (const m of unread) {
      console.log(`\n  From: ${m.from}`);
      console.log(`  Subject: ${m.subject}`);
      console.log(`  Body: ${m.body}`);
      console.log(`  Time: ${m.createdAt}`);
    }
  }

  const inbox = await callTool("hub_inbox", { agent: agentName }, sid);
  const inboxContent = JSON.parse(inbox.content[0].text);
  const all = Array.isArray(inboxContent) ? inboxContent : [];
  console.log(`\nFull inbox: ${all.length} messages total`);
  for (const m of all) {
    console.log(`  [${m.read ? "read" : "unread"}] ${m.from} → ${m.subject} (${m.createdAt})`);
  }
}

main().catch(console.error);
