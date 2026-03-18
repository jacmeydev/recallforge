// ============================================================================
// RecallForge — Analytics Service
// ============================================================================
// Provides stats, heatmaps, retention maps, and risk analysis.
// ============================================================================

import { db } from '@/lib/db';
import { calculateRetrievability, isLeech, generateForecast } from '@/lib/fsrs';
import type { Card, ReviewLog, DailySummary } from '@/types';

// ─── Heatmap Data ──────────────────────────────────────────────────────────

export interface HeatmapDay {
  date: string;
  count: number;
  timeMs: number;
  accuracy: number;
}

export async function getReviewHeatmap(
  userId: string,
  days: number = 365
): Promise<HeatmapDay[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const startStr = start.toISOString();
  const endStr = end.toISOString();

  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startStr], [userId, endStr])
    .toArray();

  const dayMap = new Map<string, { count: number; timeMs: number; correct: number }>();

  for (const log of logs) {
    const date = log.reviewedAt.split('T')[0];
    const existing = dayMap.get(date) || { count: 0, timeMs: 0, correct: 0 };
    existing.count++;
    existing.timeMs += log.responseTimeMs;
    if (log.rating === 'good' || log.rating === 'easy') existing.correct++;
    dayMap.set(date, existing);
  }

  const result: HeatmapDay[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const data = dayMap.get(dateStr);
    result.push({
      date: dateStr,
      count: data?.count || 0,
      timeMs: data?.timeMs || 0,
      accuracy: data ? (data.count > 0 ? data.correct / data.count : 0) : 0,
    });
  }

  return result;
}

// ─── Retention Map ─────────────────────────────────────────────────────────

export interface RetentionBucket {
  deckId: string;
  deckName: string;
  desiredRetention: number;
  actualRetention: number;
  totalReviews: number;
  correctReviews: number;
}

export async function getRetentionMap(userId: string): Promise<RetentionBucket[]> {
  const decks = await db.decks.where('userId').equals(userId).toArray();
  const presets = await db.presets.where('userId').equals(userId).toArray();
  const results: RetentionBucket[] = [];

  for (const deck of decks) {
    const cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deck.id, ''], [userId, deck.id, '\uffff'])
      .toArray();

    const cardIds = new Set(cards.map(c => c.id));
    const recentLogs = await db.reviewLogs
      .where('userId')
      .equals(userId)
      .filter(l => cardIds.has(l.cardId))
      .toArray();

    // Only consider last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentOnly = recentLogs.filter(l => new Date(l.reviewedAt) >= thirtyDaysAgo);

    const total = recentOnly.length;
    const correct = recentOnly.filter(l => l.rating !== 'again').length;

    const preset = presets.find(p => p.id === deck.presetId);

    results.push({
      deckId: deck.id,
      deckName: deck.name,
      desiredRetention: preset?.desiredRetention || 0.9,
      actualRetention: total > 0 ? correct / total : 0,
      totalReviews: total,
      correctReviews: correct,
    });
  }

  return results;
}

// ─── Retrievability Distribution ───────────────────────────────────────────

export interface RetrievabilityBucket {
  range: string;
  min: number;
  max: number;
  count: number;
  cards: string[];
}

export async function getRetrievabilityDistribution(
  userId: string,
  deckId?: string
): Promise<RetrievabilityBucket[]> {
  let cards: Card[];
  if (deckId) {
    cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deckId, ''], [userId, deckId, '\uffff'])
      .filter(c => c.state !== 'new' && !c.suspended)
      .toArray();
  } else {
    cards = await db.cards
      .where('userId')
      .equals(userId)
      .filter(c => c.state !== 'new' && !c.suspended)
      .toArray();
  }

  const buckets: RetrievabilityBucket[] = [
    { range: '90-100%', min: 0.9, max: 1.0, count: 0, cards: [] },
    { range: '75-89%', min: 0.75, max: 0.9, count: 0, cards: [] },
    { range: '50-74%', min: 0.5, max: 0.75, count: 0, cards: [] },
    { range: '<50%', min: 0, max: 0.5, count: 0, cards: [] },
  ];

  for (const card of cards) {
    const r = calculateRetrievability(card);
    for (const bucket of buckets) {
      if (r >= bucket.min && r < bucket.max) {
        bucket.count++;
        bucket.cards.push(card.id);
        break;
      }
    }
    // Handle exactly 1.0
    if (r >= 1.0) {
      buckets[0].count++;
      buckets[0].cards.push(card.id);
    }
  }

  return buckets;
}

// ─── Stability Map ─────────────────────────────────────────────────────────

export interface StabilityGroup {
  label: string;
  minStability: number;
  maxStability: number;
  count: number;
  avgRetrievability: number;
}

export async function getStabilityMap(
  userId: string,
  deckId?: string
): Promise<StabilityGroup[]> {
  let cards: Card[];
  if (deckId) {
    cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deckId, ''], [userId, deckId, '\uffff'])
      .filter(c => c.state === 'review' && !c.suspended)
      .toArray();
  } else {
    cards = await db.cards
      .where('userId')
      .equals(userId)
      .filter(c => c.state === 'review' && !c.suspended)
      .toArray();
  }

  const groups: StabilityGroup[] = [
    { label: 'Muy Frágil (<1d)', minStability: 0, maxStability: 1, count: 0, avgRetrievability: 0 },
    { label: 'Frágil (1-7d)', minStability: 1, maxStability: 7, count: 0, avgRetrievability: 0 },
    { label: 'En Desarrollo (7-30d)', minStability: 7, maxStability: 30, count: 0, avgRetrievability: 0 },
    { label: 'Estable (30-90d)', minStability: 30, maxStability: 90, count: 0, avgRetrievability: 0 },
    { label: 'Fuerte (90-365d)', minStability: 90, maxStability: 365, count: 0, avgRetrievability: 0 },
    { label: 'Consolidada (>365d)', minStability: 365, maxStability: Infinity, count: 0, avgRetrievability: 0 },
  ];

  for (const card of cards) {
    const r = calculateRetrievability(card);
    for (const group of groups) {
      if (card.stability >= group.minStability && card.stability < group.maxStability) {
        group.count++;
        group.avgRetrievability = (group.avgRetrievability * (group.count - 1) + r) / group.count;
        break;
      }
    }
  }

  return groups;
}

// ─── Forgetting Risk ───────────────────────────────────────────────────────

export interface ForgettingRiskItem {
  cardId: string;
  noteId: string;
  deckId: string;
  retrievability: number;
  stability: number;
  overdueDays: number;
  lapses: number;
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
}

export async function getForgettingRisk(
  userId: string,
  limit: number = 50
): Promise<ForgettingRiskItem[]> {
  const cards = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => c.state === 'review' && !c.suspended)
    .toArray();

  const now = new Date();
  const items: ForgettingRiskItem[] = cards.map(card => {
    const r = calculateRetrievability(card);
    const dueDate = new Date(card.dueAt);
    const overdueDays = Math.max(0, (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    let riskLevel: 'critical' | 'high' | 'moderate' | 'low';
    if (r < 0.5 || overdueDays > 30) riskLevel = 'critical';
    else if (r < 0.7 || overdueDays > 14) riskLevel = 'high';
    else if (r < 0.85 || overdueDays > 7) riskLevel = 'moderate';
    else riskLevel = 'low';

    return {
      cardId: card.id,
      noteId: card.noteId,
      deckId: card.deckId,
      retrievability: r,
      stability: card.stability,
      overdueDays,
      lapses: card.lapses,
      riskLevel,
    };
  });

  return items
    .filter(i => i.riskLevel !== 'low')
    .sort((a, b) => a.retrievability - b.retrievability)
    .slice(0, limit);
}

// ─── Knowledge Coverage ───────────────────────────────────────────────────

export interface CoverageStats {
  deckId: string;
  deckName: string;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  matureCount: number;
  leechCount: number;
  suspendedCount: number;
  totalCount: number;
}

export async function getKnowledgeCoverage(userId: string): Promise<CoverageStats[]> {
  const decks = await db.decks.where('userId').equals(userId).toArray();
  const results: CoverageStats[] = [];

  for (const deck of decks) {
    const cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, deck.id, ''], [userId, deck.id, '\uffff'])
      .toArray();

    results.push({
      deckId: deck.id,
      deckName: deck.name,
      newCount: cards.filter(c => c.state === 'new' && !c.suspended).length,
      learningCount: cards.filter(c => (c.state === 'learning' || c.state === 'relearning') && !c.suspended).length,
      reviewCount: cards.filter(c => c.state === 'review' && !c.suspended && c.stability < 21).length,
      matureCount: cards.filter(c => c.state === 'review' && !c.suspended && c.stability >= 21).length,
      leechCount: cards.filter(c => isLeech(c)).length,
      suspendedCount: cards.filter(c => c.suspended).length,
      totalCount: cards.length,
    });
  }

  return results;
}

// ─── Problem Cards (Leeches) ──────────────────────────────────────────────

export interface ProblemCard {
  cardId: string;
  noteId: string;
  deckId: string;
  lapses: number;
  stability: number;
  difficulty: number;
  isLeech: boolean;
  reason: string;
}

export async function getProblemCards(
  userId: string,
  limit: number = 50
): Promise<ProblemCard[]> {
  const cards = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => !c.suspended)
    .toArray();

  const problems: ProblemCard[] = [];

  for (const card of cards) {
    const reasons: string[] = [];

    if (isLeech(card)) reasons.push('Leech (many lapses)');
    if (card.difficulty > 8) reasons.push('Very difficult');
    if (card.stability < 1 && card.reps > 5) reasons.push('Low stability despite many reps');

    if (reasons.length > 0) {
      problems.push({
        cardId: card.id,
        noteId: card.noteId,
        deckId: card.deckId,
        lapses: card.lapses,
        stability: card.stability,
        difficulty: card.difficulty,
        isLeech: isLeech(card),
        reason: reasons.join('; '),
      });
    }
  }

  return problems
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, limit);
}

// ─── Load Simulator ───────────────────────────────────────────────────────

export interface LoadSimulation {
  scenario: string;
  forecast: { date: string; dueCards: number }[];
}

export async function simulateLoad(
  userId: string,
  params: {
    retentionOverride?: number;
    pauseDays?: number;
    newPerDay?: number;
    forecastDays?: number;
  }
): Promise<LoadSimulation> {
  const cards = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => !c.suspended)
    .toArray();

  const days = params.forecastDays || 30;
  const newPerDay = params.newPerDay || 20;

  const forecast = generateForecast(cards, days, newPerDay);

  return {
    scenario: `${days}d forecast, ${newPerDay} new/day`,
    forecast: forecast.map(f => ({ date: f.date, dueCards: f.dueCards })),
  };
}

// ─── Streak calculation ───────────────────────────────────────────────────

export async function getCurrentStreak(userId: string): Promise<number> {
  const summaries = await db.dailySummaries
    .where('[userId+date]')
    .between([userId, ''], [userId, '\uffff'])
    .reverse()
    .toArray();

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < summaries.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split('T')[0];

    if (summaries[i]?.date === expectedStr && summaries[i]?.metrics?.cardsStudied > 0) {
      streak++;
    } else if (i === 0 && summaries[i]?.date !== expectedStr) {
      // Today hasn't been studied yet, check from yesterday
      continue;
    } else {
      break;
    }
  }

  return streak;
}
