import { readFileSync, existsSync } from "node:fs";
const DEFAULTS = {
    agentName: "agent",
    hostname: "agent.local",
    hubHost: "localhost",
    hubPort: 4096,
    checkIntervalMs: 60_000,
    heartbeatIntervalMs: 30_000,
    heartbeatKey: "",
};
function envOverrides(config) {
    const overrides = {};
    if (process.env.CORTEX_AGENT_NAME)
        overrides.agentName = process.env.CORTEX_AGENT_NAME;
    if (process.env.CORTEX_HOSTNAME)
        overrides.hostname = process.env.CORTEX_HOSTNAME;
    if (process.env.CORTEX_HUB_HOST)
        overrides.hubHost = process.env.CORTEX_HUB_HOST;
    if (process.env.CORTEX_HUB_PORT)
        overrides.hubPort = parseInt(process.env.CORTEX_HUB_PORT, 10);
    if (process.env.CORTEX_CHECK_INTERVAL)
        overrides.checkIntervalMs = parseInt(process.env.CORTEX_CHECK_INTERVAL, 10);
    if (process.env.CORTEX_HEARTBEAT_INTERVAL)
        overrides.heartbeatIntervalMs = parseInt(process.env.CORTEX_HEARTBEAT_INTERVAL, 10);
    return { ...config, ...overrides };
}
function deepMerge(base, override) {
    const out = { ...base };
    for (const key of Object.keys(override)) {
        if (out[key] &&
            typeof out[key] === "object" &&
            !Array.isArray(out[key]) &&
            typeof override[key] === "object" &&
            !Array.isArray(override[key])) {
            out[key] = deepMerge(out[key], override[key]);
        }
        else {
            out[key] = override[key];
        }
    }
    return out;
}
export function loadConfig(filePath, defaults) {
    const base = defaults || DEFAULTS;
    if (!filePath || !existsSync(filePath)) {
        return envOverrides(base);
    }
    const raw = readFileSync(filePath, "utf-8");
    const user = JSON.parse(raw);
    const merged = deepMerge(base, user);
    const withEnv = envOverrides(merged);
    if (!withEnv.heartbeatKey) {
        withEnv.heartbeatKey = `hive/nodes/${withEnv.agentName}`;
    }
    return withEnv;
}
//# sourceMappingURL=config.js.map