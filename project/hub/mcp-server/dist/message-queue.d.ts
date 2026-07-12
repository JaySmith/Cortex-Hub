export interface Message {
    id: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    createdAt: string;
    read: boolean;
    parentMessageId?: string;
}
export interface AgentRecord {
    name: string;
    hostname: string;
    lastSeen: string;
    online: boolean;
    capabilities?: Array<{
        name: string;
        version: string;
    }>;
}
export interface SkillManifestEntry {
    role: string;
    description?: string;
    required: Array<{
        name: string;
        version: string;
    }>;
    optional: Array<{
        name: string;
        version: string;
    }>;
}
export declare function registerAgent(name: string, hostname: string): Promise<AgentRecord>;
export declare function listAgents(): Promise<AgentRecord[]>;
export declare function deregisterAgent(name: string): Promise<boolean>;
export declare function getAgent(name: string): Promise<AgentRecord | null>;
export declare function sendMessage(from: string, to: string, subject: string, body: string, parentMessageId?: string): Promise<Message>;
export declare function pollMessages(agentName: string): Promise<Message[]>;
export declare function markRead(messageId: string): Promise<boolean>;
export declare function getInbox(agentName: string): Promise<Message[]>;
export declare function deleteMessage(messageId: string): Promise<boolean>;
export declare function getConversation(agentA: string, agentB: string): Promise<Message[]>;
export declare function getStats(): Promise<{
    uptime: number;
    agents: number;
    messages: number;
    unread: number;
}>;
export declare function setAgentCapabilities(agentName: string, capabilities: Array<{
    name: string;
    version: string;
}>): Promise<Array<{
    name: string;
    version: string;
}>>;
export declare function getAgentCapabilities(agentName: string): Promise<Array<{
    name: string;
    version: string;
}>>;
export declare function getSkillManifest(): Promise<SkillManifestEntry[]>;
export declare function setSkillManifest(manifest: SkillManifestEntry[]): Promise<SkillManifestEntry[]>;
export declare function checkAgentReadiness(agentName: string): Promise<{
    ready: boolean;
    role: string | null;
    missing: Array<{
        name: string;
        version: string;
    }>;
    extra: Array<{
        name: string;
        version: string;
    }>;
}>;
export declare function closeMessageQueue(): void;
