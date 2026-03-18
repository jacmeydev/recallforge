// ============================================================================
// RecallForge — Activity Event System (OpenClaw Telemetry)
// ============================================================================
// Append-only event log for all user actions.
// Designed for consumption by OpenClaw agents.
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import type {
  ActivityEvent,
  ActivityEventType,
  EntityType,
  EventSource,
  JSONObject,
  DailySummary,
  DailySummaryMetrics,
} from '@/types';

// ─── Emit an event ─────────────────────────────────────────────────────────

export async function emitEvent(
  userId: string,
  type: ActivityEventType,
  entityType: EntityType,
  entityId: string,
  payload: JSONObject = {},
  options?: {
    sessionId?: string;
    source?: EventSource;
  }
): Promise<ActivityEvent> {
  const event: ActivityEvent = {
    id: generateId(),
    userId,
    ts: now(),
    type,
    entityType,
    entityId,
    sessionId: options?.sessionId,
    source: options?.source || 'web',
    payload,
  };

  await db.activityEvents.add(event);
  return event;
}

// ─── Query events ──────────────────────────────────────────────────────────

export async function getEvents(
  userId: string,
  options?: {
    from?: string;
    to?: string;
    type?: ActivityEventType;
    entityType?: EntityType;
    limit?: number;
  }
): Promise<ActivityEvent[]> {
  let collection = db.activityEvents
    .where('[userId+ts]')
    .between(
      [userId, options?.from || ''],
      [userId, options?.to || '\uffff']
    );

  let results = await collection.reverse().toArray();

  if (options?.type) {
    results = results.filter(e => e.type === options.type);
  }

  if (options?.entityType) {
    results = results.filter(e => e.entityType === options.entityType);
  }

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

// ─── Export events as NDJSON ────────────────────────────────────────────────

export async function exportEventsNDJSON(
  userId: string,
  options?: {
    from?: string;
    to?: string;
    markExported?: boolean;
  }
): Promise<string> {
  const events = await getEvents(userId, {
    from: options?.from,
    to: options?.to,
  });

  if (options?.markExported) {
    const exportTime = now();
    await db.transaction('rw', db.activityEvents, async () => {
      for (const event of events) {
        await db.activityEvents.update(event.id, { exportedAt: exportTime });
      }
    });
  }

  return events.map(e => JSON.stringify(e)).join('\n');
}

// ─── Generate daily summary ────────────────────────────────────────────────

export async function generateDailySummary(
  userId: string,
  date: string // YYYY-MM-DD
): Promise<DailySummary> {
  const startOfDay = `${date}T00:00:00.000Z`;
  const endOfDay = `${date}T23:59:59.999Z`;

  // Get review events for the day
  const reviewEvents = await db.activityEvents
    .where('[userId+ts]')
    .between([userId, startOfDay], [userId, endOfDay])
    .filter(e => e.type === 'card_reviewed')
    .toArray();

  // Get review logs for the day
  const reviewLogs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, endOfDay])
    .toArray();

  // Get sessions for the day
  const sessions = await db.studySessions
    .where('userId')
    .equals(userId)
    .filter(s => s.startedAt >= startOfDay && s.startedAt <= endOfDay)
    .toArray();

  // Calculate metrics
  const againCount = reviewLogs.filter(r => r.rating === 'again').length;
  const hardCount = reviewLogs.filter(r => r.rating === 'hard').length;
  const goodCount = reviewLogs.filter(r => r.rating === 'good').length;
  const easyCount = reviewLogs.filter(r => r.rating === 'easy').length;
  const totalReviews = reviewLogs.length;
  const correctCount = goodCount + easyCount;

  const totalTimeMs = reviewLogs.reduce((sum, r) => sum + r.responseTimeMs, 0);
  const avgResponseMs = totalReviews > 0 ? totalTimeMs / totalReviews : 0;

  const deckIds = new Set<string>();
  for (const event of reviewEvents) {
    const deckId = (event.payload as Record<string, unknown>)?.deckId;
    if (typeof deckId === 'string') deckIds.add(deckId);
  }

  // Check streak
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  const prevDateStr = previousDate.toISOString().split('T')[0];
  const prevSummary = await db.dailySummaries
    .where('[userId+date]')
    .equals([userId, prevDateStr])
    .first();

  const streak = totalReviews > 0
    ? (prevSummary?.metrics?.streak || 0) + 1
    : 0;

  const metrics: DailySummaryMetrics = {
    cardsStudied: totalReviews,
    newCardsStudied: reviewLogs.filter(r => r.previousState === 'new').length,
    reviewsCompleted: reviewLogs.filter(r => r.previousState === 'review').length,
    totalTimeMs,
    retentionRate: totalReviews > 0 ? correctCount / totalReviews : 0,
    againCount,
    hardCount,
    goodCount,
    easyCount,
    averageResponseTimeMs: avgResponseMs,
    sessionsCount: sessions.length,
    decksStudied: Array.from(deckIds),
    leeches: 0, // calculated separately
    streak,
  };

  const summary: DailySummary = {
    id: generateId(),
    userId,
    date,
    metrics,
    generatedAt: now(),
  };

  // Upsert
  const existing = await db.dailySummaries
    .where('[userId+date]')
    .equals([userId, date])
    .first();

  if (existing) {
    summary.id = existing.id;
    await db.dailySummaries.put(summary);
  } else {
    await db.dailySummaries.add(summary);
  }

  return summary;
}

// ─── Get summaries for a range ─────────────────────────────────────────────

export async function getSummaries(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<DailySummary[]> {
  return db.dailySummaries
    .where('[userId+date]')
    .between([userId, fromDate], [userId, toDate])
    .toArray();
}

// ─── Convenience event emitters ────────────────────────────────────────────

export const EventEmitters = {
  deckCreated: (userId: string, deckId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'deck_created', 'deck', deckId, payload),

  deckUpdated: (userId: string, deckId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'deck_updated', 'deck', deckId, payload),

  noteCreated: (userId: string, noteId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'note_created', 'note', noteId, payload),

  noteUpdated: (userId: string, noteId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'note_updated', 'note', noteId, payload),

  noteDeleted: (userId: string, noteId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'note_deleted', 'note', noteId, payload),

  cardReviewed: (
    userId: string,
    cardId: string,
    payload: JSONObject,
    sessionId?: string
  ) =>
    emitEvent(userId, 'card_reviewed', 'card', cardId, payload, { sessionId }),

  cardSuspended: (userId: string, cardId: string) =>
    emitEvent(userId, 'card_suspended', 'card', cardId),

  cardUnsuspended: (userId: string, cardId: string) =>
    emitEvent(userId, 'card_unsuspended', 'card', cardId),

  cardBuried: (userId: string, cardId: string) =>
    emitEvent(userId, 'card_buried', 'card', cardId),

  noteTypeCreated: (userId: string, noteTypeId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'note_type_created', 'note_type', noteTypeId, payload),

  presetChanged: (userId: string, presetId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'preset_changed', 'preset', presetId, payload),

  optimizerRun: (userId: string, presetId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'optimizer_run', 'preset', presetId, payload),

  studySessionStarted: (userId: string, sessionId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'study_session_started', 'session', sessionId, payload),

  studySessionFinished: (userId: string, sessionId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'study_session_finished', 'session', sessionId, payload),

  backupCreated: (userId: string, backupId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'backup_created', 'backup', backupId, payload),

  importRun: (userId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'import_run', 'deck', '', payload),

  exportRun: (userId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'export_run', 'deck', '', payload),

  aiImportStarted: (userId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'ai_import_started', 'note', '', payload),

  aiImportCompleted: (userId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'ai_import_completed', 'note', '', payload),

  syncStarted: (userId: string) =>
    emitEvent(userId, 'sync_started', 'user', userId),

  syncCompleted: (userId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'sync_completed', 'user', userId, payload),

  // Curriculum events
  curriculumProgramCreated: (userId: string, programId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_program_created', 'curriculum', programId, payload),

  curriculumSubjectCreated: (userId: string, subjectId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_subject_created', 'curriculum', subjectId, payload),

  curriculumModuleCreated: (userId: string, moduleId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_module_created', 'curriculum', moduleId, payload),

  curriculumChapterCreated: (userId: string, chapterId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_chapter_created', 'curriculum', chapterId, payload),

  curriculumTopicCreated: (userId: string, topicId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_topic_created', 'curriculum', topicId, payload),

  curriculumLinked: (userId: string, linkId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'curriculum_linked', 'curriculum', linkId, payload),

  personalSummaryGenerated: (userId: string, summaryId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'personal_summary_generated', 'summary', summaryId, payload),

  studyScopeSelected: (userId: string, sessionId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'study_scope_selected', 'session', sessionId, payload),

  highPriorityReviewCompleted: (userId: string, cardId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'high_priority_review_completed', 'card', cardId, payload),

  hardTopicRescued: (userId: string, cardId: string, payload: JSONObject = {}) =>
    emitEvent(userId, 'hard_topic_rescued', 'card', cardId, payload),
};
