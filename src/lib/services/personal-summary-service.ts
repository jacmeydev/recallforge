// ============================================================================
// RecallForge — Personal Summary Service (Phase 2 Academic)
// ============================================================================
// Generates daily/weekly/monthly PersonalSummary from real data.
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { calculateRetrievability } from '@/lib/fsrs';
import { EventEmitters } from '@/lib/events';
import { getAllDeckMastery } from './mastery-service';
import type { PersonalSummary } from '@/types';

// ─── Generate personal summary ────────────────────────────────────────────

export async function generatePersonalSummary(
  userId: string,
  period: 'daily' | 'weekly' | 'monthly',
  date: string // YYYY-MM-DD (end date of the period)
): Promise<PersonalSummary> {
  const endDate = new Date(date);
  const startDate = new Date(date);

  switch (period) {
    case 'daily':
      // Just this day
      break;
    case 'weekly':
      startDate.setDate(startDate.getDate() - 6);
      break;
    case 'monthly':
      startDate.setDate(startDate.getDate() - 29);
      break;
  }

  const startStr = `${startDate.toISOString().split('T')[0]}T00:00:00.000Z`;
  const endStr = `${endDate.toISOString().split('T')[0]}T23:59:59.999Z`;

  // Previous period for deltas
  const prevEndDate = new Date(startDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  switch (period) {
    case 'daily': break;
    case 'weekly': prevStartDate.setDate(prevStartDate.getDate() - 6); break;
    case 'monthly': prevStartDate.setDate(prevStartDate.getDate() - 29); break;
  }
  const prevStartStr = `${prevStartDate.toISOString().split('T')[0]}T00:00:00.000Z`;
  const prevEndStr = `${prevEndDate.toISOString().split('T')[0]}T23:59:59.999Z`;

  // XP earned in period
  const xpEntries = await db.xpLedger
    .where('[userId+ts]')
    .between([userId, startStr], [userId, endStr])
    .toArray();
  const xpEarned = xpEntries.reduce((sum, e) => sum + e.amount, 0);

  // Streak
  const gamification = await db.userGamification.where('userId').equals(userId).first();
  const streakDays = gamification?.currentStreak || 0;

  // Quests completed
  const quests = await db.quests
    .where('[userId+status]')
    .equals([userId, 'completed'])
    .toArray();
  const questsCompleted = quests.filter(q =>
    q.completedAt && q.completedAt >= startStr && q.completedAt <= endStr
  ).length;

  // Current deck mastery
  const deckMastery = await getAllDeckMastery(userId);

  // Previous period mastery — approximate from review logs
  const prevReviewLogs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, prevStartStr], [userId, prevEndStr])
    .toArray();
  const currentReviewLogs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startStr], [userId, endStr])
    .toArray();

  // Subjects analysis
  const subjectDecks = new Map<string, string[]>();
  const decks = await db.decks.where('userId').equals(userId).toArray();
  for (const deck of decks) {
    const meta = deck.metadata as Record<string, unknown>;
    const subject = meta?.subject as string | undefined;
    if (subject) {
      const key = subject.toLowerCase();
      if (!subjectDecks.has(key)) subjectDecks.set(key, []);
      subjectDecks.get(key)!.push(deck.id);
    }
  }

  // Subjects advanced (had reviews this period)
  const reviewedDeckIds = new Set(currentReviewLogs.map(r => {
    // We need to look up from cards
    return r.cardId;
  }));

  // Get card deck map
  const reviewedCards = await Promise.all(
    [...new Set(currentReviewLogs.map(r => r.cardId))].slice(0, 500).map(id => db.cards.get(id))
  );
  const cardDeckMap = new Map<string, string>();
  reviewedCards.forEach(c => { if (c) cardDeckMap.set(c.id, c.deckId); });

  const activeSubjects = new Set<string>();
  for (const log of currentReviewLogs) {
    const deckId = cardDeckMap.get(log.cardId);
    if (!deckId) continue;
    const deck = decks.find(d => d.id === deckId);
    const subject = (deck?.metadata as Record<string, unknown>)?.subject as string | undefined;
    if (subject) activeSubjects.add(subject);
  }

  // Subjects abandoned (had reviews in prev period but not this period)
  const prevCardIds = [...new Set(prevReviewLogs.map(r => r.cardId))].slice(0, 500);
  const prevCards = await Promise.all(prevCardIds.map(id => db.cards.get(id)));
  const prevActiveSubjects = new Set<string>();
  prevCards.forEach(c => {
    if (!c) return;
    const deck = decks.find(d => d.id === c.deckId);
    const subject = (deck?.metadata as Record<string, unknown>)?.subject as string | undefined;
    if (subject) prevActiveSubjects.add(subject);
  });

  const subjectsAdvanced = [...activeSubjects];
  const subjectsAbandoned = [...prevActiveSubjects].filter(s => !activeSubjects.has(s));

  // Risk change — approximate from previous period's risk count
  const currentRiskCards = deckMastery.reduce((sum, m) => sum + m.riskCards, 0);
  // Count how many cards in previous period had low retrievability
  let prevRiskCards = 0;
  for (const card of prevCards) {
    if (card && card.state === 'review' && calculateRetrievability(card) < 0.5) {
      prevRiskCards++;
    }
  }
  const riskChange = currentRiskCards - prevRiskCards;

  // Chapters consolidated (mastery >= 70)
  const chaptersConsolidated: string[] = [];
  const chapters = await db.curriculumChapters.where('userId').equals(userId).toArray();
  for (const ch of chapters) {
    const links = await db.curriculumLinks.where('[userId+chapterId]').equals([userId, ch.id]).toArray();
    const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
    if (noteIds.size === 0) continue;
    const cards: import('@/types').Card[] = [];
    for (const nid of noteIds) {
      const c = await db.cards.where('noteId').equals(nid).toArray();
      cards.push(...c);
    }
    const activeCards = cards.filter(c => !c.suspended);
    const nonNew = activeCards.filter(c => c.state !== 'new');
    if (nonNew.length > 0) {
      const avgR = nonNew.reduce((sum, c) => sum + calculateRetrievability(c), 0) / nonNew.length;
      if (avgR >= 0.7 && nonNew.length / activeCards.length >= 0.5) {
        chaptersConsolidated.push(ch.name);
      }
    }
  }

  // AI cards pending review
  const allNotes = await db.notes.where('userId').equals(userId).toArray();
  const aiPendingReview = allNotes.filter(n => {
    const acad = (n.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    return acad?.aiReviewStatus === 'pending-review';
  }).length;

  // Top mastery gains — compare current with baseline
  const topMasteryGains = deckMastery
    .filter(m => m.totalCards > 0)
    .map(m => ({ deck: m.deckName, change: m.score }))
    .sort((a, b) => b.change - a.change)
    .slice(0, 5);

  // High priority pending
  const highPriorityPending = allNotes.filter(n => {
    const acad = (n.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    return acad?.priority === 'high' || acad?.priority === 'critical';
  }).length;

  // Hard topics count
  const hardTopicsCount = allNotes.filter(n => {
    const acad = (n.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    return acad?.conceptualDifficulty === 'hard' || acad?.conceptualDifficulty === 'very_hard';
  }).length;

  // Syllabus coverage delta
  const totalTopics = await db.curriculumTopics.where('userId').equals(userId).count();
  const topicsWithLinks = new Set<string>();
  const allLinks = await db.curriculumLinks.where('userId').equals(userId).toArray();
  allLinks.forEach(l => { if (l.topicId) topicsWithLinks.add(l.topicId); });
  const syllabusCoverageDelta = totalTopics > 0
    ? Math.round((topicsWithLinks.size / totalTopics) * 100) / 100
    : 0;

  const summary: PersonalSummary = {
    id: generateId(),
    userId,
    period,
    date,
    xpEarned,
    streakDays,
    subjectsAdvanced,
    subjectsAbandoned,
    riskChange,
    chaptersConsolidated,
    aiCardsPendingReview: aiPendingReview,
    topMasteryGains,
    questsCompleted,
    highPriorityPending,
    hardTopicsCount,
    syllabusCoverageDelta,
    generatedAt: now(),
  };

  // Upsert — one summary per period+date
  const existing = await db.personalSummaries
    .where('[userId+date]')
    .equals([userId, date])
    .filter(s => s.period === period)
    .first();

  if (existing) {
    summary.id = existing.id;
    await db.personalSummaries.put(summary);
  } else {
    await db.personalSummaries.add(summary);
  }

  await EventEmitters.personalSummaryGenerated(userId, summary.id, {
    period,
    date,
    xpEarned,
    questsCompleted,
  });

  return summary;
}

// ─── Get summaries ────────────────────────────────────────────────────────

export async function getPersonalSummaries(
  userId: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }
): Promise<PersonalSummary[]> {
  let results = await db.personalSummaries
    .where('[userId+date]')
    .between(
      [userId, options?.fromDate || ''],
      [userId, options?.toDate || '\uffff']
    )
    .reverse()
    .toArray();

  if (options?.period) {
    results = results.filter(s => s.period === options.period);
  }

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}
