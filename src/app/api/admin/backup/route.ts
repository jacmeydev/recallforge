export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Admin Backup API
// ============================================================================
// GET  /api/admin/backup         → Download full SQLite DB backup
// POST /api/admin/backup/verify  → Verify backup integrity
//
// Protected: requires authenticated session (no API key access).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/server/auth';
import { sqlite } from '@/lib/server/db';
import { logger } from '@/lib/server/logger';
import path from 'path';
import fs from 'fs';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `recallforge-backup-${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, backupFilename);

    // Use SQLite VACUUM INTO for a consistent, compact backup
    sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    // Read backup file and stream it
    const backupData = fs.readFileSync(backupPath);

    // Clean up the temp backup file (user gets it as download)
    fs.unlinkSync(backupPath);

    logger.info('Database backup created', { userId: session.user.id, size: backupData.length });

    return new NextResponse(backupData, {
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="${backupFilename}"`,
        'Content-Length': String(backupData.length),
      },
    });
  } catch (err) {
    logger.error('Backup failed', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    // Quick integrity check on current DB
    const integrityResult = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const isOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok';

    // Count records for a basic sanity check
    const tables = ['users', 'decks', 'notes', 'cards', 'review_logs'] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const row = sqlite.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as { count: number };
        counts[table] = row.count;
      } catch {
        counts[table] = -1; // table might not exist yet
      }
    }

    // DB file size
    const dbPath = process.env.DATABASE_PATH
      ? (path.isAbsolute(process.env.DATABASE_PATH) ? process.env.DATABASE_PATH : path.join(process.cwd(), process.env.DATABASE_PATH))
      : path.join(process.cwd(), 'data', 'recallforge.db');
    const stats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;

    logger.info('Backup verify', { userId: session.user.id, integrity: isOk });

    return NextResponse.json({
      integrity: isOk ? 'ok' : 'issues_detected',
      integrityDetails: integrityResult,
      recordCounts: counts,
      dbSizeBytes: stats?.size || 0,
      walMode: (sqlite.pragma('journal_mode') as Array<{ journal_mode: string }>)[0]?.journal_mode,
    });
  } catch (err) {
    logger.error('Backup verify failed', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
