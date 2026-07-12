# Cortex 2.0 — From Skeleton to Production Hive

## The Problem

Cortex 1.0 defined **10 agent roles**, a **Hub MCP server**, shared memory, and message passing — a complete skeleton for a multi-agent system. But every agent still required an **interactive opencode session**. No agent ran autonomously. No agent *did* anything without a human typing.

The system was well-defined but dead on arrival for unattended operation.

## Cortex 2.0: What Changed

### First Real Agent: WatchdogAgent

The WatchdogAgent is the first agent to run as a **persistent daemon**, not an interactive CLI session. It:

- Connects to the Hub via MCP programmatically (no opencode needed)
- Runs health checks on a configurable loop (HTTP, TCP, ping, process, command)
- Evaluates alert rules with cooldowns and deduplication
- Writes structured reports to Hub memory (`hive/reports/watchdog/`)
- Sends critical alerts to OnCallAgent via Hub messaging
- Handles ad-hoc commands from other agents (`ping`, `check`, `status`)
- Registers/deregisters cleanly on start/shutdown
- Survives crashes via systemd `Restart=on-failure`

### New Pattern: MCP Client Library

Before, every agent needed to speak MCP over HTTP with raw request handling. Now `lib/mcp.mjs` provides a reusable `HubClient` class:

```js
const hub = new HubClient({ hostname: "localhost", port: 4096 });
await hub.connect();
await hub.callTool("hub_agent_register", { name: "watchdog", hostname: "..." });
const msgs = await hub.callTool("hub_poll", { agent: "watchdog" });
```

Any language can replicate this — it's HTTP POST with SSE parsing.

### Skill Manifest

Before, capabilities were declared but never checked against a standard. Now `hub/scripts/skill-manifest.json` defines required and optional tools per role. The `hub_agent_check_readiness` tool validates each agent against its role's manifest:

```json
{
  "role": "watchdog",
  "required": [{ "name": "node", "version": ">=18" }],
  "optional": [{ "name": "curl", "version": ">=7" }, { "name": "ping", "version": "*" }]
}
```

## Architecture: The Two-Class Agent System

```
┌──────────────────────────────────────────────────┐
│                  Cortex 2.0                      │
├──────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────────────────┐                        │
│  │  Interactive Agents   │  opencode session     │
│  │  (Compute, Backup,    │  human-in-the-loop    │
│  │   Security, Doc, etc) │                        │
│  └──────────┬───────────┘                        │
│             │ MCP (remote)                       │
│  ┌──────────▼───────────┐                        │
│  │      Hub (MCP)       │  port 4096             │
│  │  memories + messages  │                        │
│  └──────────┬───────────┘                        │
│             │ MCP (HTTP)                         │
│  ┌──────────▼───────────┐                        │
│  │    Daemon Agents      │  persistent service   │
│  │  (Watchdog, Backup,   │  no opencode needed   │
│  │   Access, OnCall)     │                        │
│  └──────────────────────┘                        │
│                                                   │
└──────────────────────────────────────────────────┘
```

**Interactive Agents** — run opencode with a human. They use the Hub MCP remote for shared memory and messaging. Examples: ComputeAgent, DocAgent, SecurityAgent (tasks requiring judgment).

**Daemon Agents** — run as background services (systemd, Scheduled Tasks). They use the MCP client library directly, no opencode session. Examples: WatchdogAgent (continuous monitoring), BackupAgent (scheduled snapshots), AccessAgent (cert rotation).

Both classes share the same Hub, same memory, same messaging — the integration surface is identical.

## The Daemon Agent Pattern

Every daemon agent follows the same structure:

```
agents/<role>/
├── agent.mjs             ← daemon entry point:
│                           1. connect to Hub
│                           2. register + heartbeat
│                           3. loop: poll → execute → report → sleep
│                           4. handle SIGTERM/SIGINT
├── config.json           ← targets, schedules, thresholds
├── <role>.service        ← systemd unit (Restart=on-failure)
├── AGENTS.md             ← role docs + deployment instructions
└── lib/                  ← shared or role-specific modules
    ├── mcp.mjs           ← HubClient (reused across all daemon agents)
    ├── config.mjs        ← config loader (optional)
    └── ...               ← role-specific logic
```

The `agent.mjs` main loop:

```
loop:
  1. hub_poll()          → check for commands from other agents
  2. execute task()      → role-specific work (checks, backup, scan, rotate)
  3. evaluate rules()    → alert conditions, thresholds, cooldowns
  4. hub_memory_set()    → write results to hive memory
  5. hub_send()          → notify dependent agents on failures
  6. sleep(interval)
```

## Roadmap: Completing the Hive

```
Phase          Agent          What it does                           Daemon?
──────         ─────          ───────────                            ───────
Phase 1 ✅    WatchdogAgent   Health checks, alerts, reports         Yes
Phase 2 🔄    BackupAgent     Scheduled snapshots, rotation, restore  Yes
Phase 2 🔄    AccessAgent     Cert/key rotation, access audits       Yes
Phase 3       OnCallAgent     Pulse monitoring, escalation           Yes
Phase 3       FinOpsAgent     Daily cost pulls, budget tracking      Yes
Phase 4       SecurityAgent   CVE scanning, compliance checks        Hybrid
Phase 4       ReleaseAgent    Canary analysis, rollback triggers     Hybrid
Phase 5       ComputeAgent    Scheduled batch tasks, LLM inference    No (interactive)
Phase 5       DocAgent        Auto-generate docs from hive memory    No (interactive)
```

Each agent follows the same **daemon pattern**: MCP client → register → loop → report → alert.

## Productionization Checklist

### Hub
- [ ] Replace JSON file storage with SQLite or Postgres
- [ ] Add REST API alongside MCP for non-Node clients
- [ ] Add authentication (API tokens per agent)
- [ ] Add TLS
- [ ] Add horizontal scaling (read replicas, sharded memory)

### Daemon Agents
- [ ] Add structured logging (JSON to stdout for log aggregators)
- [ ] Add Prometheus metrics endpoint per daemon agent
- [ ] Add health endpoint per daemon agent (for WatchdogAgent to check)
- [ ] Add graceful degradation (Hub unreachable → buffer and retry)
- [ ] Add config reload via SIGHUP (no restart needed)

### Company Integration
- [ ] Hub webhook system (alert on new messages in certain patterns)
- [ ] Slack/PagerDuty integration for alert routing
- [ ] SSO for agent-to-agent authentication
- [ ] Audit log of all Hub operations

## Migration Path from 1.0

No breaking changes to the Hub API. All existing `hub_*` tools remain unchanged. The 7-step opencode startup procedure still works for interactive sessions.

Daemon agents coexist with interactive agents — they share the same Hub, same memory keys, same message queues. A ComputeAgent can message the WatchdogAgent daemon and get a response without the WatchdogAgent ever opening opencode.

## Key Lessons from Building WatchdogAgent

1. **MCP Streamable HTTP is simple** — it's HTTP POST with SSE responses. No SDK required. A reusable client fits in 80 lines.

2. **The loop is the architecture** — poll → execute → evaluate → write → notify → sleep. Every daemon agent is this loop with different `execute()` logic.

3. **Memory is the integration surface** — WatchdogAgent writes to `hive/reports/watchdog/` and `hive/alerts/watchdog/`. Other agents read from `hive/` and react. No direct agent-to-agent coupling beyond the message schema.

4. **Alert cooldowns prevent noise** — without deduplication, a down service generates an alert every check interval. With cooldowns, OnCallAgent gets one alert per target per 5 minutes.

5. **systemd makes daemon management trivial** — `Restart=on-failure`, `journalctl -u watchdog -f`, and `systemctl enable --now watchdog` is all the ops you need for a single agent.

## Where Cortex Goes Next

Beyond filling out the remaining agents, the next step is **durable execution** — replacing the simple `setInterval` loop with Temporal, BullMQ, or similar. That gives you:

- Retry with backoff
- Scheduled workflows (nightly, weekly, monthly)
- State recovery on crash
- Distributed execution across machines
- Observability (workflow status, history, replay)

But for a single-machine deployment, the daemon pattern from WatchdogAgent is sufficient. Start there, add durable execution when the hive spans multiple hosts.
