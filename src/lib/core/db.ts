// ============================================================================
// RecallForge — SQLite connection
// ============================================================================
// A single local SQLite file is the source of truth. The connection is opened
// lazily (so tests can point RECALLFORGE_DB elsewhere first) and migrations run
// once per connection.
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations } from './migrations';
import { openSqlite, type SqliteDatabase } from './sqlite';

export type DB = SqliteDatabase;

const globalForDb = globalThis as unknown as { __recallforgeDb?: DB };

/**
 * Where your data lives. Default: ~/.recallforge/recallforge.db, shared by the
 * web app and every agent. Override with RECALLFORGE_DB (or DATABASE_PATH).
 */
export function resolveDatabasePath(): string {
  const raw =
    process.env.RECALLFORGE_DB ||
    process.env.DATABASE_PATH ||
    (process.env.RECALLFORGE_DIR ? path.join(process.env.RECALLFORGE_DIR.replace(/^~(?=$|[\\/])/, os.homedir()), 'recallforge.db') : '');
  if (!raw) return path.join(os.homedir(), '.recallforge', 'recallforge.db');
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function openDatabase(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__recallforgeDb) {
    globalForDb.__recallforgeDb = openDatabase(resolveDatabasePath());
  }
  return globalForDb.__recallforgeDb;
}

/** Close the shared connection (tests, graceful shutdown). */
export function closeDb(): void {
  globalForDb.__recallforgeDb?.close();
  globalForDb.__recallforgeDb = undefined;
}

/** Consistent copy of the database to another file (safe while it is in use). */
export function backupDatabase(target: string): void {
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}

export function genId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
