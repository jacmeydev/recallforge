// ============================================================================
// RecallForge — Quick Rescue Service
// ============================================================================
// Short, focused sessions for bad days or time-crunched situations.
// Picks high-risk / overdue / due-now cards for a 5-10 minute mini-session.
// Awards rescue-specific XP.
// ============================================================================

import { db } from '@/lib/db';
import { calculateRetrievability, isOverdue } from '@/lib/fsrs';
import { startStudySession, finishStudySession } from './study-service';
import { awardXP, updateStreak, awardSessionBonus } from './gamification-service';
import { updateQuestProgress } from './quest-service';
import type { Card, StudyQueueCard } from '@/types';

export type RescueMode = 'high_risk' | 'overdue' | 'due_now' | 'quick_5';

const DEFAULT_RESCUE_LIMIT = 10;

// ─── Build rescue queue ───────────────────────────────────────────────────

export async function buildRescueQueue(
  userId: string,
  mode: RescueMode,
  maxCards: number = DEFAULT_RESCUE_LIMIT
): Promise<StudyQueueCard[]> {
  const nowDate = new Date();
  const nowStr = nowDate.toISOString();

  // Get all non-suspended, non-buried, non-new cards
  const allCards = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => !c.suspended && !c.buriedUntil && c.state !== 'new')
    .toArray();

  let selected: Card[];

  switch (mode) {
    case 'high_risk': {
      // Cards with retrievability < 0.5 — most at risk of being forgotten
      const scored = allCards
        .map(c => ({ card: c, r: calculateRetrievability(c) }))
        .filter(x => x.r < 0.5)
        .sort((a, b) => a.r - b.r);
      selected = scored.slice(0, maxCards).map(x => x.card);
      break;
    }

    case 'overdue': {
      // Cards past due, sorted by most overdue first
      const overdue = allCards
        .filter(c => c.dueAt < nowStr)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      selected = overdue.slice(0, maxCards);
      break;
    }

    case 'due_now': {
      // All cards due right now (learning + review), prioritize learning
      const due = allCards.filter(c => c.dueAt <= nowStr);
      const learning = due.filter(c => c.state === 'learning' || c.state === 'relearning');
      const review = due.filter(c => c.state === 'review');
      selected = [...learning, ...review].slice(0, maxCards);
      break;
    }

    case 'quick_5': {
      // Mix: 2 highest-risk + 3 most overdue (fast 5-card session)
      const limit = Math.min(5, maxCards);
      const riskSorted = allCards
        .map(c => ({ card: c, r: calculateRetrievability(c) }))
        .filter(x => x.r < 0.7)
        .sort((a, b) => a.r - b.r);

      const overdueSorted = allCards
        .filter(c => c.dueAt < nowStr)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

      const riskPick = riskSorted.slice(0, Math.ceil(limit * 0.4)).map(x => x.card);
      const seen = new Set(riskPick.map(c => c.id));
      const overduePick = overdueSorted.filter(c => !seen.has(c.id)).slice(0, limit - riskPick.length);

      selected = [...riskPick, ...overduePick];
      break;
    }

    default:
      selected = [];
  }

  // Hydrate into StudyQueueCard[]
  const queue: StudyQueueCard[] = [];
  for (const card of selected) {
    const [note, deck] = await Promise.all([
      db.notes.get(card.noteId),
      db.decks.get(card.deckId),
    ]);
    if (!note || !deck) continue;

    const noteType = await db.noteTypes.get(note.noteTypeId);
    if (!noteType) continue;

    const template = noteType.templates.find(t => t.id === card.templateId);
    if (!template) continue;

    queue.push({ card, note, noteType, template, deck });
  }

  return queue;
}

// ─── Start rescue session ─────────────────────────────────────────────────

export async function startRescueSession(
  userId: string,
  mode: RescueMode
): Promise<{ session: ReturnType<typeof startStudySession> extends Promise<infer T> ? T : never; queue: StudyQueueCard[] }> {
  const queue = await buildRescueQueue(userId, mode);
  const deckIds = [...new Set(queue.map(q => q.card.deckId))];
  const session = await startStudySession(userId, deckIds, 'filtered');
  return { session, queue };
}

// ─── Finish rescue session (awards bonus XP + updates quests) ─────────────

export async function finishRescueSession(
  userId: string,
  sessionId: string
): Promise<{ xpAwarded: number }> {
  const session = await finishStudySession(userId, sessionId);
  let xpAwarded = 0;

  if (session && session.metrics.cardsStudied > 0) {
    // Award rescue-specific XP
    const entry = await awardXP(
      userId,
      25,
      'rescue_session',
      `Sesión de rescate: ${session.metrics.cardsStudied} tarjetas`
    );
    xpAwarded += entry.amount;

    // Session accuracy bonus
    xpAwarded += await awardSessionBonus(
      userId,
      sessionId,
      session.metrics.correctRate,
      session.metrics.cardsStudied
    );

    // Update streak
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = `${todayStr}T00:00:00.000Z`;
    const todayReviews = await db.reviewLogs
      .where('[userId+reviewedAt]')
      .between([userId, startOfDay], [userId, '\uffff'])
      .count();
    await updateStreak(userId, todayReviews);

    // Update quest progress
    await updateQuestProgress(userId);
  }

  return { xpAwarded };
}

// ─── Get rescue stats (how many cards available per mode) ─────────────────

export async function getRescueStats(userId: string): Promise<{
  highRisk: number;
  overdue: number;
  dueNow: number;
}> {
  const nowStr = new Date().toISOString();

  const allCards = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => !c.suspended && !c.buriedUntil && c.state !== 'new')
    .toArray();

  const highRisk = allCards.filter(c => calculateRetrievability(c) < 0.5).length;
  const overdue = allCards.filter(c => c.dueAt < nowStr).length;
  const dueNow = allCards.filter(c => c.dueAt <= nowStr).length;

  return { highRisk, overdue, dueNow };
}
