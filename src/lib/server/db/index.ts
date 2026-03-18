// ============================================================================
// RecallForge — Server Database Connection (Drizzle + better-sqlite3)
// ============================================================================

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

// Resolve DB path from env or default
const dbPath = process.env.DATABASE_PATH || 'data/recallforge.db';
const DB_PATH = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Performance pragmas
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const serverDb = drizzle(sqlite, { schema });
export { sqlite };
export { DB_PATH };
export type ServerDB = typeof serverDb;
