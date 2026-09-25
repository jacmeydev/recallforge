import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, getDb } from '@/lib/core/db';
import { registerUser } from '@/lib/core/users';

/** Point the shared connection at a brand-new temporary SQLite file. */
export function useFreshDatabase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recallforge-test-'));
  const file = path.join(dir, 'test.db');
  closeDb();
  process.env.DATABASE_PATH = file;
  getDb();
  return file;
}

let counter = 0;

export async function createTestUser(timezone = 'UTC') {
  counter++;
  return registerUser({
    email: `learner${counter}-${Date.now()}@example.com`,
    password: 'correct-horse-battery',
    name: `Learner ${counter}`,
    timezone,
  });
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
