export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Agent API: Pending Items
// ============================================================================
// GET /api/agent/pending
// Returns high-priority pending reviews, overdue cards, AI cards pending review,
// and hard topics — exactly what UniBot/OpenClaw needs to push notifications.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

export async function GET(req: NextRequest) {
  ensureMigrated();

  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { user } = authResult;

  const nowIso = new Date().toISOString();

  // Overdue card count
  const overdueResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM cards
    WHERE user_id = ? AND due_at < ? AND state != 'new'
      AND suspended = 0 AND deleted_at IS NULL
  `).get(user.id, nowIso) as { count: number };

  // New cards available today
  const newResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM cards
    WHERE user_id = ? AND state = 'new'
      AND suspended = 0 AND deleted_at IS NULL
  `).get(user.id) as { count: number };

  // Cards with high lapse count (leeches / hard topics)
  const hardResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM cards
    WHERE user_id = ? AND lapses >= 3
      AND suspended = 0 AND deleted_at IS NULL
  `).get(user.id) as { count: number };

  // AI-imported cards pending review (source = 'ai-import' on the note)
  const aiPendingResult = sqlite.prepare(`
    SELECT COUNT(DISTINCT c.id) as count FROM cards c
    JOIN notes n ON c.note_id = n.id
    WHERE c.user_id = ? AND n.source = 'ai-import' AND c.state = 'new'
      AND c.suspended = 0 AND c.deleted_at IS NULL AND n.deleted_at IS NULL
  `).get(user.id) as { count: number };

  // Decks with overdue cards (available scopes for study)
  const studyScopes = sqlite.prepare(`
    SELECT d.id, d.name, COUNT(c.id) as overdue_count
    FROM decks d
    JOIN cards c ON c.deck_id = d.id
    WHERE d.user_id = ? AND c.due_at < ? AND c.state != 'new'
      AND c.suspended = 0 AND c.deleted_at IS NULL AND d.deleted_at IS NULL
    GROUP BY d.id
    ORDER BY overdue_count DESC
    LIMIT 20
  `).all(user.id, nowIso) as Array<{ id: string; name: string; overdue_count: number }>;

  // Latest personal summary (if exists)
  const latestSummary = sqlite.prepare(`
    SELECT * FROM personal_summaries
    WHERE user_id = ?
    ORDER BY generated_at DESC LIMIT 1
  `).get(user.id) as Record<string, unknown> | undefined;

  let parsedSummary = null;
  if (latestSummary) {
    parsedSummary = {
      period: latestSummary.period,
      date: latestSummary.date,
      xpEarned: latestSummary.xp_earned,
      streakDays: latestSummary.streak_days,
      highPriorityPending: latestSummary.high_priority_pending,
      hardTopicsCount: latestSummary.hard_topics_count,
      aiCardsPendingReview: latestSummary.ai_cards_pending_review,
      questsCompleted: latestSummary.quests_completed,
    };
  }

  return NextResponse.json({
    userId: user.id,
    timestamp: nowIso,
    overdue: overdueResult.count,
    newAvailable: newResult.count,
    hardTopics: hardResult.count,
    aiPendingReview: aiPendingResult.count,
    studyScopes,
    latestSummary: parsedSummary,
  });
}
