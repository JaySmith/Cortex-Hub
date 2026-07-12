# Cortex User Guide

Cortex is a multi-agent AI orchestration framework. Specialized agents communicate through a central Hub using shared memory and message passing — coordinating tasks like monitoring, backups, access management, and incident response without human intervention.

- **Hub** — MCP server on port 4096. Stores shared memory and routes messages between agents.
- **Interactive Agents** — human-in-the-loop sessions (opencode). ComputeAgent, SecurityAgent, DocAgent.
- **Daemon Agents** — persistent background services. WatchdogAgent, BackupAgent, AccessAgent.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start: Single Machine](#quick-start-single-machine)
3. [Hub Installation](#hub-installation)
4. [Daemon Agent Installation](#daemon-agent-installation)
5. [Interactive Agent Setup (opencode)](#interactive-agent-setup-opencode)
6. [Configuration Reference](#configuration-reference)
7. [Agent SDK](#agent-sdk)
8. [MCP Tools Reference](#mcp-tools-reference)
9. [Memory Key Convention](#memory-key-convention)
10. [Use Cases](#use-cases)
11. [Monitoring & Logs](#monitoring--logs)
12. [Troubleshooting](#troubleshooting)
13. [Production Checklist](#production-checklist)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18 | Required for Hub and all daemon agents |
| npm | >= 9 | Ships with Node.js |
| systemd | any | Production deployment (Linux). Optional for dev |
| SQLite | bundled | The Hub uses better-sqlite3 (native, included via npm) |
| opencode | latest | Required only for interactive agents |

Test your setup:

```bash
node --version   # v18+
npm --version    # v9+
```

---

## Quick Start: Single Machine

Run everything on one machine for evaluation:

```bash
# 1. Clone the repository
git clone <repo-url> cortex
cd cortex

# 2. Install and start the Hub
cd hub/mcp-server
npm install
npm run build
node dist/index.js
# Hub is now listening on port 4096

# 3. In a new terminal, start the WatchdogAgent
cd agents/watchdog
npm install
node agent.mjs
```

Verify agents are registered:

```bash
node hub/scripts/list-agents.mjs
```

You should see two agents: `hub` and `watchdog`.

---

## Hub Installation

### Development

```bash
cd hub/mcp-server
npm install
npm run build    # Compile TypeScript → dist/
npm start        # Run on http://localhost:4096
```

The Hub stores all data in `data/hub.db` (SQLite, created automatically).

### Production (systemd)

```bash
# Build the server
cd hub/mcp-server
npm install
npm run build

# Install the systemd service
sudo mkdir -p /opt/cortex
sudo cp -r ../.. /opt/cortex/hub
sudo cp hub/mcp-server/hub-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hub-mcp

# Verify
journalctl -u hub-mcp -f --no-pager
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUB_PORT` | `4096` | MCP server port |
| `HUB_DATA_DIR` | `./data` | Directory for SQLite database |
| `HUB_LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `HUB_CACHE_TTL_MS` | `30000` | In-memory cache TTL for memory reads |
| `HUB_BATCH_WRITE_MS` | `5000` | Debounce interval for batched memory writes |
| `NODE_ENV` | — | Set to `production` to disable pino-pretty logging |

Health check:

```bash
curl -s -X POST http://localhost:4096/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

---

## Daemon Agent Installation

Daemon agents run as persistent background services. Each follows the same pattern.

### Available Daemon Agents

| Agent | Role | What it does | Status |
|-------|------|-------------|--------|
| WatchdogAgent | `watchdog` | Health checks (HTTP, TCP, ping, process, command), alert rules with cooldowns, periodic reports | Implemented |
| BackupAgent | `backup` | Scheduled directory/rsync/command backups, retention enforcement, failure alerts | Implemented |
| AccessAgent | `access` | SSH key age tracking, TLS cert expiry monitoring, daily audit logs | Implemented |

### Install any daemon agent

```bash
cd agents/<agent-name>
npm install

# Quick start (foreground)
node agent.mjs

# Production (systemd)
sudo mkdir -p /opt/cortex/agents/<agent-name>
sudo cp -r . /opt/cortex/agents/<agent-name>
sudo cp <agent-name>.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now <agent-name>

# Monitor
journalctl -u <agent-name> -f
```

### Environment Variables (all daemon agents)

| Variable | Default | Description |
|----------|---------|-------------|
| `CORTEX_AGENT_NAME` | from config | Override agent name |
| `CORTEX_HOSTNAME` | from config | Override hostname |
| `CORTEX_HUB_HOST` | `localhost` | Hub hostname |
| `CORTEX_HUB_PORT` | `4096` | Hub port |
| `CORTEX_CHECK_INTERVAL` | from config | Override check interval (ms) |
| `CORTEX_HEARTBEAT_INTERVAL` | `30000` | Heartbeat interval (ms) |
| `CORTEX_LOG_LEVEL` | `info` | Log level |
| `NODE_ENV` | — | Set to `production` for JSON logs |

### WatchdogAgent

Configuration file: `agents/watchdog/config.json`

```json
{
  "agentName": "watchdog",
  "hubHost": "localhost",
  "hubPort": 4096,
  "checkIntervalMs": 60000,
  "heartbeatIntervalMs": 30000,
  "alertCooldownMs": 300000,
  "targets": [
    {
      "name": "hub-mcp",
      "type": "http",
      "endpoint": "http://localhost:4096/mcp",
      "expectedStatus": 405,
      "timeoutMs": 5000,
      "tags": ["hub", "critical"],
      "severity": "critical"
    }
  ],
  "alertRules": [
    {
      "name": "critical-down",
      "condition": "status == 'down' && severity == 'critical'",
      "notify": ["oncall"],
      "cooldownMs": 300000
    }
  ]
}
```

**Check types:**

| Type | Fields | Example |
|------|--------|---------|
| `http` | `endpoint`, `expectedStatus`, `method`, `timeoutMs` | Health endpoint probe |
| `tcp` | `host`, `port`, `timeoutMs` | Port connectivity check |
| `ping` | `host`, `timeoutMs` | ICMP ping (requires root) |
| `process` | `process` (name) | Process is running |
| `command` | `command`, `timeoutMs` | Arbitrary shell command |

**Ad-hoc commands:** Other agents can message WatchdogAgent:

| Command | Response |
|---------|----------|
| `ping` | `pong` with uptime |
| `check <target>` | Check result for that target |
| `check` (no target) | Results for all targets |
| `status` | Hub stats |

### BackupAgent

Configuration: `agents/backup/config.json`

```json
{
  "agentName": "backup",
  "checkIntervalMs": 3600000,
  "backups": [
    {
      "name": "hub-data",
      "type": "directory",
      "source": "/opt/cortex/hub/mcp-server/data",
      "destination": "/var/backups/cortex/hub",
      "schedule": "daily",
      "retention": { "daily": 7, "weekly": 4, "monthly": 3 },
      "compress": true
    }
  ]
}
```

**Backup types:**

| Type | Behavior |
|------|----------|
| `directory` | cp -a, optionally tar.gz compress |
| `rsync` | rsync -avz --delete |
| `command` | Run arbitrary command |

BackupAgent writes results to `backups/<name>/<date>` in hub memory and sends failure alerts to `oncall`.

### AccessAgent

Configuration: `agents/access/config.json`

```json
{
  "agentName": "access",
  "checkIntervalMs": 86400000,
  "sshKeyPaths": ["/etc/ssh/ssh_host_*", "/home/*/.ssh/id_*"],
  "certPaths": ["/etc/ssl/certs", "/etc/letsencrypt/live"],
  "keyRotationDays": 90,
  "certRenewalDays": 30
}
```

AccessAgent writes daily audit reports to `access/audit/<date>` in hub memory and alerts `oncall` when keys or certs are near expiry.

---

## Interactive Agent Setup (opencode)

Interactive agents run inside an opencode CLI session with a human. They use the Hub for shared memory and messaging.

### 1. Configure the MCP remote

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "hub": {
      "type": "remote",
      "url": "http://<hub-ip>:4096/mcp",
      "enabled": true
    }
  }
}
```

### 2. Install role instructions

Copy the appropriate AGENTS.md:

```bash
cp agents/compute/AGENTS.md ~/.config/opencode/AGENTS.md
```

### 3. On each session startup

The 7-step startup procedure:

```markdown
1. hub_agent_register(name="compute", hostname="compute.local")
2. hub_memory_set(key="hive/nodes/compute", value="online", tags=["hive","status"], agent="compute")
3. hub_poll(agent="compute")
4. hub_memory_search(query="hive/")
5. Run version detection for: python, node, git, docker, ollama, go, rustc, cargo, java
6. hub_agent_set_capabilities(agent="compute", capabilities="[...]")
7. hub_agent_check_readiness(agent="compute")
```

Or use the automated script:

```bash
node hub/scripts/startup.mjs compute
```

### Available interactive agent roles

| Agent | Role File | Description |
|-------|-----------|-------------|
| ComputeAgent | `agents/compute/AGENTS.md` | Heavy lifting — coding, LLM inference, day-to-day work |
| SecurityAgent | `agents/security/AGENTS.md` | CVE scanning, dependency audits, security review |
| ReleaseAgent | `agents/release/AGENTS.md` | CI/CD orchestration, canary analysis, rollback |
| OnCallAgent | `agents/oncall/AGENTS.md` | Incident response, escalation, postmortems |
| FinOpsAgent | `agents/finops/AGENTS.md` | Cloud cost tracking, right-sizing, budgets |
| DocAgent | `agents/doc/AGENTS.md` | Auto-generated docs from hive memory |
| HubAgent | `agents/hub/AGENTS.md` | Hub lifecycle management |

---

## Configuration Reference

### Skill Manifest

The skill manifest defines required and optional capabilities per agent role. Stored in `hub/scripts/skill-manifest.json`:

```json
[
  {
    "role": "watchdog",
    "description": "Monitoring — health checks, alerts, reports",
    "required": [{ "name": "node", "version": ">=18" }],
    "optional": [{ "name": "curl", "version": ">=7" }, { "name": "ping", "version": "*" }]
  }
]
```

View from any agent:

```
hub_skill_manifest_get()
```

Check an agent's readiness:

```
hub_agent_check_readiness(agent="compute")
```

---

## Agent SDK

The `@cortex/agent-sdk` package provides reusable building blocks for creating daemon agents.

### Reference

```js
import { DaemonAgent, HubClient, loadConfig, createLogger } from "@cortex/agent-sdk";
```

| Export | Description |
|--------|-------------|
| `DaemonAgent` | Abstract base class. Subclass and implement `tick(ctx)`. Handles registration, heartbeat, polling, reconnect, shutdown |
| `HubClient` | MCP client with auto-reconnect, retry with exponential backoff, convenience methods (`register`, `heartbeat`, `poll`, `sendMessage`, `memorySet`, `memoryGet`, `memorySearch`) |
| `loadConfig` | JSON config loader with defaults merging and env override support |
| `createLogger` | pino logger factory. Logs to stdout, pretty-print in dev, JSON in production |

### Creating a custom agent

```js
import { DaemonAgent, loadConfig } from "@cortex/agent-sdk";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(resolve(__dirname, "config.json"));

class MyAgent extends DaemonAgent {
  constructor() {
    super(
      { agentName: "my-agent", hostname: "my-agent.local", checkIntervalMs: 60000, heartbeatIntervalMs: 30000 },
      { hostname: "localhost", port: 4096 },
    );
  }

  async tick(ctx) {
    ctx.log.info("Doing work...");
    await ctx.hub.memorySet("my-agent/status", "running");
  }
}

const agent = new MyAgent();
agent.registerShutdownHooks();
agent.run();
```

### HubClient API

```js
const hub = new HubClient({ hostname: "localhost", port: 4096, agentName: "my-agent" });
await hub.connect();
await hub.register();
await hub.heartbeat();

// Core
await hub.callTool("hub_stats", {});
await hub.poll();
await hub.sendMessage("watchdog", "ping", "are you there?");

// Memory convenience
await hub.memorySet("my/key", "value", ["tag1", "tag2"]);
const val = await hub.memoryGet("my/key");
const results = await hub.memorySearch("query");

// Lifecycle
hub.close();
```

---

## MCP Tools Reference

All tools are accessed via MCP through the Hub. Interactive agents use them via opencode's tool system. Daemon agents use `hub.callTool(name, args)`.

### Agent Management

| Tool | Parameters | Returns |
|------|-----------|---------|
| `hub_agent_register` | `name`, `hostname?` | Agent record |
| `hub_agent_list` | — | Array of agents |
| `hub_agent_get` | `name` | Agent record or "not found" |
| `hub_agent_deregister` | `name` | "Deregistered" or "Not found" |
| `hub_agent_set_capabilities` | `agent`, `capabilities` (JSON string) | Capabilities array |
| `hub_agent_get_capabilities` | `agent` | Capabilities array |
| `hub_agent_check_readiness` | `agent` | `{ready, role, missing[], extra[]}` |

### Memory

| Tool | Parameters | Returns |
|------|-----------|---------|
| `hub_memory_set` | `key`, `value`, `tags?[]`, `agent` | Memory object |
| `hub_memory_get` | `key` | Memory object or "not found" |
| `hub_memory_delete` | `key` | "Deleted" or "Not found" |
| `hub_memory_search` | `query` | Array of matching memories |
| `hub_memory_list_by_agent` | `agent` | Array of memories |
| `hub_memory_list_all` | — | Array of all memories |
| `hub_memory_export` | — | JSON export of all memories |
| `hub_memory_import` | `memories` (JSON string) | Total memory count |

### Messaging

| Tool | Parameters | Returns |
|------|-----------|---------|
| `hub_send` | `from`, `to`, `subject`, `body` | Message object |
| `hub_broadcast` | `from`, `subject`, `body` | `{sent: N, messages: [...]}` |
| `hub_poll` | `agent` | Array of unread messages |
| `hub_inbox` | `agent` | Full message history (newest first) |
| `hub_mark_read` | `messageId` | "Marked as read" |
| `hub_message_delete` | `messageId` | "Deleted" |
| `hub_conversation` | `agentA`, `agentB` | Thread between two agents (oldest first) |

### System

| Tool | Parameters | Returns |
|------|-----------|---------|
| `hub_stats` | — | `{uptime, agents, messages, unread}` |
| `hub_skill_manifest_get` | — | Skill manifest array |
| `hub_skill_manifest_set` | `manifest` (JSON string) | Skill manifest array |

---

## Memory Key Convention

Use structured keys so agents can find each other's data.

| Pattern | Purpose | Example |
|---------|---------|---------|
| `hive/nodes/<name>` | Agent status | `{status: "online", role: "compute"}` |
| `hive/projects/<name>` | Shared project context | `{repo: "github.com/org/proj", branch: "main"}` |
| `hive/decisions/<date>` | Cross-agent decisions | `{decision: "use ollama for llm"}` |
| `hive/reports/<type>` | Reports (weekly, health) | WatchdogAgent writes `hive/reports/watchdog/` |
| `hive/alerts/<agent>/<target>/<ts>` | Alert records | WatchdogAgent writes triggered alerts |
| `hive/incidents/<date>` | Incident reports | `{severity: critical, service: api-gateway}` |
| `agent/<name>/<key>` | Per-agent persistent memory | `agent/compute/project-context` |
| `shared/<topic>/<key>` | General shared config | `shared/config/models` |
| `backups/<name>/<date>` | BackupAgent records | `{status: "completed", size_gb: 42}` |
| `access/audit/<date>` | AccessAgent audit logs | SSH key and cert check results |
| `security/scans/<date>` | SecurityAgent scan results | CVE scan output |
| `releases/<service>/<version>` | ReleaseAgent history | `{status: "canary", p95: 320ms}` |
| `incidents/postmortems/<date>` | OnCallAgent postmortems | Root cause + timeline |
| `finops/daily/<date>` | FinOpsAgent cost reports | Per-service cost breakdown |
| `docs/<topic>/<name>` | DocAgent output | Generated runbooks |

---

## Use Cases

### Incident response pipeline

WatchdogAgent detects a service is down → logs to `hive/alerts/` → messages OnCallAgent → OnCallAgent creates incident record → after resolution, postmortem filed to `hive/incidents/`.

### Scheduled backups

BackupAgent runs nightly → copies directories with retention → writes success/failure to `backups/` → alerts oncall on failure.

### Access compliance

AccessAgent checks SSH key ages and TLS cert expiry daily → writes audit log to `access/audit/` → warns oncall when keys near 90-day rotation or certs under 30-day renewal window.

### Multi-agent knowledge base

Any agent writes decisions to `shared/decisions/` or `hive/projects/`. New agents search `shared/` on startup to get context. No onboarding docs needed.

---

## Monitoring & Logs

### Hub logs

```bash
journalctl -u hub-mcp -f
```

Log format (production):

```json
{"level":30,"time":"2026-06-24T20:30:19.898Z","name":"hub","msg":"Hub MCP server listening","port":4096}
```

### Daemon agent logs

```bash
journalctl -u watchdog -f
journalctl -u backup -f
journalctl -u access -f
```

### Query agent status

```bash
node hub/scripts/list-agents.mjs
node hub/scripts/check-inbox.mjs <agent-name>
```

### Memory inspection

```bash
# From any agent:
hub_memory_search(query="hive/nodes/")
hub_memory_get(key="hive/nodes/watchdog")
hub_stats()
```

---

## Troubleshooting

### Hub won't start

```bash
# Check port conflict
ss -tlnp | grep 4096

# Check SQLite database
file data/hub.db

# Run with debug logging
HUB_LOG_LEVEL=debug node dist/index.js
```

### Agent can't connect to Hub

```bash
# Verify Hub is running
curl -s -X POST http://<hub-ip>:4096/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'

# Check connectivity
nc -zv <hub-ip> 4096
```

### Agent won't register

```bash
# Check agent is already registered
node hub/scripts/list-agents.mjs

# Deregister and try again
hub_agent_deregister(name="my-agent")
```

### Memory operations slow

The Hub uses SQLite with WAL mode and an in-memory LRU cache. If writes are slow, check:

```bash
# Check SQLite WAL size
ls -lh data/hub.db-wal

# The WAL is auto-checkpointed. Adjust with:
# HUB_BATCH_WRITE_MS=2000 node dist/index.js (faster flush)
```

### "require is not defined" error

This happens when ESM code uses `require()`. The Hub and SDK are ESM (`"type": "module"`). Use `import` instead. If you see this, you're running old code — rebuild with `npm run build`.

---

## Production Checklist

- [ ] Hub deployed behind systemd with `Restart=on-failure`
- [ ] Hub data directory on persistent, backed-up storage
- [ ] Daemon agents deployed as systemd services
- [ ] `NODE_ENV=production` set (JSON logs, no pino-pretty)
- [ ] Log aggregation configured (journald → Loki/Elasticsearch/DataDog)
- [ ] Hub port firewalled (only allow agent machines)
- [ ] Regular `hub_memory_export` scheduled for disaster recovery
- [ ] Skill manifest configured for each agent role
- [ ] WatchdogAgent monitoring the Hub itself
- [ ] Alert rules configured with appropriate cooldowns
