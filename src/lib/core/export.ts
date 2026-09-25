// ============================================================================
// RecallForge — Full data export (backup / portability)
// ============================================================================

import { getDb } from './db';
import { CARD_SELECT, toCard } from './cards';
import { listDecks } from './decks';
import { getSettings } from './settings';
import type { CardRow } from './types';

export function exportUserData(userId: string) {
  const db = getDb();
  const settings = getSettings(userId);
  const cards = (db.prepare(`${CARD_SELECT} WHERE c.user_id = ? ORDER BY c.created_at`).all(userId) as CardRow[]).map(
    (row) => ({
      ...toCard(row, settings),
      fsrs: {
        elapsedDays: row.elapsed_days,
        scheduledDays: row.scheduled_days,
        learningSteps: row.learning_steps,
      },
    })
  );
  const reviewLogs = db
    .prepare(
      `SELECT id, card_id AS cardId, reviewed_at AS reviewedAt, rating, state, next_state AS nextState,
              due_at AS dueAt, next_due_at AS nextDueAt, stability, next_stability AS nextStability,
              difficulty, next_difficulty AS nextDifficulty, elapsed_days AS elapsedDays,
              scheduled_days AS scheduledDays, duration_ms AS durationMs, answer, feedback, source
       FROM review_logs WHERE user_id = ? ORDER BY reviewed_at`
    )
    .all(userId);

  return {
    format: 'recallforge-export',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    decks: listDecks(userId).map(({ counts: _counts, ...deck }) => deck),
    cards,
    reviewLogs,
  };
}
