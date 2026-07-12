import Database from "better-sqlite3";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { logger } from "./logger.js";

const DATA_DIR = process.env.HUB_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "hub.db");
const CACHE_TTL_MS = parseInt(process.env.HUB_CACHE_TTL_MS || "30000", 10);
const BATCH_WRITE_MS = parseInt(process.env.HUB_BATCH_WRITE_MS || "5000", 10);

export interface Memory {
  key: string;
  value: string;
  tags: string[];
  agent: string;
  createdAt: string;
  updatedAt: string;
}

let db: Database.Database;

class LRUCache<K, V> {
  private max: number;
  private ttl: number;
  private map = new Map<K, { value: V; expiry: number }>();

  constructor(max = 1000, ttl = CACHE_TTL_MS) {
    this.max = max;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next();
      if (oldest.value) this.map.delete(oldest.value);
    }
    this.map.set(key, { value, expiry: Date.now() + this.ttl });
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

const memoryCache = new LRUCache<string, Memory>(2000);
const pendingWrites = new Map<string, Memory>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000");
    db.pragma("busy_timeout = 5000");
    initSchema();
  }
  return db;
}

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent);
  `);
}

function flushBatch(): void {
  if (pendingWrites.size === 0) return;
  const d = getDb();
  const tx = d.transaction(() => {
    const stmt = d.prepare(`
      INSERT INTO memories (key, value, tags, agent, created_at, updated_at)
      VALUES (@key, @value, @tags, @agent, @created_at, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        tags = excluded.tags,
        agent = excluded.agent,
        updated_at = excluded.updated_at
    `);
    for (const mem of pendingWrites.values()) {
      stmt.run({
        key: mem.key,
        value: mem.value,
        tags: JSON.stringify(mem.tags),
        agent: mem.agent,
        created_at: mem.createdAt,
        updated_at: mem.updatedAt,
      });
    }
  });
  const count = pendingWrites.size;
  tx();
  pendingWrites.clear();
  logger.debug({ batchSize: count }, "Flushed memory batch writes");
}

function scheduleBatch(): void {
  if (batchTimer) clearTimeout(batchTimer);
  if (pendingWrites.size > 0) {
    batchTimer = setTimeout(() => flushBatch(), BATCH_WRITE_MS);
  }
}

function syncWrite(key: string, value: string, tags: string[], agent: string): Memory {
  const d = getDb();
  const now = new Date().toISOString();
  const existing = d.prepare("SELECT * FROM memories WHERE key = ?").get(key) as any;
  let mem: Memory;
  if (existing) {
    mem = { key, value, tags, agent, createdAt: existing.created_at, updatedAt: now };
    d.prepare(`
      UPDATE memories SET value = ?, tags = ?, agent = ?, updated_at = ? WHERE key = ?
    `).run(value, JSON.stringify(tags), agent, now, key);
  } else {
    mem = { key, value, tags, agent, createdAt: now, updatedAt: now };
    d.prepare(`
      INSERT INTO memories (key, value, tags, agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(key, value, JSON.stringify(tags), agent, now, now);
  }
  memoryCache.set(key, mem);
  return mem;
}

function rowToMemory(row: any): Memory {
  return {
    key: row.key,
    value: row.value,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags || [],
    agent: row.agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function setMemory(
  key: string,
  value: string,
  tags: string[],
  agent: string,
): Promise<Memory> {
  const now = new Date().toISOString();
  const mem: Memory = { key, value, tags, agent, createdAt: now, updatedAt: now };
  pendingWrites.set(key, mem);
  memoryCache.set(key, mem);
  scheduleBatch();
  return mem;
}

export function setMemorySync(
  key: string,
  value: string,
  tags: string[],
  agent: string,
): Memory {
  return syncWrite(key, value, tags, agent);
}

export async function getMemory(key: string): Promise<Memory | null> {
  const cached = memoryCache.get(key);
  if (cached) return cached;

  const d = getDb();
  const row = d.prepare("SELECT * FROM memories WHERE key = ?").get(key) as any;
  if (!row) return null;

  const mem = rowToMemory(row);
  memoryCache.set(key, mem);
  return mem;
}

export async function deleteMemory(key: string): Promise<boolean> {
  const d = getDb();
  const result = d.prepare("DELETE FROM memories WHERE key = ?").run(key);
  memoryCache.delete(key);
  pendingWrites.delete(key);
  return result.changes > 0;
}

export async function searchMemories(query: string): Promise<Memory[]> {
  const d = getDb();
  const q = `%${query}%`;
  const rows = d
    .prepare(
      "SELECT * FROM memories WHERE key LIKE ? OR value LIKE ? OR tags LIKE ?",
    )
    .all(q, q, q) as any[];
  return rows.map(rowToMemory);
}

export async function listMemoriesByAgent(agent: string): Promise<Memory[]> {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM memories WHERE agent = ?")
    .all(agent) as any[];
  return rows.map(rowToMemory);
}

export async function listAllMemories(): Promise<Memory[]> {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM memories").all() as any[];
  return rows.map(rowToMemory);
}

export async function exportMemories(): Promise<Memory[]> {
  return listAllMemories();
}

export async function importMemories(memories: Memory[]): Promise<number> {
  const d = getDb();
  const tx = d.transaction(() => {
    const stmt = d.prepare(`
      INSERT INTO memories (key, value, tags, agent, created_at, updated_at)
      VALUES (@key, @value, @tags, @agent, @created_at, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        tags = excluded.tags,
        agent = excluded.agent,
        updated_at = excluded.updated_at
    `);
    for (const m of memories) {
      stmt.run({
        key: m.key,
        value: m.value,
        tags: JSON.stringify(m.tags || []),
        agent: m.agent,
        created_at: m.createdAt || new Date().toISOString(),
        updated_at: m.updatedAt || new Date().toISOString(),
      });
    }
  });
  tx();
  return (d.prepare("SELECT COUNT(*) as cnt FROM memories").get() as any).cnt;
}

export function closeMemory(): void {
  if (batchTimer) clearTimeout(batchTimer);
  if (pendingWrites.size > 0) flushBatch();
  if (db) {
    db.close();
    db = undefined!;
  }
}
