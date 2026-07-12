import http from "node:http";
import { createLogger } from "./logger.js";
const SSE_LINE_RE = /^data: (.+)$/m;
export class HubClient {
    hostname;
    port;
    path;
    sessionId = null;
    connected = false;
    agentName;
    autoReconnect;
    maxRetries;
    retryCount = 0;
    log;
    _closing = false;
    constructor(opts = {}) {
        this.hostname = opts.hostname || "localhost";
        this.port = opts.port || 4096;
        this.path = opts.path || "/mcp";
        this.agentName = opts.agentName || "agent";
        this.autoReconnect = opts.autoReconnect ?? true;
        this.maxRetries = opts.maxRetries ?? 5;
        this.log = createLogger(this.agentName);
    }
    async connect() {
        this._closing = false;
        this.retryCount = 0;
        await this._doConnect();
    }
    async _doConnect() {
        const init = await this._request({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: this.agentName, version: "1.0.0" },
            },
        });
        this.sessionId = init.headers["mcp-session-id"];
        if (!this.sessionId)
            throw new Error("No session ID received from Hub");
        await this._request({ jsonrpc: "2.0", method: "notifications/initialized" });
        this.connected = true;
        this.retryCount = 0;
        this.log.info({ sessionId: this.sessionId }, "Connected to Hub");
    }
    async callTool(name, args = {}) {
        if (!this.connected)
            throw new Error("Not connected to Hub");
        const body = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name, arguments: args },
        };
        try {
            const res = await this._request(body);
            const msgs = this._parseSSE(res.body);
            for (const raw of msgs) {
                const msg = raw;
                if (msg.result) {
                    const textContent = msg.result.content?.[0]?.text;
                    if (textContent) {
                        try {
                            return JSON.parse(textContent);
                        }
                        catch {
                            return textContent;
                        }
                    }
                    return msg.result;
                }
                if (msg.error) {
                    throw new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`);
                }
            }
            return null;
        }
        catch (err) {
            if (this.autoReconnect && !this._closing) {
                return this._reconnectAndRetry(name, args, err);
            }
            throw err;
        }
    }
    async _reconnectAndRetry(name, args, originalError) {
        if (this.retryCount >= this.maxRetries) {
            throw new Error(`Max retries (${this.maxRetries}) exceeded. Last error: ${originalError.message}`);
        }
        this.retryCount++;
        const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30_000);
        this.log.warn({ retry: this.retryCount, delay, error: originalError.message }, "Connection lost, reconnecting...");
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.connected = false;
        this.sessionId = null;
        try {
            await this._doConnect();
            return await this.callTool(name, args);
        }
        catch (err) {
            return this._reconnectAndRetry(name, args, err);
        }
    }
    async register() {
        return this.callTool("hub_agent_register", {
            name: this.agentName,
            hostname: this.hostname,
        });
    }
    async heartbeat() {
        await this.callTool("hub_memory_set", {
            key: `hive/nodes/${this.agentName}`,
            value: "online",
            tags: ["hive", "status", this.agentName],
            agent: this.agentName,
        }).catch(() => { });
    }
    async poll() {
        const result = await this.callTool("hub_poll", { agent: this.agentName });
        return Array.isArray(result) ? result : [];
    }
    async sendMessage(to, subject, body) {
        return this.callTool("hub_send", {
            from: this.agentName,
            to,
            subject,
            body,
        });
    }
    async broadcast(subject, body) {
        return this.callTool("hub_broadcast", {
            from: this.agentName,
            subject,
            body,
        });
    }
    async memorySet(key, value, tags = []) {
        return this.callTool("hub_memory_set", {
            key,
            value,
            tags,
            agent: this.agentName,
        });
    }
    async memoryGet(key) {
        return this.callTool("hub_memory_get", { key });
    }
    async memorySearch(query) {
        return this.callTool("hub_memory_search", { query });
    }
    close() {
        this._closing = true;
        this.connected = false;
        this.sessionId = null;
    }
    _request(body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const headers = {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                "Content-Length": Buffer.byteLength(data),
            };
            if (this.sessionId)
                headers["mcp-session-id"] = this.sessionId;
            const r = http.request({
                hostname: this.hostname,
                port: this.port,
                path: this.path,
                method: "POST",
                headers,
            }, (res) => {
                let t = "";
                res.on("data", (c) => (t += c.toString()));
                res.on("end", () => resolve({ body: t, headers: res.headers }));
            });
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
            try {
                return JSON.parse(l.slice(6));
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
    }
}
//# sourceMappingURL=mcp.js.map