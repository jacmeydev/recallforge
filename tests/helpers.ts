import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, genId, getDb } from '@/lib/core/db';

/** Point the shared connection at a brand-new temporary SQLite file. */
export function useFreshDatabase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recallforge-test-'));
  const file = path.join(dir, 'test.db');
  closeDb();
  process.env.RECALLFORGE_DB = file;
  getDb();
  return file;
}

let counter = 0;

/** Insert an extra learner (the core stays multi-user safe even though the app has one local learner). */
export async function createTestUser(timezone = 'UTC') {
  counter++;
  const now = new Date().toISOString();
  const user = { id: genId(), email: `learner${counter}@example.com`, name: `Learner ${counter}`, timezone };
  getDb()
    .prepare(`INSERT INTO users (id, email, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(user.id, user.email, user.name, user.timezone, now, now);
  return { user };
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
