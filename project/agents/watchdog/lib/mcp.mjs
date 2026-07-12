import http from "node:http";

export class HubClient {
  constructor(opts = {}) {
    this.hostname = opts.hostname || "localhost";
    this.port = opts.port || 4096;
    this.path = opts.path || "/mcp";
    this.sessionId = null;
    this.connected = false;
  }

  async connect() {
    const init = await this._request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "watchdog-agent", version: "1.0.0" },
      },
    });
    this.sessionId = init.headers["mcp-session-id"];
    if (!this.sessionId) throw new Error("No session ID received from Hub");
    await this._request({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.connected = true;
  }

  async callTool(name, args) {
    if (!this.connected) throw new Error("Not connected to Hub");
    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    };
    const res = await this._request(body);
    for (const msg of this._parseSSE(res.body)) {
      if (msg.result) {
        const textContent = msg.result.content?.[0]?.text;
        if (textContent) {
          try { return JSON.parse(textContent); } catch { return textContent; }
        }
        return msg.result;
      }
    }
    return null;
  }

  close() {
    this.connected = false;
    this.sessionId = null;
  }

  _request(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
      headers["Content-Length"] = Buffer.byteLength(data);

      const r = http.request(
        { hostname: this.hostname, port: this.port, path: this.path, method: "POST", headers },
        (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => resolve({ body: t, headers: res.headers }));
        },
      );
      r.on("error", reject);
      r.write(data);
      r.end();
    });
  }

  _parseSSE(text) {
    return text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter(Boolean);
  }
}
