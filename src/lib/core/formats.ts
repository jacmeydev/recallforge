// ============================================================================
// RecallForge — Question formats
// ============================================================================
//   recall           answer from memory, graded again/hard/good/easy (FSRS)
//   typing           same, typed; the server reports whether it matches exactly
//   multiple_choice  pick the answer among real answers of the same subject
//   true_false       judge whether a stated answer is right
// Multiple choice and true/false test recognition, not recall, so they are
// practice: logged, but they never move a card in the spaced-repetition
// schedule. Distractors are real answers from the learner's own cards.
// ============================================================================

import { getDb } from './db';
import { answerOf, questionOf } from './cards';
import { DECK_SEPARATOR } from './decks';
import { containsLoosely } from './text';
import type { CardRow } from './types';

export type QuestionFormat = 'recall' | 'typing' | 'multiple_choice' | 'true_false';
export const QUESTION_FORMATS: readonly QuestionFormat[] = ['recall', 'typing', 'multiple_choice', 'true_false'];

export function isPracticeFormat(format: QuestionFormat | undefined): boolean {
  return format === 'multiple_choice' || format === 'true_false';
}

export interface Presentation {
  format: QuestionFormat;
  /** multiple_choice: options to pick from (one is the answer). */
  choices?: string[];
  /** true_false: "front → statement"; the learner says whether it is right. */
  statement?: string;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Answers of other cards in the same deck first, then the same top-level subject. */
function distractors(card: CardRow, count: number): string[] {
  const db = getDb();
  const root = card.deck_name.split(DECK_SEPARATOR)[0];
  const params = {
    userId: card.user_id,
    id: card.id,
    deckId: card.deck_id,
    noteId: card.note_id ?? '',
    root,
    rootLength: root.length + DECK_SEPARATOR.length,
    rootPrefix: `${root}${DECK_SEPARATOR}`,
  };
  const base = `SELECT c.front, c.back, c.kind, c.cloze_ord, c.deck_id = @deckId AS same_deck FROM cards c
    WHERE c.user_id = @userId AND c.id != @id AND c.status = 'active' AND (c.note_id IS NULL OR c.note_id != @noteId)`;
  // Same deck first (small, indexed); the whole subject only when the deck is too small.
  let raw = db.prepare(`${base} AND c.deck_id = @deckId ORDER BY random() LIMIT 80`).all(params);
  if (raw.length < count * 4) {
    raw = raw.concat(
      db
        .prepare(
          `${base} AND c.deck_id != @deckId AND c.deck_id IN (
             SELECT d.id FROM decks d WHERE d.user_id = @userId AND (d.name = @root OR substr(d.name, 1, @rootLength) = @rootPrefix))
           ORDER BY random() LIMIT 120`
        )
        .all(params)
    );
  }
  const rows = raw.map((row) => ({ ...(row as { same_deck: number }), back: answerOf(row as CardRow) })) as Array<{
    back: string;
    same_deck: number;
  }>;

  const picked: string[] = [];
  // Prefer answers of similar length so the right one does not stand out.
  const answer = answerOf(card);
  const question = questionOf(card);
  const target = answer.length;
  const candidates = rows
    // Never offer something already visible in the question (it would give the answer away).
    .filter((row) => row.back && !containsLoosely(row.back, answer) && !containsLoosely(answer, row.back) && !containsLoosely(question, row.back))
    .sort((a, b) => b.same_deck - a.same_deck || Math.abs(a.back.length - target) - Math.abs(b.back.length - target));
  for (const row of candidates) {
    if (picked.some((existing) => containsLoosely(existing, row.back))) continue;
    picked.push(row.back);
    if (picked.length === count) break;
  }
  return picked;
}

export function present(card: CardRow, format: QuestionFormat = 'recall'): Presentation {
  if (format === 'multiple_choice') {
    return { format, choices: shuffle([answerOf(card), ...distractors(card, 3)]) };
  }
  if (format === 'true_false') {
    const [wrong] = distractors(card, 1);
    const showCorrect = !wrong || Math.random() < 0.5;
    return { format, statement: showCorrect ? answerOf(card) : wrong };
  }
  return { format };
}

export interface FormatCheck {
  correct: boolean;
  /** What the learner chose or judged, echoed back for transparency. */
  given: string;
  expected: string;
}

/**
 * Objective check for practice formats (and an exact-match hint for typing).
 * Returns null when the format needs a judgement (recall).
 */
export function checkFormatAnswer(
  card: CardRow,
  input: { format?: QuestionFormat; choice?: string; statement?: string; answerTrue?: boolean; answer?: string }
): FormatCheck | null {
  const exact = (a: string, b: string) => containsLoosely(a, b) && containsLoosely(b, a);
  const back = answerOf(card);
  switch (input.format) {
    case 'multiple_choice':
      if (input.choice === undefined) return null;
      return { correct: exact(input.choice, back), given: input.choice, expected: back };
    case 'true_false': {
      if (input.statement === undefined || input.answerTrue === undefined) return null;
      const statementIsTrue = exact(input.statement, back);
      return {
        correct: input.answerTrue === statementIsTrue,
        given: `${input.answerTrue ? 'true' : 'false'}: ${input.statement}`,
        expected: statementIsTrue ? `true (${back})` : `false — the answer is ${back}`,
      };
    }
    case 'typing':
      if (!input.answer) return null;
      return { correct: exact(input.answer, back), given: input.answer, expected: back };
    default:
      return null;
  }
}
