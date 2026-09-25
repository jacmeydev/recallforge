// ============================================================================
// RecallForge — The local learner
// ============================================================================
// RecallForge is a personal tool that runs on your machine: there are no
// accounts or passwords. All data belongs to one local learner, created on
// first use. (The schema keeps user_id columns, so older multi-user databases
// keep working: the oldest account becomes the local learner.)
// ============================================================================

import { getDb, nowIso } from './db';
import type { AuthUser } from './types';

export const LOCAL_USER_ID = 'local';

interface UserRow {
  id: string;
  email: string;
  name: string;
  timezone: string;
  created_at: string;
}

function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, timezone: row.timezone || 'UTC' };
}

/** The single learner that owns this database (created on first use). */
export function getLocalUser(): AuthUser {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM users ORDER BY created_at ASC LIMIT 1`).get() as UserRow | undefined;
  if (existing) return toUser(existing);
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, timezone, created_at, updated_at) VALUES (?, 'local@recallforge', 'Local', ?, ?, ?)`
  ).run(LOCAL_USER_ID, systemTimezone(), now, now);
  return toUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(LOCAL_USER_ID) as UserRow);
}
