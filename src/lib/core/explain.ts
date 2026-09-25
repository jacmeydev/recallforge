// ============================================================================
// RecallForge — "Explain this"
// ============================================================================
// RecallForge never generates text itself. explainCard() gathers everything an
// agent (or the learner) needs to explain a card faithfully: the card, the
// exact source excerpt, the surrounding source text, the learner's recent
// attempts and related cards of the same subject. The agent writes the
// explanation from that material; the web UI shows the material directly.
// ============================================================================

import { getDb } from './db';
import { CARD_SELECT, getCardRow, toCard } from './cards';
import { getSettings } from './settings';
import { containsLoosely, contentWords, similarity } from './text';
import type { Card, CardRow, Rating } from './types';

/** Characters of source text returned around the excerpt. */
const CONTEXT_CHARS = 3000;

export interface Explanation {
  card: Card;
  source: {
    documentId: string;
    documentTitle: string | null;
    part: number | null;
    label: string | null;
    /** The exact passage the card is based on, when it was recorded. */
    excerpt: string;
    /** Source text around the excerpt (or the start of the part). */
    context: string;
    excerptFound: boolean;
  } | null;
  recentAttempts: Array<{ reviewedAt: string; rating: Rating; answer: string | null; format: string; mode: string }>;
  /** Cards of the same subject about the same terms: useful to contrast or connect. */
  related: Array<{ id: string; front: string; back: string }>;
  /** Instructions for the agent writing the explanation. */
  guidance: string;
}

const GUIDANCE =
  'Explain from the card, its explanation and the source context above; quote the source when it answers the question. ' +
  'If the source does not support something you add from general knowledge, say so explicitly. ' +
  'Address the mistakes visible in recentAttempts. Do not change the card: if it is wrong or unclear, propose an edit and let the learner decide.';

function contextAround(text: string, excerpt: string): { context: string; found: boolean } {
  if (!excerpt) return { context: text.slice(0, CONTEXT_CHARS), found: false };
  const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();
  const haystack = normalize(text);
  const at = haystack.indexOf(normalize(excerpt));
  const flat = text.replace(/\s+/g, ' ');
  if (at < 0) return { context: text.slice(0, CONTEXT_CHARS), found: containsLoosely(text, excerpt) };
  const start = Math.max(0, at - Math.floor((CONTEXT_CHARS - excerpt.length) / 2));
  return { context: `${start > 0 ? '…' : ''}${flat.slice(start, start + CONTEXT_CHARS)}${start + CONTEXT_CHARS < flat.length ? '…' : ''}`, found: true };
}

export function explainCard(userId: string, cardId: string, now = new Date()): Explanation {
  const db = getDb();
  const row = getCardRow(userId, cardId);

  let source: Explanation['source'] = null;
  if (row.document_id) {
    const part =
      row.document_part == null
        ? undefined
        : (db
            .prepare(`SELECT label, text FROM document_parts WHERE document_id = ? AND idx = ?`)
            .get(row.document_id, row.document_part) as { label: string; text: string } | undefined);
    const { context, found } = part ? contextAround(part.text, row.excerpt) : { context: '', found: false };
    source = {
      documentId: row.document_id,
      documentTitle: row.document_title ?? null,
      part: row.document_part,
      label: part?.label ?? null,
      excerpt: row.excerpt,
      context,
      excerptFound: found,
    };
  }

  const attempts = db
    .prepare(
      `SELECT reviewed_at, rating, answer, format, mode FROM review_logs
       WHERE user_id = ? AND card_id = ? ORDER BY reviewed_at DESC LIMIT 5`
    )
    .all(userId, cardId) as Array<{ reviewed_at: string; rating: Rating; answer: string | null; format: string; mode: string }>;

  const words = new Set(contentWords(`${row.front} ${row.back}`));
  const siblings = db
    .prepare(`${CARD_SELECT} WHERE c.user_id = ? AND c.deck_id = ? AND c.id != ? AND c.status = 'active' LIMIT 2000`)
    .all(userId, row.deck_id, cardId) as CardRow[];
  const related = siblings
    .map((card) => ({ card, score: similarity(words, new Set(contentWords(`${card.front} ${card.back}`))) }))
    .filter(({ score }) => score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ card }) => ({ id: card.id, front: card.front, back: card.back }));

  return {
    card: toCard(row, getSettings(userId), now),
    source,
    recentAttempts: attempts.map((a) => ({ reviewedAt: a.reviewed_at, rating: a.rating, answer: a.answer, format: a.format, mode: a.mode })),
    related,
    guidance: GUIDANCE,
  };
}
