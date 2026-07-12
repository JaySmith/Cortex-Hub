# Cortex-Hub

**Multi-agent coordination layer.** Specialized AI agents communicate through a central Hub — sharing memory, passing messages, and coordinating tasks like monitoring, backups, access management, and incident response without human intervention.

Cortex runs two classes of agent:

- **Daemon Agents** — persistent background services (Watchdog, Backup, Access). No opencode session needed.
- **Interactive Agents** — human-in-the-loop sessions via opencode (Compute, Security, Release, Doc).

Both share the same Hub, same memory store, same message queue — the integration surface is identical.

---

## Architecture

```
┌──────────────────────┐     MCP (remote)      ┌──────────────────────┐
│  ComputeAgent        │◄─────────────────────►│  Hub (MCP Server)    │
│  (interactive)       │                       │  port 4096           │
├──────────────────────┤                       │                      │
│  SecurityAgent       │◄─────────────────────►│  ┌────────────────┐  │
│  (interactive)       │                       │  │  SQLite (WAL)  │  │
├──────────────────────┤                       │  │  + LRU cache   │  │
│  WatchdogAgent       │◄─────────────────────►│  │  + batch writes│  │
│  (daemon)            │                       │  └────────────────┘  │
├──────────────────────┤                       │                      │
│  BackupAgent         │◄─────────────────────►│  ┌────────────────┐  │
│  (daemon)            │                       │  │  pino logger   │  │
├──────────────────────┤                       │  └────────────────┘  │
│  AccessAgent         │◄─────────────────────►└──────────────────────┘
│  (daemon)            │
└──────────────────────┘
```

### Components

| Component | Stack | Description |
|-----------|-------|-------------|
| **Hub** | Node.js/Express, SQLite, MCP SDK | Shared memory store + message router. 25 MCP tools for agent management, memory CRUD, messaging, and skill manifest validation |
| **Agent SDK** | TypeScript, pino | `@cortex/agent-sdk` — reusable `DaemonAgent` base class, `HubClient` with auto-reconnect, config loader, structured logger |
| **WatchdogAgent** | Node.js, systemd | Health checks (HTTP, TCP, ping, process, command), alert rules with cooldowns, periodic reports to shared memory |
| **BackupAgent** | Node.js, systemd | Scheduled directory/rsync/command backups, retention enforcement, failure alerts |
| **AccessAgent** | Node.js, systemd | SSH key age monitoring, TLS cert expiry tracking, daily audit logs |
| **Interactive Agents** | opencode + AGENTS.md | Human-in-the-loop: ComputeAgent (coding/LLM), SecurityAgent (CVE scanning), ReleaseAgent (CI/CD), OnCallAgent (incidents), etc. |

### Key Design Decisions

- **SQLite with WAL mode** — concurrent-safe, indexed queries, transactions. Replaces fragile JSON flat files. In-memory LRU cache (2000 entries, 30s TTL) with 5-second batched writes for high-frequency heartbeats.
- **MCP Streamable HTTP** — agents communicate over standard HTTP with SSE. No SDK lock-in. Any language can implement a client in ~80 lines.
- **Memory is the integration surface** — agents don't couple directly. Watchdog writes to `hive/alerts/*`, Backup reads from `backups/*`, Access writes to `access/audit/*`. Agents discover each other through structured memory keys.
- **pino structured logging** — JSON logs to stdout. Pretty-print in dev, log-aggregator-ready in production.

---

## Quick Start

```bash
# Prerequisites: Node.js >= 18
git clone https://github.com/JaySmith/Cortex-Hub.git cortex-hub
cd cortex-hub

# 1. Start the Hub
cd hub/mcp-server
npm install && npm run build && node dist/index.js &

# 2. Start WatchdogAgent
cd agents/watchdog
npm install && node agent.mjs &

# 3. Verify
node hub/scripts/list-agents.mjs
# → Should show hub and watchdog registered
```

---

## Installation

### Hub (systemd)

```bash
cd hub/mcp-server
npm install && npm run build
sudo mkdir -p /opt/cortex
sudo cp -r ../.. /opt/cortex/hub
sudo cp hub-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hub-mcp
```

### Daemon Agents (systemd)

```bash
# Example: BackupAgent
cd agents/backup
npm install
sudo mkdir -p /opt/cortex/agents/backup
sudo cp -r . /opt/cortex/agents/backup
sudo cp backup.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now backup
```

Same pattern for `watchdog`, `backup`, `access`.

### Interactive Agents (opencode)

Add the Hub MCP remote to `~/.config/opencode/opencode.jsonc`:

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

Copy the role's AGENTS.md:

```bash
cp agents/compute/AGENTS.md ~/.config/opencode/AGENTS.md
```

---

## Agent SDK

Cortex provides `@cortex/agent-sdk` (`packages/agent-sdk/`) for creating custom daemon agents:

```js
import { DaemonAgent, loadConfig } from "@cortex/agent-sdk";

class MyAgent extends DaemonAgent {
  async tick(ctx) {
    ctx.log.info("Doing work...");
    await ctx.hub.memorySet(`my-agent/status`, "running");
  }
}

const agent = new MyAgent();
agent.registerShutdownHooks();
agent.run();
```

Includes reconnection with exponential backoff, structured logging, heartbeat management, and clean shutdown.

---

## MCP Tools (25 total)

| Category | Tools |
|----------|-------|
| **Agent Management** (7) | `hub_agent_register`, `hub_agent_list`, `hub_agent_get`, `hub_agent_deregister`, `hub_agent_set_capabilities`, `hub_agent_get_capabilities`, `hub_agent_check_readiness` |
| **Memory** (8) | `hub_memory_set`, `hub_memory_get`, `hub_memory_delete`, `hub_memory_search`, `hub_memory_list_by_agent`, `hub_memory_list_all`, `hub_memory_export`, `hub_memory_import` |
| **Messaging** (7) | `hub_send`, `hub_broadcast`, `hub_poll`, `hub_inbox`, `hub_mark_read`, `hub_message_delete`, `hub_conversation` |
| **System** (3) | `hub_stats`, `hub_skill_manifest_get`, `hub_skill_manifest_set` |

---

## Agent Roles

| Agent | Type | Role |
|-------|------|------|
| **HubAgent** | interactive | Hub lifecycle management |
| **ComputeAgent** | interactive | Heavy lifting — coding, LLM inference |
| **WatchdogAgent** | daemon | Health checks, alerts, reports |
| **BackupAgent** | daemon | Scheduled backups, rotation, recovery |
| **AccessAgent** | daemon | SSH keys, TLS certs, access audits |
| **SecurityAgent** | interactive | CVE scanning, compliance, security review |
| **ReleaseAgent** | interactive | CI/CD orchestration, canary analysis |
| **OnCallAgent** | interactive | Incident response, escalation, postmortems |
| **FinOpsAgent** | interactive | Cloud cost tracking, budgets, right-sizing |
| **DocAgent** | interactive | Auto-generated documentation |

---

## Environment Variables

| Variable | Default | For |
|----------|---------|-----|
| `HUB_PORT` | `4096` | Hub |
| `HUB_DATA_DIR` | `./data` | Hub |
| `HUB_LOG_LEVEL` | `info` | Hub |
| `HUB_CACHE_TTL_MS` | `30000` | Hub |
| `HUB_BATCH_WRITE_MS` | `5000` | Hub |
| `CORTEX_HUB_HOST` | `localhost` | Daemon agents |
| `CORTEX_HUB_PORT` | `4096` | Daemon agents |
| `CORTEX_LOG_LEVEL` | `info` | Daemon agents |
| `CORTEX_CHECK_INTERVAL` | from config | Daemon agents |
| `NODE_ENV` | — | All (production → JSON logs) |

---

## Memory Convention

```
hive/nodes/<name>       → Agent online/offline status
hive/reports/<type>     → WatchdogAgent health reports
hive/alerts/<agent>/... → Triggered alert records
hive/incidents/<date>   → Incident/postmortem reports
agent/<name>/<key>      → Per-agent persistent memory
shared/<topic>/<key>    → Global shared config/decisions
backups/<name>/<date>   → BackupAgent records
access/audit/<date>     → AccessAgent audit logs
```

---

## Use Cases

- **Incident response** — Watchdog detects a down service → logs alert → messages OnCall → postmortem filed to hive memory
- **Scheduled backups** — BackupAgent runs nightly directory backups with retention → reports to `backups/*` → alerts oncall on failure
- **Access compliance** — AccessAgent monitors SSH key ages and cert expiry → daily audit logs → warns oncall before rotation deadlines
- **Persistent knowledge base** — Any agent writes decisions to `shared/decisions/`. New agents search on startup. No onboarding docs needed.

---

## Project Layout

```
Cortex-Hub/
├── README.md
├── USER_GUIDE.md
├── CORTEX-2.0.md
├── hub/
│   ├── mcp-server/           ← Hub MCP server (TypeScript → dist/)
│   │   ├── src/
│   │   │   ├── index.ts          ← 25 MCP tool definitions + Express server
│   │   │   ├── memory-store.ts   ← SQLite-backed memory (LRU cache + batch writes)
│   │   │   ├── message-queue.ts  ← SQLite-backed messaging + agent registry
│   │   │   └── logger.ts         ← pino structured logger
│   │   └── hub-mcp.service      ← systemd unit
│   ├── scripts/               ← Startup, registration, inbox, test helpers
│   └── update-config.py
├── packages/
│   └── agent-sdk/             ← @cortex/agent-sdk (DaemonAgent, HubClient, config loader)
├── agents/
│   ├── watchdog/              ← WatchdogAgent (daemon) — agent.mjs, config.json, .service
│   ├── backup/                ← BackupAgent (daemon) — agent.mjs, config.json, .service
│   ├── access/                ← AccessAgent (daemon) — agent.mjs, config.json, .service
│   ├── compute/               ← ComputeAgent (interactive) — AGENTS.md
│   ├── security/              ← SecurityAgent (interactive) — AGENTS.md
│   ├── release/               ← ReleaseAgent (interactive) — AGENTS.md
│   ├── oncall/                ← OnCallAgent (interactive) — AGENTS.md
│   ├── finops/                ← FinOpsAgent (interactive) — AGENTS.md
│   ├── doc/                   ← DocAgent (interactive) — AGENTS.md
│   └── hub/                   ← HubAgent (interactive) — AGENTS.md
└── data/                      ← Created at runtime (hub.db)
```

---

## Development

```bash
# Hub
cd hub/mcp-server
npm run dev      # tsx watch src/index.ts

# Agent SDK
cd packages/agent-sdk
npm run build    # tsc

# Daemon agents (foreground)
node agents/watchdog/agent.mjs
node agents/backup/agent.mjs
node agents/access/agent.mjs
```

---

## Production Checklist

- [ ] Hub behind systemd with `Restart=on-failure`
- [ ] `NODE_ENV=production` on all components
- [ ] Hub port firewalled to agent machines only
- [ ] Daemon agents deployed as systemd services
- [ ] Log aggregation (journald → Loki / Elasticsearch)
- [ ] Regular `hub_memory_export` for disaster recovery
- [ ] Skill manifest configured per role

---

## Related

- **[Cortex-AI](https://github.com/JaySmith/Cortex-AI)** — Vault, memory, and MCP server for structured knowledge. Distill, search, and query your personal Obsidian knowledge base. Integrates with Cortex-Hub for multi-machine vault sync.

## License

MIT
