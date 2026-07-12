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
      {
        hostname: "localhost",
        port: 4096,
        path,
        method: opts.method || "POST",
        headers: data ? { ...headers, "Content-Length": Buffer.byteLength(data) } : headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const init = await req("/mcp", {
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    },
  });
  console.log("=== Initialize ===");
  console.log("Status:", init.status);
  console.log("Headers:", JSON.stringify(init.headers));
  console.log("Body:", init.body);

  const sessionId = init.headers["mcp-session-id"];
  if (!sessionId) {
    console.log("No session ID received");
    return;
  }
  console.log("Session ID:", sessionId);

  const tools = await req("/mcp", {
    sessionId,
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  console.log("\n=== Tools List ===");
  console.log("Status:", tools.status);
  const toolsJson = JSON.parse(tools.body);
  console.log("Tools:", toolsJson.result?.tools?.map((t) => t.name).join("\n  ") || JSON.stringify(toolsJson, null, 2));
}

main().catch(console.error);
