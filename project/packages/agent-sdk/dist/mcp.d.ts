export interface HubClientOptions {
    hostname?: string;
    port?: number;
    path?: string;
    agentName?: string;
    autoReconnect?: boolean;
    maxRetries?: number;
}
export declare class HubClient {
    hostname: string;
    port: number;
    path: string;
    sessionId: string | null;
    connected: boolean;
    agentName: string;
    private autoReconnect;
    private maxRetries;
    private retryCount;
    private log;
    private _closing;
    constructor(opts?: HubClientOptions);
    connect(): Promise<void>;
    private _doConnect;
    callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
    private _reconnectAndRetry;
    register(): Promise<unknown>;
    heartbeat(): Promise<void>;
    poll(): Promise<unknown[]>;
    sendMessage(to: string, subject: string, body: string): Promise<unknown>;
    broadcast(subject: string, body: string): Promise<unknown>;
    memorySet(key: string, value: string, tags?: string[]): Promise<unknown>;
    memoryGet(key: string): Promise<unknown>;
    memorySearch(query: string): Promise<unknown>;
    close(): void;
    private _request;
    private _parseSSE;
}
//# sourceMappingURL=mcp.d.ts.map