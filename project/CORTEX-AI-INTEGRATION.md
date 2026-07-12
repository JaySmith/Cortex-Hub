# Integration with cortex-ai

cortex-ai optionally connects to cortex-hub to share vault notes across
machines. This doc describes the hub-side perspective. For the full plan,
see `docs/HIVE-INTEGRATION.md` in the cortex-ai repo.

## How it works

cortex-ai's vault distiller pushes notes to the hub as `vault/{machine_id}/{id}`
memory keys using the existing `hub_memory_*` tools. No new hub tools are needed.

```
cortex-ai (Python)  ──HTTP──►  cortex-hub MCP server
                               hub_memory_set(key="vault/office-desktop/note-id", ...)
                               hub_memory_search(query="vault/")
```

## Hub API contract

The hub's MCP tools are the stable API. cortex-ai calls:

| Tool | Purpose |
|---|---|
| `hub_memory_set` | Push a vault note to shared memory |
| `hub_memory_get` | Fetch a specific note by key |
| `hub_memory_search` | Search for vault notes (prefix `vault/`) |

**Key format:** `vault/{machine_id}/{note_id}`

**Value format:** JSON string with fields: `id`, `type`, `category`, `tier`,
`tags`, `aliases`, `updated`, `content`, `machine_id`.

**Tags:** `["vault", "{machine_id}", "{tier}", "{type}"]`

No hub-side changes required for phases 1–6.

## Phase 7: Bearer token auth

After hive integration ships, the hub adds optional bearer token authentication.
This is the only hub-side code change.

**Env var:** `HUB_TOKEN` — if set, requires `Authorization: Bearer {token}` on
all MCP requests.

**Middleware location:** `hub/mcp-server/src/index.ts`

```typescript
const HUB_TOKEN = process.env.HUB_TOKEN;
if (HUB_TOKEN) {
    app.use("/mcp", (req, res, next) => {
        if (req.method === "DELETE") return next();
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${HUB_TOKEN}`) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        next();
    });
}
```

**cortex-ai config:** `hub_token: ""` in the `hive:` block of `cortex.yaml`.
The Python hub client already supports token passthrough via the `Authorization`
header.

## What's NOT changing

- No new MCP tools
- No schema changes to the hub's SQLite database
- No changes to `@cortex/agent-sdk`
- No changes to daemon agents
- No changes to hub setup/deployment
