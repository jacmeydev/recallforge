// ============================================================================
// RecallForge — Study Session Service
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import {
  scheduleReview,
  getIntervalPreviews,
  calculateRetrievability,
} from '@/lib/fsrs';
import { EventEmitters } from '@/lib/events';
import { getClockSyncSnapshot } from '@/lib/sync/clock';
import { getClientDeviceId, nextDeviceSequence } from '@/lib/sync/device';
import { updateCardAfterReview, burySiblings } from './card-service';
import { awardReviewXP, awardSessionBonus, updateStreak, checkAndUnlockAchievements } from './gamification-service';
import { updateQuestProgress } from './quest-service';
import type {
  Card,
  Note,
  NoteType,
  CardTemplate,
  Deck,
  StudySession,
  StudySessionMetrics,
  SchedulingPreset,
  ReviewRating,
  IntervalPreview,
  StudyQueueCard,
  StudyScope,
  JSONObject,
} from '@/types';

// ─── Start study session ──────────────────────────────────────────────────

export async function startStudySession(
  userId: string,
  deckScope: string[],
  mode: 'normal' | 'filtered' | 'cram' | 'preview' | 'rescue' | 'academic' = 'normal'
): Promise<StudySession> {
  const session: StudySession = {
    id: generateId(),
    userId,
    startedAt: now(),
    endedAt: null,
    mode,
    deckScope,
    presetSnapshot: {},
    metrics: {
      cardsStudied: 0,
      newCards: 0,
      reviewCards: 0,
      learningCards: 0,
      relearningCards: 0,
      againCount: 0,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
      totalTimeMs: 0,
      averageTimeMs: 0,
      correctRate: 0,
    },
  };

  await db.studySessions.add(session);
  await EventEmitters.studySessionStarted(userId, session.id, {
    mode,
    deckScope: deckScope as unknown as JSONObject,
  });

  return session;
}

// ─── Finish study session ─────────────────────────────────────────────────

export async function finishStudySession(
  userId: string,
  sessionId: string
): Promise<StudySession | undefined> {
  const session = await db.studySessions.get(sessionId);
  if (!session) return undefined;

  // Calculate final metrics
  const logs = await db.reviewLogs
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  const metrics: StudySessionMetrics = {
    cardsStudied: logs.length,
    newCards: logs.filter(l => l.previousState === 'new').length,
    reviewCards: logs.filter(l => l.previousState === 'review').length,
    learningCards: logs.filter(l => l.previousState === 'learning').length,
    relearningCards: logs.filter(l => l.previousState === 'relearning').length,
    againCount: logs.filter(l => l.rating === 'again').length,
    hardCount: logs.filter(l => l.rating === 'hard').length,
    goodCount: logs.filter(l => l.rating === 'good').length,
    easyCount: logs.filter(l => l.rating === 'easy').length,
    totalTimeMs: logs.reduce((sum, l) => sum + l.responseTimeMs, 0),
    averageTimeMs: logs.length > 0
      ? logs.reduce((sum, l) => sum + l.responseTimeMs, 0) / logs.length
      : 0,
    correctRate: logs.length > 0
      ? (logs.filter(l => l.rating === 'good' || l.rating === 'easy').length) / logs.length
      : 0,
  };

  const updates = {
    endedAt: now(),
    metrics,
  };

  await db.studySessions.update(sessionId, updates);

  await EventEmitters.studySessionFinished(userId, sessionId, {
    duration: metrics.totalTimeMs,
    cardsStudied: metrics.cardsStudied,
    correctRate: metrics.correctRate,
  });

  // Gamification hooks (non-blocking, independent — each wrapped to avoid cascade failure)
  (async () => {
    // Session accuracy bonus
    try { await awardSessionBonus(userId, sessionId, metrics.correctRate, metrics.cardsStudied); } catch { /* non-critical */ }

    // Update streak
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const startOfDay = `${todayStr}T00:00:00.000Z`;
      const todayReviews = await db.reviewLogs
        .where('[userId+reviewedAt]')
        .between([userId, startOfDay], [userId, '\uffff'])
        .count();
      await updateStreak(userId, todayReviews);
    } catch { /* non-critical */ }

    // Check achievements
    try {
      const totalReviews = await db.reviewLogs.where('userId').equals(userId).count();
      await checkAndUnlockAchievements(userId, { totalReviews });
    } catch { /* non-critical */ }

    // Update quest progress
    try { await updateQuestProgress(userId); } catch { /* non-critical */ }

    // Auto-generate daily personal summary
    try {
      const { generatePersonalSummary } = await import('./personal-summary-service');
      const todayDate = new Date().toISOString().split('T')[0];
      await generatePersonalSummary(userId, 'daily', todayDate);
    } catch { /* non-critical */ }
  })();

  return { ...session, ...updates };
}

// ─── Answer a card ────────────────────────────────────────────────────────

export async function answerCard(
  userId: string,
  card: Card,
  rating: ReviewRating,
  responseTimeMs: number,
  sessionId: string,
  preset?: SchedulingPreset
): Promise<{ updatedCard: Card; nextCard?: StudyQueueCard }> {
  const reviewedAt = now();
  const reviewedAtDate = new Date(reviewedAt);
  const { clockOffsetMs, offsetMeasuredAt } = getClockSyncSnapshot();

  // Schedule the review using the same timestamp we persist in the review log.
  const result = scheduleReview(card, rating, preset, reviewedAtDate);
  const deviceId = getClientDeviceId();
  const deviceSeq = nextDeviceSequence();

  // Save the review
  const { card: updatedCard, reviewLog } = await updateCardAfterReview(
    card,
    result.card,
    {
      userId,
      cardId: card.id,
      reviewedAt,
      clientReviewedAt: reviewedAt,
      serverReceivedAt: null,
      effectiveReviewedAt: reviewedAt,
      offsetMeasuredAt,
      timeSource: clockOffsetMs !== null && offsetMeasuredAt ? 'client' : 'server',
      rating,
      previousState: result.log.previousState,
      nextState: result.log.nextState,
      previousDueAt: result.log.previousDueAt,
      nextDueAt: result.log.nextDueAt,
      previousStability: result.log.previousStability,
      nextStability: result.log.nextStability,
      previousDifficulty: result.log.previousDifficulty,
      nextDifficulty: result.log.nextDifficulty,
      responseTimeMs,
      wasManualReschedule: false,
      wasFilteredDeck: false,
      sessionId,
      deviceId,
      deviceSeq,
      clockOffsetMs,
      replayOrdinal: null,
      schedulerContext: {
        presetId: preset?.id || 'default',
        desiredRetention: preset?.desiredRetention ?? null,
        maximumInterval: preset?.maximumInterval ?? null,
        enableFuzz: preset?.enableFuzz ?? null,
        fsrsParameters: preset?.fsrsParameters ?? null,
        learningSteps: preset?.learningSteps ?? null,
        relearningSteps: preset?.relearningSteps ?? null,
      },
      syncStatus: 'pending',
    }
  );

  // Emit event for OpenClaw
  await EventEmitters.cardReviewed(
    userId,
    card.id,
    {
      deckId: card.deckId,
      noteId: card.noteId,
      rating,
      previousState: result.log.previousState,
      nextState: result.log.nextState,
      previousDueAt: result.log.previousDueAt,
      nextDueAt: result.log.nextDueAt,
      previousStability: result.log.previousStability,
      nextStability: result.log.nextStability,
      previousDifficulty: result.log.previousDifficulty,
      nextDifficulty: result.log.nextDifficulty,
      responseTimeMs,
      presetId: preset?.id || 'default',
    },
    sessionId
  );

  // Bury siblings if configured
  if (preset?.buryReviewSiblings && card.state === 'review') {
    await burySiblings(userId, card.noteId, card.id);
  }
  if (preset?.buryNewSiblings && card.state === 'new') {
    await burySiblings(userId, card.noteId, card.id);
  }

  // Award XP for this review (non-blocking)
  awardReviewXP(userId, card, rating).catch(() => {});

  // Emit academic events for high-priority / hard-topic cards (non-blocking)
  (async () => {
    try {
      const note = await db.notes.get(card.noteId);
      if (!note) return;
      const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
      if (!acad) return;
      const priority = acad.priority as string | undefined;
      const difficulty = acad.conceptualDifficulty as string | undefined;
      if ((priority === 'high' || priority === 'critical') && (rating === 'good' || rating === 'easy')) {
        await EventEmitters.highPriorityReviewCompleted(userId, card.id, { rating, priority });
      }
      if ((difficulty === 'hard' || difficulty === 'very_hard') && (rating === 'good' || rating === 'easy')) {
        await EventEmitters.hardTopicRescued(userId, card.id, { rating, difficulty });
      }
    } catch { /* non-critical */ }
  })();

  return { updatedCard };
}

// ─── Get interval previews for a card ─────────────────────────────────────

export function previewIntervals(
  card: Card,
  preset?: SchedulingPreset
): IntervalPreview {
  return getIntervalPreviews(card, preset);
}

// ─── Build study queue with full card data ────────────────────────────────

export async function buildStudyQueue(
  userId: string,
  deckId: string,
  limits: { newCards: number; reviews: number }
): Promise<StudyQueueCard[]> {
  const { getStudyQueue } = await import('./card-service');
  const { newCards, learningCards, reviewCards } = await getStudyQueue(
    userId,
    deckId,
    limits
  );

  // Interleave: learning first, then new/review
  const orderedCards = [...learningCards, ...newCards, ...reviewCards];

  const queue: StudyQueueCard[] = [];

  for (const card of orderedCards) {
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

// ─── Get retrievability for a card ────────────────────────────────────────

export function getCardRetrievability(card: Card): number {
  return calculateRetrievability(card);
}

// ─── Build academic study queue by scope ──────────────────────────────────

export async function buildAcademicStudyQueue(
  userId: string,
  scope: StudyScope,
  limits: { newCards: number; reviews: number }
): Promise<StudyQueueCard[]> {
  const { getCardIdsByScope } = await import('./curriculum-service');
  const cardIds = await getCardIdsByScope(userId, scope);
  if (cardIds.length === 0) return [];

  const nowStr = now();
  const cards = await db.cards.bulkGet(cardIds);
  const validCards = cards.filter((c): c is Card => !!c && !c.suspended);

  // Partition cards into new, learning, review
  const newCards: Card[] = [];
  const learningCards: Card[] = [];
  const reviewCards: Card[] = [];

  for (const card of validCards) {
    if (card.state === 'new') {
      newCards.push(card);
    } else if (card.state === 'learning' || card.state === 'relearning') {
      learningCards.push(card);
    } else if (card.dueAt && card.dueAt <= nowStr) {
      reviewCards.push(card);
    }
  }

  // Apply limits
  const selectedNew = newCards.slice(0, limits.newCards);
  const selectedReview = reviewCards.slice(0, limits.reviews);
  const orderedCards = [...learningCards, ...selectedNew, ...selectedReview];

  const queue: StudyQueueCard[] = [];

  for (const card of orderedCards) {
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

// ─── Start academic study session ─────────────────────────────────────────

export async function startAcademicStudySession(
  userId: string,
  scope: StudyScope
): Promise<StudySession> {
  const session = await startStudySession(userId, [], 'academic');

  await EventEmitters.studyScopeSelected(userId, session.id, {
    scopeType: scope.type,
    scopeId: ('subjectId' in scope ? scope.subjectId :
              'moduleId' in scope ? scope.moduleId :
              'chapterId' in scope ? scope.chapterId :
              'topicId' in scope ? scope.topicId :
              scope.type) as string,
  });

  return session;
}
