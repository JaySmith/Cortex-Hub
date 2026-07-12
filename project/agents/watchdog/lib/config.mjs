import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS = {
  agentName: "watchdog",
  hostname: "watchdog.local",
  hubHost: "localhost",
  hubPort: 4096,
  checkIntervalMs: 60_000,
  heartbeatIntervalMs: 30_000,
  alertCooldownMs: 300_000,
  memoryTtlMs: 86_400_000,
  targets: [
    {
      name: "hub-mcp",
      type: "http",
      endpoint: "http://localhost:4096/health",
      expectedStatus: 200,
      timeoutMs: 5000,
      tags: ["hub", "critical"],
    },
    {
      name: "hub-mcp-connectivity",
      type: "tcp",
      host: "localhost",
      port: 4096,
      timeoutMs: 3000,
      tags: ["hub", "critical"],
    },
  ],
  alertRules: [
    {
      name: "critical-down",
      condition: "status == 'down' && severity == 'critical'",
      notify: ["oncall"],
      cooldownMs: 300_000,
    },
  ],
};

export function loadConfig(filePath) {
  const configPath = filePath || resolve(process.argv[1], "..", "config.json");
  if (!existsSync(configPath)) {
    console.warn("No config file found at", configPath, "- using defaults");
    return { ...DEFAULTS, configPath };
  }
  const raw = readFileSync(configPath, "utf-8");
  const user = JSON.parse(raw);
  return deepMerge(DEFAULTS, user);
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key]) &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key])
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else if (Array.isArray(out[key]) && Array.isArray(override[key])) {
      out[key] = override[key];
    } else {
      out[key] = override[key];
    }
  }
  return out;
}
