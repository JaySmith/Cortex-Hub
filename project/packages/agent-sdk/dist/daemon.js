import { HubClient } from "./mcp.js";
import { createLogger } from "./logger.js";
export class DaemonAgent {
    hub;
    config;
    log;
    tickCount = 0;
    running = false;
    heartTimer = null;
    checkTimer = null;
    constructor(config, hubOpts) {
        this.config = config;
        this.log = createLogger(config.agentName);
        this.hub = new HubClient({
            hostname: hubOpts?.hostname,
            port: hubOpts?.port,
            agentName: config.agentName,
            autoReconnect: hubOpts?.autoReconnect ?? true,
            maxRetries: hubOpts?.maxRetries ?? 5,
        });
    }
    async run() {
        this.running = true;
        try {
            await this.startup();
        }
        catch (err) {
            this.log.error({ err }, "Startup failed");
            process.exit(1);
        }
        this.heartTimer = setInterval(async () => {
            try {
                await this.hub.heartbeat();
            }
            catch {
                // heartbeat failures are non-fatal
            }
        }, this.config.heartbeatIntervalMs);
        await this._runTick();
        this._scheduleNext();
    }
    async startup() {
        this.log.info(`${this.config.agentName} v1.0.0 starting on ${this.config.hostname}`);
        await this.hub.connect();
        await this.hub.register();
        await this.hub.heartbeat();
        this.log.info("Startup complete");
    }
    async _runTick() {
        if (!this.running)
            return;
        this.tickCount++;
        const ctx = {
            hub: this.hub,
            config: this.config,
            log: this.log,
            tickCount: this.tickCount,
        };
        const start = Date.now();
        try {
            await this.tick(ctx);
        }
        catch (err) {
            this.log.error({ err }, "Tick failed");
        }
        const elapsed = Date.now() - start;
        this.log.debug({ tick: this.tickCount, elapsedMs: elapsed }, "Tick completed");
    }
    _scheduleNext() {
        if (!this.running)
            return;
        this.checkTimer = setTimeout(async () => {
            if (!this.running)
                return;
            await this._runTick();
            this._scheduleNext();
        }, this.config.checkIntervalMs);
    }
    async shutdown(signal) {
        this.log.info({ signal }, "Shutting down");
        this.running = false;
        if (this.heartTimer)
            clearInterval(this.heartTimer);
        if (this.checkTimer)
            clearTimeout(this.checkTimer);
        try {
            await this.hub.memorySet(`hive/nodes/${this.config.agentName}`, "offline");
        }
        catch { }
        this.hub.close();
        process.exit(0);
    }
    registerShutdownHooks() {
        process.on("SIGINT", () => this.shutdown("SIGINT"));
        process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    }
}
//# sourceMappingURL=daemon.js.map