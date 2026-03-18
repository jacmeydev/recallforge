// ============================================================================
// RecallForge — Mastery Score Service
// ============================================================================
// Real FSRS-backed mastery metrics per deck/subject/chapter.
// No arbitrary numbers — everything based on retrievability, stability,
// retention, coverage, and backlog.
// ============================================================================

import { db } from '@/lib/db';
import { calculateRetrievability, isLeech } from '@/lib/fsrs';
import type { Card, Deck, MasteryScore, AcademicMeta, JSONObject } from '@/types';

// ─── Calculate mastery for a single deck ──────────────────────────────────

export async function getDeckMastery(
  userId: string,
  deckId: string
): Promise<MasteryScore> {
  const deck = await db.decks.get(deckId);
  const cards = await db.cards
    .where('[userId+deckId+state]')
    .between([userId, deckId, ''], [userId, deckId, '\uffff'])
    .toArray();

  return computeMastery(deck?.name || 'Desconocido', deckId, cards, userId);
}

// ─── Calculate mastery for all decks ──────────────────────────────────────

export async function getAllDeckMastery(userId: string): Promise<MasteryScore[]> {
  const decks = await db.decks.where('userId').equals(userId).toArray();
  const results: MasteryScore[] = [];

  for (const deck of decks) {
    const cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deck.id, ''], [userId, deck.id, '\uffff'])
      .toArray();

    if (cards.length > 0) {
      results.push(computeMastery(deck.name, deck.id, cards, userId));
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Mastery for a subject (academic grouping by deck metadata) ───────────

export async function getSubjectMastery(
  userId: string,
  subjectName: string
): Promise<MasteryScore[]> {
  const decks = await db.decks
    .where('userId')
    .equals(userId)
    .toArray();

  const subjectDecks = decks.filter(d => {
    const meta = d.metadata as Record<string, unknown>;
    return meta?.subject && (meta.subject as string).toLowerCase() === subjectName.toLowerCase();
  });

  const results: MasteryScore[] = [];
  for (const deck of subjectDecks) {
    const cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deck.id, ''], [userId, deck.id, '\uffff'])
      .toArray();

    if (cards.length > 0) {
      results.push(computeMastery(deck.name, deck.id, cards, userId));
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Get all subjects with aggregated mastery ─────────────────────────────

export async function getSubjectsSummary(userId: string): Promise<Array<{
  subject: string;
  score: number;
  decks: number;
  totalCards: number;
  riskCards: number;
  backlog: number;
}>> {
  const decks = await db.decks.where('userId').equals(userId).toArray();
  const subjectMap = new Map<string, { deckIds: string[]; name: string }>();

  for (const deck of decks) {
    const meta = deck.metadata as Record<string, unknown>;
    const subject = meta?.subject as string | undefined;
    if (subject) {
      const key = subject.toLowerCase();
      if (!subjectMap.has(key)) {
        subjectMap.set(key, { deckIds: [], name: subject });
      }
      subjectMap.get(key)!.deckIds.push(deck.id);
    }
  }

  const results: Array<{
    subject: string;
    score: number;
    decks: number;
    totalCards: number;
    riskCards: number;
    backlog: number;
  }> = [];

  for (const [, entry] of subjectMap) {
    let totalScore = 0;
    let totalCards = 0;
    let totalRisk = 0;
    let totalBacklog = 0;

    for (const deckId of entry.deckIds) {
      const cards = await db.cards
        .where('[userId+deckId+state]')
        .between([userId, deckId, ''], [userId, deckId, '\uffff'])
        .toArray();

      const mastery = computeMastery('', deckId, cards, userId);
      totalScore += mastery.score * mastery.totalCards;
      totalCards += mastery.totalCards;
      totalRisk += mastery.riskCards;
      totalBacklog += mastery.backlog;
    }

    results.push({
      subject: entry.name,
      score: totalCards > 0 ? Math.round(totalScore / totalCards) : 0,
      decks: entry.deckIds.length,
      totalCards,
      riskCards: totalRisk,
      backlog: totalBacklog,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Core mastery computation ─────────────────────────────────────────────

function computeMastery(
  deckName: string,
  deckId: string,
  cards: Card[],
  userId: string
): MasteryScore {
  const activeCards = cards.filter(c => !c.suspended);
  const totalCards = activeCards.length;

  if (totalCards === 0) {
    return {
      deckId,
      deckName,
      score: 0,
      retrievability: 0,
      stability: 0,
      retention: 0,
      coverage: 0,
      backlog: 0,
      riskCards: 0,
      totalCards: 0,
      matureCards: 0,
    };
  }

  // Retrievability: average R across non-new cards
  const nonNewCards = activeCards.filter(c => c.state !== 'new');
  const avgR = nonNewCards.length > 0
    ? nonNewCards.reduce((sum, c) => sum + calculateRetrievability(c), 0) / nonNewCards.length
    : 0;

  // Stability: average stability of review cards
  const reviewCards = activeCards.filter(c => c.state === 'review');
  const avgStability = reviewCards.length > 0
    ? reviewCards.reduce((sum, c) => sum + c.stability, 0) / reviewCards.length
    : 0;

  // Coverage: % of cards that are not new
  const coverage = nonNewCards.length / totalCards;

  // Mature: stability >= 21 days
  const matureCards = reviewCards.filter(c => c.stability >= 21).length;

  // Backlog: overdue cards
  const nowStr = new Date().toISOString();
  const backlog = activeCards.filter(c =>
    c.state !== 'new' && c.dueAt < nowStr && !c.suspended
  ).length;

  // Risk: cards with R < 0.7
  const riskCards = nonNewCards.filter(c => calculateRetrievability(c) < 0.7).length;

  // Retention estimate (from retrievability, scaled by coverage)
  const retention = avgR;

  // Composite score formula:
  // 40% average retrievability
  // 25% coverage (studied vs total)
  // 20% maturity ratio
  // 15% absence-of-risk (inverse of risk ratio)
  const maturityRatio = totalCards > 0 ? matureCards / totalCards : 0;
  const riskRatio = nonNewCards.length > 0 ? riskCards / nonNewCards.length : 0;
  const absenceOfRisk = 1 - riskRatio;

  const score = Math.round(
    (avgR * 40) +
    (coverage * 25) +
    (maturityRatio * 20) +
    (absenceOfRisk * 15)
  );

  return {
    deckId,
    deckName,
    score: Math.min(100, Math.max(0, score)),
    retrievability: Math.round(avgR * 100) / 100,
    stability: Math.round(avgStability * 10) / 10,
    retention: Math.round(retention * 100) / 100,
    coverage: Math.round(coverage * 100) / 100,
    backlog,
    riskCards,
    totalCards,
    matureCards,
  };
}

// ─── Academic helpers ─────────────────────────────────────────────────────

export function getAcademicMeta(metadata: JSONObject | undefined): AcademicMeta {
  if (!metadata) return {};
  return {
    subject: metadata.subject as string | undefined,
    module: metadata.module as string | undefined,
    chapter: metadata.chapter as string | undefined,
    topic: metadata.topic as string | undefined,
    subtopic: metadata.subtopic as string | undefined,
    lectureDate: metadata.lectureDate as string | undefined,
    professor: metadata.professor as string | undefined,
    sourcePage: metadata.sourcePage as string | undefined,
    book: metadata.book as string | undefined,
    className: metadata.className as string | undefined,
    examScope: metadata.examScope as string | undefined,
    aiGenerated: metadata.aiGenerated as boolean | undefined,
    aiReviewStatus: metadata.aiReviewStatus as AcademicMeta['aiReviewStatus'],
  };
}

export async function setDeckAcademicMeta(
  deckId: string,
  academicMeta: Partial<AcademicMeta>
): Promise<void> {
  const deck = await db.decks.get(deckId);
  if (!deck) return;

  const existingMeta = (deck.metadata || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existingMeta, ...academicMeta };

  // Remove undefined values
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  await db.decks.update(deckId, {
    metadata: merged as JSONObject,
  });
}
