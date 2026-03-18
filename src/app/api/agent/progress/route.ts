export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Academic Progress
// ============================================================================
// GET /api/agent/progress
//   ?scope=program|subject   (what level to report at)
//   &programId=xxx           (optional filter)
//   &subjectId=xxx           (optional filter)
// Returns curriculum progress with card statistics per academic entity.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

interface ProgressEntry {
  entityId: string;
  entityName: string;
  totalCards: number;
  newCards: number;
  matureCards: number;
  overdueCards: number;
}

export async function GET(req: NextRequest) {
  ensureMigrated();

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope') || 'subject';
  const programId = searchParams.get('programId');

  const nowIso = new Date().toISOString();

  if (scope === 'program') {
    // List programs with aggregate card stats
    const programs = sqlite.prepare(`
      SELECT id, name, description, career, year, semester
      FROM curriculum_programs
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY name
    `).all(user.id) as Array<Record<string, unknown>>;

    const progress: ProgressEntry[] = programs.map(p => {
      const stats = sqlite.prepare(`
        SELECT
          COUNT(c.id) as total_cards,
          SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_cards,
          SUM(CASE WHEN c.state = 'review' AND c.reps >= 3 THEN 1 ELSE 0 END) as mature_cards,
          SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue_cards
        FROM cards c
        JOIN curriculum_links cl ON cl.card_id = c.id OR cl.deck_id = c.deck_id
        WHERE cl.program_id = ? AND cl.user_id = ? AND c.deleted_at IS NULL
      `).get(nowIso, p.id, user.id) as Record<string, number> | undefined;

      return {
        entityId: p.id as string,
        entityName: p.name as string,
        totalCards: stats?.total_cards ?? 0,
        newCards: stats?.new_cards ?? 0,
        matureCards: stats?.mature_cards ?? 0,
        overdueCards: stats?.overdue_cards ?? 0,
      };
    });

    return NextResponse.json({ scope: 'program', progress, userId: user.id });
  }

  // Default: subject-level
  let query = `
    SELECT id, name, code, program_id
    FROM curriculum_subjects
    WHERE user_id = ? AND deleted_at IS NULL
  `;
  const params: unknown[] = [user.id];

  if (programId) {
    query += ` AND program_id = ?`;
    params.push(programId);
  }
  query += ` ORDER BY sort_order, name`;

  const subjects = sqlite.prepare(query).all(...params) as Array<Record<string, unknown>>;

  const progress: ProgressEntry[] = subjects.map(s => {
    const stats = sqlite.prepare(`
      SELECT
        COUNT(c.id) as total_cards,
        SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_cards,
        SUM(CASE WHEN c.state = 'review' AND c.reps >= 3 THEN 1 ELSE 0 END) as mature_cards,
        SUM(CASE WHEN c.due_at < ? AND c.state != 'new' THEN 1 ELSE 0 END) as overdue_cards
      FROM cards c
      JOIN curriculum_links cl ON cl.card_id = c.id OR cl.deck_id = c.deck_id
      WHERE cl.subject_id = ? AND cl.user_id = ? AND c.deleted_at IS NULL
    `).get(nowIso, s.id, user.id) as Record<string, number> | undefined;

    return {
      entityId: s.id as string,
      entityName: s.name as string,
      totalCards: stats?.total_cards ?? 0,
      newCards: stats?.new_cards ?? 0,
      matureCards: stats?.mature_cards ?? 0,
      overdueCards: stats?.overdue_cards ?? 0,
    };
  });

  return NextResponse.json({ scope: 'subject', progress, userId: user.id });
}
