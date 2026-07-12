export class AlertManager {
  constructor(hub, agentName, rules = []) {
    this.hub = hub;
    this.agentName = agentName;
    this.rules = rules;
    this.cooldowns = new Map();
    this.lastResults = new Map();
  }

  async evaluate(results) {
    const triggered = [];

    for (const result of results) {
      if (result.status === "up") {
        this.cooldowns.delete(result.target);
        continue;
      }

      const rule = this.rules.find((r) => this._matches(r, result));
      if (!rule) continue;

      const cooldownKey = `${rule.name}:${result.target}`;
      const lastAlert = this.cooldowns.get(cooldownKey);
      if (lastAlert && Date.now() - lastAlert < (rule.cooldownMs || 300_000)) continue;

      this.cooldowns.set(cooldownKey, Date.now());
      triggered.push({ rule: rule.name, target: result.target, result, notify: rule.notify || [] });
    }

    return triggered;
  }

  async sendAlerts(triggered) {
    for (const t of triggered) {
      const memoryKey = `hive/alerts/${this.agentName}/${t.target}/${Date.now()}`;
      const alertPayload = {
        rule: t.rule,
        target: t.target,
        status: t.result.status,
        detail: t.result.detail,
        latency: t.result.latency,
        severity: t.result.severity,
        checkedAt: t.result.checkedAt,
      };

      await this.hub.callTool("hub_memory_set", {
        key: memoryKey,
        value: JSON.stringify(alertPayload, null, 2),
        tags: ["hive", "alerts", this.agentName, t.rule, t.result.severity],
        agent: this.agentName,
      });

      for (const recipient of t.notify) {
        await this.hub.callTool("hub_send", {
          from: this.agentName,
          to: recipient,
          subject: `[${t.result.severity.toUpperCase()}] ${t.target} is ${t.result.status}`,
          body: JSON.stringify(alertPayload, null, 2),
        });
      }

      console.log(`  ALERT: [${t.result.severity}] ${t.target} is ${t.result.status} → ${t.notify.join(", ") || "logged"}`);
    }
  }

  async writeReport(results, allUp) {
    const key = `hive/reports/watchdog/${new Date().toISOString().slice(0, 10)}`;
    const report = {
      summary: allUp ? "All checks passed" : `${results.filter((r) => r.status === "down").length} check(s) failing`,
      total: results.length,
      up: results.filter((r) => r.status === "up").length,
      down: results.filter((r) => r.status === "down").length,
      avgLatency: Math.round(results.reduce((s, r) => s + r.latency, 0) / results.length),
      timestamp: new Date().toISOString(),
      results: results.slice(0, 50),
    };
    await this.hub.callTool("hub_memory_set", {
      key,
      value: JSON.stringify(report, null, 2),
      tags: ["hive", "reports", "watchdog", allUp ? "healthy" : "degraded"],
      agent: this.agentName,
    });
  }

  _matches(rule, result) {
    if (!rule.condition) return true;
    try {
      const ctx = { status: `"${result.status}"`, severity: `"${result.severity}"` };
      const expr = rule.condition
        .replace(/status\s*==\s*'([^']+)'/g, (_, v) => `status=='${v}'`)
        .replace(/severity\s*==\s*'([^']+)'/g, (_, v) => `severity=='${v}'`)
        .replace(/status\s*==\s*"([^"]+)"/g, (_, v) => `status=='${v}'`)
        .replace(/severity\s*==\s*"([^"]+)"/g, (_, v) => `severity=='${v}'`)
        .replace(/status/g, ctx.status)
        .replace(/severity/g, ctx.severity);
      return eval(expr);
    } catch {
      return true;
    }
  }
}
