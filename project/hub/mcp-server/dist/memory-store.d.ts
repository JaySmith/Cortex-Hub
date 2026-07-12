export interface Memory {
    key: string;
    value: string;
    tags: string[];
    agent: string;
    createdAt: string;
    updatedAt: string;
}
export declare function setMemory(key: string, value: string, tags: string[], agent: string): Promise<Memory>;
export declare function setMemorySync(key: string, value: string, tags: string[], agent: string): Memory;
export declare function getMemory(key: string): Promise<Memory | null>;
export declare function deleteMemory(key: string): Promise<boolean>;
export declare function searchMemories(query: string): Promise<Memory[]>;
export declare function listMemoriesByAgent(agent: string): Promise<Memory[]>;
export declare function listAllMemories(): Promise<Memory[]>;
export declare function exportMemories(): Promise<Memory[]>;
export declare function importMemories(memories: Memory[]): Promise<number>;
export declare function closeMemory(): void;
