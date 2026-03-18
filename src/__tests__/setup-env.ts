import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const tempDir = path.join(process.cwd(), '.tmp', 'vitest');
fs.mkdirSync(tempDir, { recursive: true });

if (process.env.RECALLFORGE_TEST_DB_FIXED !== '1') {
  const workerId = process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || randomUUID();
  process.env.DATABASE_PATH = path.join(tempDir, `recallforge-vitest-${process.pid}-${workerId}.db`);
} else if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(tempDir, `recallforge-vitest-fixed-${process.pid}-${randomUUID()}.db`);
}

Reflect.set(process.env, 'NODE_ENV', process.env.NODE_ENV || 'test');
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'recallforge-test-secret';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3030';
process.env.TRUST_HOST = process.env.TRUST_HOST || 'false';

import { runMigrations } from '@/lib/server/db/migrate';

runMigrations();
