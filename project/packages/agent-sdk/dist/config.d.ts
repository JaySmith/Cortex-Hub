export interface AgentConfig {
    agentName: string;
    hostname: string;
    hubHost: string;
    hubPort: number;
    checkIntervalMs: number;
    heartbeatIntervalMs: number;
    heartbeatKey: string;
    [key: string]: unknown;
}
export declare function loadConfig<T extends Record<string, unknown> = AgentConfig>(filePath?: string, defaults?: T): T;
//# sourceMappingURL=config.d.ts.map