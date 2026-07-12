import Database from "better-sqlite3";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { logger } from "./logger.js";

const DATA_DIR = process.env.HUB_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "hub.db");
const HUB_AGENT_TIMEOUT_MS = parseInt(
  process.env.HUB_AGENT_TIMEOUT_MS || "300000",
  10,
);
const SERVER_START_TIME = Date.now();

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
  capabilities?: Array<{ name: string; version: string }>;
}

export interface SkillManifestEntry {
  role: string;
  description?: string;
  required: Array<{ name: string; version: string }>;
  optional: Array<{ name: string; version: string }>;
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    initSchema();
  }
  return db;
}

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      hostname TEXT NOT NULL DEFAULT 'unknown',
      last_seen TEXT NOT NULL,
      capabilities TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      parent_message_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
    CREATE INDEX IF NOT EXISTS idx_messages_from_to ON messages(from_agent, to_agent);
    CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_agent, is_read);

    CREATE TABLE IF NOT EXISTS skill_manifest (
      role TEXT PRIMARY KEY,
      description TEXT,
      required TEXT NOT NULL DEFAULT '[]',
      optional TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

function isAgentOnline(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() < HUB_AGENT_TIMEOUT_MS;
}

function mapAgent(row: any): AgentRecord {
  return {
    name: row.name,
    hostname: row.hostname,
    lastSeen: row.last_seen,
    online: isAgentOnline(row.last_seen),
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    from: row.from_agent,
    to: row.to_agent,
    subject: row.subject,
    body: row.body,
    createdAt: row.created_at,
    read: row.is_read === 1,
    parentMessageId: row.parent_message_id || undefined,
  };
}

export async function registerAgent(
  name: string,
  hostname: string,
): Promise<AgentRecord> {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO agents (name, hostname, last_seen)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       hostname = excluded.hostname,
       last_seen = excluded.last_seen`,
  ).run(name, hostname, now);
  logger.info({ agent: name, hostname }, "Agent registered");
  return mapAgent(
    d.prepare("SELECT * FROM agents WHERE name = ?").get(name),
  );
}

export async function listAgents(): Promise<AgentRecord[]> {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM agents").all() as any[];
  return rows.map(mapAgent);
}

export async function deregisterAgent(name: string): Promise<boolean> {
  const d = getDb();
  const result = d.prepare("DELETE FROM agents WHERE name = ?").run(name);
  if (result.changes > 0) {
    logger.info({ agent: name }, "Agent deregistered");
    return true;
  }
  return false;
}

export async function getAgent(name: string): Promise<AgentRecord | null> {
  const d = getDb();
  const row = d.prepare("SELECT * FROM agents WHERE name = ?").get(name) as any;
  return row ? mapAgent(row) : null;
}

export async function sendMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  parentMessageId?: string,
): Promise<Message> {
  const d = getDb();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO messages (id, from_agent, to_agent, subject, body, created_at, parent_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, from, to, subject, body, now, parentMessageId || null);
  return mapMessage(d.prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export async function pollMessages(agentName: string): Promise<Message[]> {
  const d = getDb();
  const rows = d
    .prepare(
      "SELECT * FROM messages WHERE to_agent = ? AND is_read = 0 ORDER BY created_at ASC",
    )
    .all(agentName) as any[];
  return rows.map(mapMessage);
}

export async function markRead(messageId: string): Promise<boolean> {
  const d = getDb();
  const result = d
    .prepare("UPDATE messages SET is_read = 1 WHERE id = ?")
    .run(messageId);
  return result.changes > 0;
}

export async function getInbox(agentName: string): Promise<Message[]> {
  const d = getDb();
  const rows = d
    .prepare(
      "SELECT * FROM messages WHERE to_agent = ? ORDER BY created_at DESC",
    )
    .all(agentName) as any[];
  return rows.map(mapMessage);
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const d = getDb();
  const result = d.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
  return result.changes > 0;
}

export async function getConversation(
  agentA: string,
  agentB: string,
): Promise<Message[]> {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT * FROM messages
       WHERE (from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?)
       ORDER BY created_at ASC`,
    )
    .all(agentA, agentB, agentB, agentA) as any[];
  return rows.map(mapMessage);
}

export async function getStats(): Promise<{
  uptime: number;
  agents: number;
  messages: number;
  unread: number;
}> {
  const d = getDb();
  const agents = (d.prepare("SELECT COUNT(*) as cnt FROM agents").get() as any).cnt;
  const messages = (d.prepare("SELECT COUNT(*) as cnt FROM messages").get() as any).cnt;
  const unread = (
    d.prepare("SELECT COUNT(*) as cnt FROM messages WHERE is_read = 0").get() as any
  ).cnt;
  return {
    uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    agents,
    messages,
    unread,
  };
}

export async function setAgentCapabilities(
  agentName: string,
  capabilities: Array<{ name: string; version: string }>,
): Promise<Array<{ name: string; version: string }>> {
  const d = getDb();
  d.prepare("UPDATE agents SET capabilities = ? WHERE name = ?").run(
    JSON.stringify(capabilities),
    agentName,
  );
  return capabilities;
}

export async function getAgentCapabilities(
  agentName: string,
): Promise<Array<{ name: string; version: string }>> {
  const d = getDb();
  const row = d
    .prepare("SELECT capabilities FROM agents WHERE name = ?")
    .get(agentName) as any;
  return row ? JSON.parse(row.capabilities || "[]") : [];
}

export async function getSkillManifest(): Promise<SkillManifestEntry[]> {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM skill_manifest").all() as any[];
  return rows.map((r: any) => ({
    role: r.role,
    description: r.description,
    required: JSON.parse(r.required || "[]"),
    optional: JSON.parse(r.optional || "[]"),
  }));
}

export async function setSkillManifest(
  manifest: SkillManifestEntry[],
): Promise<SkillManifestEntry[]> {
  const d = getDb();
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM skill_manifest").run();
    const stmt = d.prepare(
      `INSERT INTO skill_manifest (role, description, required, optional)
       VALUES (?, ?, ?, ?)`,
    );
    for (const entry of manifest) {
      stmt.run(
        entry.role,
        entry.description || null,
        JSON.stringify(entry.required || []),
        JSON.stringify(entry.optional || []),
      );
    }
  });
  tx();
  return manifest;
}

export async function checkAgentReadiness(agentName: string): Promise<{
  ready: boolean;
  role: string | null;
  missing: Array<{ name: string; version: string }>;
  extra: Array<{ name: string; version: string }>;
}> {
  const d = getDb();
  const agent = d
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(agentName) as any;
  if (!agent) {
    return { ready: false, role: null, missing: [], extra: [] };
  }

  const manifests = d.prepare("SELECT * FROM skill_manifest").all() as any[];
  const manifestEntry = manifests.find(
    (m: any) => agentName.includes(m.role) || m.role === agentName,
  );
  if (!manifestEntry) {
    const caps = agent.capabilities ? JSON.parse(agent.capabilities) : [];
    return { ready: true, role: null, missing: [], extra: caps };
  }

  const agentCaps: Array<{ name: string; version: string }> = agent.capabilities
    ? JSON.parse(agent.capabilities)
    : [];
  const required: Array<{ name: string; version: string }> = JSON.parse(
    manifestEntry.required || "[]",
  );
  const optional: Array<{ name: string; version: string }> = JSON.parse(
    manifestEntry.optional || "[]",
  );

  const missing = required.filter(
    (req) => !agentCaps.some((ac) => ac.name === req.name),
  );
  const extra = agentCaps.filter(
    (ac) =>
      !required.some((r) => r.name === ac.name) &&
      !optional.some((o) => o.name === ac.name),
  );

  return {
    ready: missing.length === 0,
    role: manifestEntry.role,
    missing,
    extra,
  };
}

export function closeMessageQueue(): void {
  if (db) {
    db.close();
    db = undefined!;
  }
}
