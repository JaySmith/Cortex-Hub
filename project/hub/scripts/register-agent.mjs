import http from "node:http";

function request(path, opts = {}) {
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
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function parseSSE(body) {
  const results = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        results.push(JSON.parse(line.slice(6)));
      } catch {}
    }
  }
  return results;
}

async function main() {
  const agentName = process.argv[2] || "hub";
  const hostname = process.argv[3] || `${agentName}.local`;

  const init = await request("/mcp", {
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: `${agentName}-init`, version: "1.0.0" },
      },
    },
  });

  const sessionId = init.headers["mcp-session-id"];
  if (!sessionId) {
    console.error("No session ID received");
    process.exit(1);
  }

  await request("/mcp", {
    sessionId,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });

  const reg = await request("/mcp", {
    sessionId,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "hub_agent_register",
        arguments: { name: agentName, hostname },
      },
    },
  });

  const messages = parseSSE(reg.body);
  for (const msg of messages) {
    if (msg.result) {
      console.log("Registered:", JSON.stringify(msg.result, null, 2));
      process.exit(0);
    }
  }

  console.error("Registration response:", reg.body);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
