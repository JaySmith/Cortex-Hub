import { HubClient, HubClientOptions } from "./mcp.js";
import pino from "pino";
export interface DaemonConfig {
    agentName: string;
    hostname: string;
    checkIntervalMs: number;
    heartbeatIntervalMs: number;
}
export interface TickContext {
    hub: HubClient;
    config: DaemonConfig;
    log: pino.Logger;
    tickCount: number;
}
export declare abstract class DaemonAgent {
    protected hub: HubClient;
    protected config: DaemonConfig;
    protected log: pino.Logger;
    protected tickCount: number;
    protected running: boolean;
    private heartTimer;
    private checkTimer;
    constructor(config: DaemonConfig, hubOpts?: Partial<HubClientOptions>);
    abstract tick(ctx: TickContext): Promise<void>;
    run(): Promise<void>;
    protected startup(): Promise<void>;
    private _runTick;
    private _scheduleNext;
    shutdown(signal: string): Promise<void>;
    protected registerShutdownHooks(): void;
}
//# sourceMappingURL=daemon.d.ts.map