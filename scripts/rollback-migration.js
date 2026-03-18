#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupArg = process.argv[2];
const targetPath = path.isAbsolute(process.env.DATABASE_PATH || '')
  ? process.env.DATABASE_PATH
  : path.join(root, process.env.DATABASE_PATH || 'data/recallforge.db');
const backupDir = path.join(root, 'data', 'backups');

function latestBackup() {
  const candidates = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir)
        .filter((entry) => entry.endsWith('.db'))
        .map((entry) => path.join(backupDir, entry))
        .sort()
    : [];
  return candidates[candidates.length - 1];
}

const backupPath = backupArg
  ? (path.isAbsolute(backupArg) ? backupArg : path.join(root, backupArg))
  : latestBackup();

if (!backupPath || !fs.existsSync(backupPath)) {
  console.error('No backup found to restore.');
  process.exit(1);
}

fs.copyFileSync(backupPath, targetPath);
console.log(`Restored ${targetPath} from ${backupPath}`);
