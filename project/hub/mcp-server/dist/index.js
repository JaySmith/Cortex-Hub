import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "./logger.js";
import { setMemory, getMemory, deleteMemory, searchMemories, listMemoriesByAgent, listAllMemories, exportMemories, importMemories, closeMemory, } from "./memory-store.js";
import { registerAgent, listAgents, deregisterAgent, getAgent, sendMessage, pollMessages, markRead, getInbox, deleteMessage, getConversation, getStats, setAgentCapabilities, getAgentCapabilities, getSkillManifest, setSkillManifest, checkAgentReadiness, closeMessageQueue, } from "./message-queue.js";
const MCP_PORT = parseInt(process.env.HUB_PORT || "4096", 10);
function createServer() {
    const server = new McpServer({
        name: "hub",
        version: "1.0.0",
    });
    server.registerTool("hub_agent_register", {
        description: "Register this agent with the Hub so others can find it",
        inputSchema: {
            name: z
                .string()
                .min(1)
                .max(64)
                .describe("Agent name (e.g. compute, watchdog)"),
            hostname: z.string().optional().describe("Hostname or address of this agent"),
        },
    }, async ({ name, hostname }) => {
        const agent = await registerAgent(name, hostname || "unknown");
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
    });
    server.registerTool("hub_agent_list", {
        description: "List all registered agents in the hive",
        inputSchema: {},
    }, async () => {
        const agents = await listAgents();
        return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    });
    server.registerTool("hub_agent_get", {
        description: "Get details about a specific agent",
        inputSchema: {
            name: z.string().describe("Agent name"),
        },
    }, async ({ name }) => {
        const agent = await getAgent(name);
        if (!agent) {
            return { content: [{ type: "text", text: "Agent not found" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
    });
    server.registerTool("hub_agent_deregister", {
        description: "Remove an agent from the hive registry",
        inputSchema: {
            name: z.string().describe("Agent name to deregister"),
        },
    }, async ({ name }) => {
        const ok = await deregisterAgent(name);
        return { content: [{ type: "text", text: ok ? "Deregistered" : "Not found" }] };
    });
    server.registerTool("hub_memory_set", {
        description: "Store a memory that persists across all agents and sessions",
        inputSchema: {
            key: z.string().describe("Unique key for this memory"),
            value: z.string().describe("Memory content"),
            tags: z.array(z.string()).optional().describe("Tags for searching"),
            agent: z.string().describe("Your agent name"),
        },
    }, async ({ key, value, tags, agent }) => {
        const memory = await setMemory(key, value, tags ?? [], agent);
        return { content: [{ type: "text", text: JSON.stringify(memory, null, 2) }] };
    });
    server.registerTool("hub_memory_get", {
        description: "Retrieve a memory by key",
        inputSchema: {
            key: z.string().describe("Memory key"),
        },
    }, async ({ key }) => {
        const memory = await getMemory(key);
        if (!memory) {
            return { content: [{ type: "text", text: "Memory not found" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(memory, null, 2) }] };
    });
    server.registerTool("hub_memory_delete", {
        description: "Delete a memory by key",
        inputSchema: {
            key: z.string().describe("Memory key"),
        },
    }, async ({ key }) => {
        const deleted = await deleteMemory(key);
        return { content: [{ type: "text", text: deleted ? "Deleted" : "Not found" }] };
    });
    server.registerTool("hub_memory_search", {
        description: "Search memories by content, key, or tags",
        inputSchema: {
            query: z.string().describe("Search query"),
        },
    }, async ({ query }) => {
        const results = await searchMemories(query);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    });
    server.registerTool("hub_memory_list_by_agent", {
        description: "List all memories created by a specific agent",
        inputSchema: {
            agent: z.string().describe("Agent name"),
        },
    }, async ({ agent }) => {
        const memories = await listMemoriesByAgent(agent);
        return { content: [{ type: "text", text: JSON.stringify(memories, null, 2) }] };
    });
    server.registerTool("hub_memory_list_all", {
        description: "List all memories in the hive",
        inputSchema: {},
    }, async () => {
        const memories = await listAllMemories();
        return { content: [{ type: "text", text: JSON.stringify(memories, null, 2) }] };
    });
    server.registerTool("hub_memory_export", {
        description: "Export all memories as JSON for backup",
        inputSchema: {},
    }, async () => {
        const memories = await exportMemories();
        return { content: [{ type: "text", text: JSON.stringify(memories, null, 2) }] };
    });
    server.registerTool("hub_memory_import", {
        description: "Import memories from a JSON backup (upserts by key)",
        inputSchema: {
            memories: z.string().describe("JSON array of memory objects [{key, value, tags, agent}]"),
        },
    }, async ({ memories }) => {
        let parsed;
        try {
            parsed = JSON.parse(memories);
        }
        catch {
            return { content: [{ type: "text", text: "Invalid JSON" }] };
        }
        const count = await importMemories(parsed);
        return { content: [{ type: "text", text: `Imported. Total memories: ${count}` }] };
    });
    server.registerTool("hub_send", {
        description: "Send a message to another agent in the hive",
        inputSchema: {
            from: z.string().describe("Your agent name"),
            to: z.string().describe("Recipient agent name"),
            subject: z.string().describe("Message subject"),
            body: z.string().describe("Message body"),
        },
    }, async ({ from, to, subject, body }) => {
        const msg = await sendMessage(from, to, subject, body);
        return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
    });
    server.registerTool("hub_broadcast", {
        description: "Broadcast a message to all registered agents",
        inputSchema: {
            from: z.string().describe("Your agent name"),
            subject: z.string().describe("Message subject"),
            body: z.string().describe("Message body"),
        },
    }, async ({ from, subject, body }) => {
        const agents = await listAgents();
        const results = [];
        for (const agent of agents) {
            if (agent.name !== from) {
                const msg = await sendMessage(from, agent.name, subject, body);
                results.push(msg);
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ sent: results.length, messages: results }, null, 2),
                },
            ],
        };
    });
    server.registerTool("hub_poll", {
        description: "Check for unread messages addressed to you",
        inputSchema: {
            agent: z.string().describe("Your agent name"),
        },
    }, async ({ agent }) => {
        const messages = await pollMessages(agent);
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
    });
    server.registerTool("hub_inbox", {
        description: "View your full message history",
        inputSchema: {
            agent: z.string().describe("Your agent name"),
        },
    }, async ({ agent }) => {
        const messages = await getInbox(agent);
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
    });
    server.registerTool("hub_mark_read", {
        description: "Mark a message as read",
        inputSchema: {
            messageId: z.string().describe("Message ID"),
        },
    }, async ({ messageId }) => {
        const ok = await markRead(messageId);
        return { content: [{ type: "text", text: ok ? "Marked as read" : "Not found" }] };
    });
    server.registerTool("hub_message_delete", {
        description: "Delete a message by ID",
        inputSchema: {
            messageId: z.string().describe("Message ID"),
        },
    }, async ({ messageId }) => {
        const ok = await deleteMessage(messageId);
        return { content: [{ type: "text", text: ok ? "Deleted" : "Not found" }] };
    });
    server.registerTool("hub_conversation", {
        description: "View the full message thread between two agents",
        inputSchema: {
            agentA: z.string().describe("First agent name"),
            agentB: z.string().describe("Second agent name"),
        },
    }, async ({ agentA, agentB }) => {
        const messages = await getConversation(agentA, agentB);
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
    });
    server.registerTool("hub_stats", {
        description: "Get hub server statistics (uptime, agent/message counts)",
        inputSchema: {},
    }, async () => {
        const stats = await getStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    });
    server.registerTool("hub_agent_set_capabilities", {
        description: "Declare what software/tools this agent has installed (name + version)",
        inputSchema: {
            agent: z.string().describe("Your agent name"),
            capabilities: z.string().describe("JSON array of {name, version} objects"),
        },
    }, async ({ agent, capabilities }) => {
        let parsed;
        try {
            parsed = JSON.parse(capabilities);
        }
        catch {
            return { content: [{ type: "text", text: "Invalid JSON" }] };
        }
        const result = await setAgentCapabilities(agent, parsed);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
    server.registerTool("hub_agent_get_capabilities", {
        description: "Get the declared capabilities of a specific agent",
        inputSchema: {
            agent: z.string().describe("Agent name"),
        },
    }, async ({ agent }) => {
        const caps = await getAgentCapabilities(agent);
        return { content: [{ type: "text", text: JSON.stringify(caps, null, 2) }] };
    });
    server.registerTool("hub_agent_check_readiness", {
        description: "Check if an agent's capabilities meet the skill manifest requirements for its role",
        inputSchema: {
            agent: z.string().describe("Agent name"),
        },
    }, async ({ agent }) => {
        const result = await checkAgentReadiness(agent);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
    server.registerTool("hub_skill_manifest_get", {
        description: "Get the skill manifest — required and optional capabilities per agent role",
        inputSchema: {},
    }, async () => {
        const manifest = await getSkillManifest();
        return { content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }] };
    });
    server.registerTool("hub_skill_manifest_set", {
        description: "Set the skill manifest — map agent roles to required/optional capabilities",
        inputSchema: {
            manifest: z
                .string()
                .describe("JSON array of {role, description, required: [{name, version}], optional: [{name, version}]}"),
        },
    }, async ({ manifest }) => {
        let parsed;
        try {
            parsed = JSON.parse(manifest);
        }
        catch {
            return { content: [{ type: "text", text: "Invalid JSON" }] };
        }
        const result = await setSkillManifest(parsed);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
    return server;
}
const app = createMcpExpressApp();
const transports = {};
app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
        let transport;
        if (sessionId && transports[sessionId]) {
            transport = transports[sessionId];
        }
        else if (!sessionId && isInitializeRequest(req.body)) {
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    transports[sid] = transport;
                    logger.info({ sessionId: sid }, "MCP session initialized");
                },
            });
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    delete transports[sid];
                    logger.info({ sessionId: sid }, "MCP session closed");
                }
            };
            const server = createServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        }
        else {
            res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32000, message: "No valid session ID" },
                id: null,
            });
            return;
        }
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
        logger.error({ err }, "Error handling MCP request");
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
});
app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
    }
    await transports[sessionId].handleRequest(req, res);
});
app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
    }
    await transports[sessionId].handleRequest(req, res);
});
app.listen(MCP_PORT, () => {
    logger.info({ port: MCP_PORT }, "Hub MCP server listening");
});
async function shutdown(signal) {
    logger.info({ signal }, "Shutting down Hub MCP server");
    for (const sid in transports) {
        await transports[sid].close().catch(() => { });
        delete transports[sid];
    }
    closeMemory();
    closeMessageQueue();
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
