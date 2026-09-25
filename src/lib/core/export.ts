// ============================================================================
// RecallForge — Full data export (backup / portability)
// ============================================================================
// JSON: everything needed to rebuild the collection elsewhere (subjects, exam
// dates, documents with their text, cards with their full memory state, every
// review and every edit). importData() restores it.
// TSV: plain "front ⇥ back ⇥ deck ⇥ tags" that Anki and spreadsheets open.
// ============================================================================

import { getDb } from './db';
import { CARD_SELECT, toCard } from './cards';
import { deckScopeSql, listDecks } from './decks';
import { getSettings } from './settings';
import type { CardRow } from './types';

export const EXPORT_FORMAT = 'recallforge-export';
export const EXPORT_VERSION = 3;

export function exportUserData(userId: string) {
  const db = getDb();
  const settings = getSettings(userId);
  const cards = (db.prepare(`${CARD_SELECT} WHERE c.user_id = ? ORDER BY c.created_at, c.rowid`).all(userId) as CardRow[]).map(
    (row) => ({
      ...toCard(row, settings),
      fsrs: {
        stability: row.stability,
        difficulty: row.difficulty,
        elapsedDays: row.elapsed_days,
        scheduledDays: row.scheduled_days,
        learningSteps: row.learning_steps,
      },
    })
  );
  const documents = (
    db
      .prepare(
        `SELECT doc.id, doc.title, doc.filename, doc.mime_type AS mimeType, d.name AS deck,
                doc.created_at AS createdAt, doc.updated_at AS updatedAt
         FROM documents doc LEFT JOIN decks d ON d.id = doc.deck_id WHERE doc.user_id = ? ORDER BY doc.created_at`
      )
      .all(userId) as Array<{ id: string }>
  ).map((doc) => ({
    ...doc,
    parts: db.prepare(`SELECT label, text FROM document_parts WHERE document_id = ? ORDER BY idx`).all(doc.id),
  }));
  const reviewLogs = db
    .prepare(
      `SELECT id, card_id AS cardId, reviewed_at AS reviewedAt, rating, state, next_state AS nextState,
              due_at AS dueAt, next_due_at AS nextDueAt, stability, next_stability AS nextStability,
              difficulty, next_difficulty AS nextDifficulty, elapsed_days AS elapsedDays,
              scheduled_days AS scheduledDays, duration_ms AS durationMs, answer, feedback, source,
              mode, format, snapshot
       FROM review_logs WHERE user_id = ? ORDER BY reviewed_at`
    )
    .all(userId);
  const revisions = (
    db
      .prepare(
        `SELECT id, card_id AS cardId, changed_at AS changedAt, source, reason, before, after
         FROM card_revisions WHERE user_id = ? ORDER BY changed_at`
      )
      .all(userId) as Array<{ before: string; after: string }>
  ).map((row) => ({ ...row, before: JSON.parse(row.before), after: JSON.parse(row.after) }));

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    decks: listDecks(userId).map(({ id, name, description, examDate, createdAt, updatedAt }) => ({
      id,
      name,
      description,
      examDate,
      createdAt,
      updatedAt,
    })),
    documents,
    cards,
    reviewLogs,
    revisions,
  };
}

const tsvField = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim();

/** Tab-separated cards (Anki "Notes in Plain Text" headers), optionally one subject. */
export function exportCardsTsv(userId: string, deck?: string): string {
  const where = ['c.user_id = @userId', `c.status = 'active'`];
  const params: Record<string, unknown> = { userId };
  if (deck) {
    const scope = deckScopeSql(userId, deck);
    where.push(scope.sql);
    Object.assign(params, scope.params);
  }
  const rows = getDb()
    .prepare(`${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.name, c.created_at, c.rowid`)
    .all(params) as CardRow[];
  const lines = ['#separator:tab', '#html:false', '#columns:front\tback\tdeck\ttags\texplanation\tsource', '#deck column:3', '#tags column:4'];
  for (const row of rows) {
    const tags = (JSON.parse(row.tags) as string[]).map((tag) => tag.replace(/\s+/g, '_')).join(' ');
    lines.push([row.front, row.back, row.deck_name, tags, row.explanation, row.source].map(tsvField).join('\t'));
  }
  return `${lines.join('\n')}\n`;
}
