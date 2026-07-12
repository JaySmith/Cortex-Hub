import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { DaemonAgent, loadConfig } from "@cortex/agent-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(resolve(__dirname, "config.json"));

class BackupAgent extends DaemonAgent {
  constructor() {
    super(
      {
        agentName: config.agentName,
        hostname: config.hostname,
        checkIntervalMs: config.checkIntervalMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
      },
      { hostname: config.hubHost, port: config.hubPort },
    );
    this.backups = config.backups || [];
    this.lastBackupDates = {};
  }

  async tick(ctx) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const label = `${dateStr}_${now.getTime()}`;

    for (const job of this.backups) {
      if (!this._shouldRun(job, now)) continue;

      ctx.log.info({ backup: job.name }, "Starting backup");
      const result = await this._runBackup(job, label, ctx);
      await this._reportResult(job, result, ctx);

      if (result.success && job.retention) {
        await this._enforceRetention(job, ctx);
      }
    }
  }

  _shouldRun(job, now) {
    const lastRun = this.lastBackupDates[job.name];
    if (!lastRun) return true;

    const elapsed = now.getTime() - lastRun.getTime();
    switch (job.schedule) {
      case "hourly": return elapsed >= 3600000;
      case "daily": return elapsed >= 86400000;
      case "weekly": return elapsed >= 604800000;
      case "monthly": return elapsed >= 2592000000;
      default: return elapsed >= job.schedule || elapsed >= 86400000;
    }
  }

  async _runBackup(job, label, ctx) {
    const destDir = `${job.destination}/${label}`;
    const start = Date.now();

    try {
      if (!existsSync(job.destination)) {
        mkdirSync(job.destination, { recursive: true });
      }

      switch (job.type) {
        case "directory":
          this._exec(`mkdir -p ${destDir}`);
          this._exec(`cp -a ${job.source} ${destDir}/`);
          if (job.compress) {
            this._exec(`tar -czf ${destDir}.tar.gz -C ${job.destination} ${label}`);
            this._exec(`rm -rf ${destDir}`);
          }
          break;

        case "command":
          this._exec(job.command);
          break;

        case "rsync":
          this._exec(
            `rsync -avz --delete ${job.source} ${destDir}/`,
          );
          break;

        default:
          return { success: false, error: `Unknown backup type: ${job.type}` };
      }

      const elapsed = Date.now() - start;
      this.lastBackupDates[job.name] = new Date();
      ctx.log.info({ backup: job.name, elapsedMs: elapsed, size: this._getSize(destDir) }, "Backup complete");

      return {
        success: true,
        elapsedMs: elapsed,
        path: job.compress ? `${destDir}.tar.gz` : destDir,
        size: this._getSize(job.compress ? `${destDir}.tar.gz` : destDir),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      ctx.log.error({ backup: job.name, error: err.message }, "Backup failed");
      return { success: false, error: err.message, timestamp: new Date().toISOString() };
    }
  }

  async _reportResult(job, result, ctx) {
    const key = `backups/${job.name}/${new Date().toISOString().slice(0, 10)}`;
    await this.hub.memorySet(key, JSON.stringify(result, null, 2), [
      "backups", job.name, result.success ? "success" : "failed",
    ]);

    if (!result.success) {
      await this.hub.sendMessage(
        "oncall",
        `[FAILED] Backup ${job.name}`,
        `Backup ${job.name} failed: ${result.error}`,
      );
    }
  }

  async _enforceRetention(job, ctx) {
    for (const [period, keep] of Object.entries(job.retention)) {
      try {
        const prefix = job.destination;
        const entries = this._exec(`ls -1t ${prefix}/`)
          .stdout.trim()
          .split("\n")
          .filter(Boolean);

        if (entries.length <= keep) continue;

        const toRemove = entries.slice(keep);
        for (const entry of toRemove) {
          this._exec(`rm -rf ${prefix}/${entry} ${prefix}/${entry}.tar.gz`);
          ctx.log.info({ backup: job.name, removed: entry }, "Removed expired backup");
        }
      } catch (err) {
        ctx.log.warn({ backup: job.name, period, error: err.message }, "Retention enforcement failed");
      }
    }
  }

  _exec(cmd) {
    return execSync(cmd, { encoding: "utf8", timeout: 300000 });
  }

  _getSize(p) {
    try {
      const out = execSync(`du -sh ${p} 2>/dev/null || echo "0"`, {
        encoding: "utf8",
        timeout: 5000,
      });
      return out.trim().split("\t")[0] || "unknown";
    } catch {
      return "unknown";
    }
  }
}

const agent = new BackupAgent();
agent.registerShutdownHooks();
agent.run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
