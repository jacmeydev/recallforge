// ============================================================================
// RecallForge — Local Database (Dexie / IndexedDB)
// ============================================================================
// Local-first: all data lives here first, syncs to server later.
// ============================================================================

import Dexie, { type EntityTable } from 'dexie';
import { getClientDeviceId } from '@/lib/sync/device';
import type {
  Deck,
  SchedulingPreset,
  NoteType,
  Note,
  Card,
  ReviewLog,
  CardCommand,
  Tag,
  Flag,
  SavedSearch,
  FilteredDeck,
  MediaAsset,
  BackupSnapshot,
  StudySession,
  ActivityEvent,
  DailySummary,
  SyncQueueItem,
  XPEntry,
  UserGamification,
  Quest,
  CurriculumProgram,
  CurriculumSubject,
  CurriculumModule,
  CurriculumChapter,
  CurriculumTopic,
  CurriculumLink,
  PersonalSummary,
  OptimizationRun,
} from '@/types';

// ─── Database class ────────────────────────────────────────────────────────

class RecallForgeDB extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  presets!: EntityTable<SchedulingPreset, 'id'>;
  noteTypes!: EntityTable<NoteType, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  cardCommands!: EntityTable<CardCommand, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  flags!: EntityTable<Flag, 'id'>;
  savedSearches!: EntityTable<SavedSearch, 'id'>;
  filteredDecks!: EntityTable<FilteredDeck, 'id'>;
  mediaAssets!: EntityTable<MediaAsset, 'id'>;
  backups!: EntityTable<BackupSnapshot, 'id'>;
  studySessions!: EntityTable<StudySession, 'id'>;
  activityEvents!: EntityTable<ActivityEvent, 'id'>;
  dailySummaries!: EntityTable<DailySummary, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;
  xpLedger!: EntityTable<XPEntry, 'id'>;
  userGamification!: EntityTable<UserGamification, 'id'>;
  quests!: EntityTable<Quest, 'id'>;
  curriculumPrograms!: EntityTable<CurriculumProgram, 'id'>;
  curriculumSubjects!: EntityTable<CurriculumSubject, 'id'>;
  curriculumModules!: EntityTable<CurriculumModule, 'id'>;
  curriculumChapters!: EntityTable<CurriculumChapter, 'id'>;
  curriculumTopics!: EntityTable<CurriculumTopic, 'id'>;
  curriculumLinks!: EntityTable<CurriculumLink, 'id'>;
  personalSummaries!: EntityTable<PersonalSummary, 'id'>;
  optimizationRuns!: EntityTable<OptimizationRun, 'id'>;

  constructor() {
    super('RecallForgeDB');

    this.version(1).stores({
      decks: 'id, userId, parentDeckId, name, archived, createdAt, updatedAt',
      presets: 'id, userId, name',
      noteTypes: 'id, userId, name, kind',
      notes: 'id, userId, deckId, noteTypeId, *tags, hash, createdAt, updatedAt, suspended',
      cards: 'id, userId, noteId, templateId, deckId, dueAt, state, suspended, [userId+deckId+state], [userId+state+dueAt], [userId+deckId+dueAt]',
      reviewLogs: 'id, userId, cardId, reviewedAt, rating, sessionId, syncStatus, [userId+reviewedAt]',
      cardCommands: 'id, userId, cardId, command, createdAt, [userId+cardId+createdAt]',
      tags: 'id, userId, name',
      flags: 'id, userId, cardId, color',
      savedSearches: 'id, userId, name',
      filteredDecks: 'id, userId, name',
      mediaAssets: 'id, userId, hash, storageKey, mimeType',
      backups: 'id, userId, type, createdAt',
      studySessions: 'id, userId, startedAt, endedAt',
      activityEvents: 'id, userId, ts, type, entityType, entityId, [userId+ts], [userId+type]',
      dailySummaries: 'id, userId, date, [userId+date]',
      syncQueue: 'id, table, recordId, operation, createdAt',
      xpLedger: 'id, userId, ts, source, [userId+ts]',
      userGamification: 'id, userId',
      quests: 'id, userId, status, frequency, startDate, [userId+status]',
    });

    this.version(2).stores({
      curriculumPrograms: 'id, userId, name',
      curriculumSubjects: 'id, userId, programId, name, [userId+programId]',
      curriculumModules: 'id, userId, subjectId, name, [userId+subjectId]',
      curriculumChapters: 'id, userId, moduleId, name, [userId+moduleId]',
      curriculumTopics: 'id, userId, chapterId, name, [userId+chapterId]',
      curriculumLinks: 'id, userId, noteId, cardId, deckId, subjectId, moduleId, chapterId, topicId, [userId+noteId], [userId+deckId], [userId+subjectId], [userId+topicId]',
      personalSummaries: 'id, userId, period, date, [userId+date], [userId+period]',
    });

    this.version(3).stores({
      optimizationRuns: 'id, userId, presetId, createdAt, [userId+presetId]',
    });

    this.version(4).stores({
      cardCommands: 'id, userId, cardId, command, effectiveAt, createdAt, [userId+cardId+effectiveAt]',
    });
  }
}

// Singleton instance
export const db = new RecallForgeDB();

// ─── Helper: Queue sync operation ──────────────────────────────────────────

export async function queueSync(
  table: string,
  recordId: string,
  operation: 'create' | 'update' | 'delete',
  data: Record<string, unknown>
) {
  const { generateId, now } = await import('@/lib/utils');
  const createdAt = now();
  const operationId = generateId();
  await db.syncQueue.add({
    id: generateId(),
    operationId,
    table,
    recordId,
    operation,
    data: data as Record<string, string | number | boolean | null>,
    deviceId: getClientDeviceId(),
    clientUpdatedAt: createdAt,
    createdAt,
    retries: 0,
  });
  // Notify sync manager to debounce a push
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('recallforge:sync-queue-changed'));
  }
}

// ─── Helper: Clear all local data ─────────────────────────────────────────

export async function clearAllLocalData() {
  await db.transaction(
    'rw',
    [
      db.decks, db.presets, db.noteTypes, db.notes, db.cards,
      db.reviewLogs, db.tags, db.flags, db.savedSearches,
      db.cardCommands,
      db.filteredDecks, db.mediaAssets, db.backups, db.studySessions,
      db.activityEvents, db.dailySummaries, db.syncQueue,
      db.xpLedger, db.userGamification, db.quests,
      db.curriculumPrograms, db.curriculumSubjects, db.curriculumModules,
      db.curriculumChapters, db.curriculumTopics, db.curriculumLinks,
      db.personalSummaries,
      db.optimizationRuns,
    ],
    async () => {
      await Promise.all([
        db.decks.clear(),
        db.presets.clear(),
        db.noteTypes.clear(),
        db.notes.clear(),
        db.cards.clear(),
        db.reviewLogs.clear(),
        db.cardCommands.clear(),
        db.tags.clear(),
        db.flags.clear(),
        db.savedSearches.clear(),
        db.filteredDecks.clear(),
        db.mediaAssets.clear(),
        db.backups.clear(),
        db.studySessions.clear(),
        db.activityEvents.clear(),
        db.dailySummaries.clear(),
        db.syncQueue.clear(),
        db.xpLedger.clear(),
        db.userGamification.clear(),
        db.quests.clear(),
        db.curriculumPrograms.clear(),
        db.curriculumSubjects.clear(),
        db.curriculumModules.clear(),
        db.curriculumChapters.clear(),
        db.curriculumTopics.clear(),
        db.curriculumLinks.clear(),
        db.personalSummaries.clear(),
        db.optimizationRuns.clear(),
      ]);
    }
  );
}

export default db;
