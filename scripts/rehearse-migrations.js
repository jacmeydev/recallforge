#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const root = process.cwd();
const sourcePath = path.isAbsolute(process.env.DATABASE_PATH || '')
  ? process.env.DATABASE_PATH
  : path.join(root, process.env.DATABASE_PATH || 'data/recallforge.db');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const rehearsalDir = path.join(root, '.tmp', 'migration-rehearsal');
const backupDir = path.join(root, 'data', 'backups');
const rehearsalPath = path.join(rehearsalDir, `recallforge-rehearsal-${timestamp}.db`);
const backupPath = path.join(backupDir, `recallforge-pre-rehearsal-${timestamp}.db`);

fs.mkdirSync(rehearsalDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const db = new Database(sourcePath);
try {
  db.pragma('wal_checkpoint(FULL)');
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

fs.copyFileSync(sourcePath, rehearsalPath);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'src/__tests__/migration-rehearsal.test.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_PATH: rehearsalPath,
      RECALLFORGE_TEST_DB_FIXED: '1',
    },
  }
);

if (result.status !== 0) {
  console.error(`Migration rehearsal failed. Backup: ${backupPath}. Rehearsal DB: ${rehearsalPath}`);
  process.exit(result.status || 1);
}

console.log(`Migration rehearsal passed.`);
console.log(`Backup: ${backupPath}`);
console.log(`Rehearsal DB: ${rehearsalPath}`);
