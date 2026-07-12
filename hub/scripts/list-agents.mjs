import http from "node:http";

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(opts.sessionId ? { "mcp-session-id": opts.sessionId } : {}),
    };
    const r = http.request(
      { hostname: "localhost", port: 4096, path, method: "POST",
        headers: data ? { ...headers, "Content-Length": Buffer.byteLength(data) } : headers },
      (res) => { let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve({ body: b, headers: res.headers })); }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function parseSSE(body) {
  return body.split("\n").filter(l => l.startsWith("data: ")).map(l => { try { return JSON.parse(l.slice(6)); } catch {} }).filter(Boolean);
}

async function main() {
  const init = await req("/mcp", {
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
  });
  const sid = init.headers["mcp-session-id"];
  if (!sid) { console.log("No session"); return; }

  await req("/mcp", { sessionId: sid, body: { jsonrpc: "2.0", method: "notifications/initialized" } });

  const res = await req("/mcp", {
    sessionId: sid,
    body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hub_agent_list", arguments: {} } },
  });

  for (const msg of parseSSE(res.body)) {
    if (msg.result) console.log(JSON.stringify(msg.result, null, 2));
  }
}

main().catch(console.error);
