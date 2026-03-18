import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import type { Card, CardCommand, Deck, Note, NoteType, ReviewLog, SchedulingPreset } from '@/types';
import {
  LOCAL_USER_ID,
  commitLocalUserMerge,
  discardLocalUserData,
  getLocalUserMergePreview,
} from '@/lib/services/local-merge-service';

const TARGET_USER_ID = 'merge-target-user';
const LOCAL_NOTE_TYPE_ID = 'merge-local-note-type';
const TARGET_NOTE_TYPE_ID = 'merge-target-note-type';
const LOCAL_TEMPLATE_ID = 'merge-local-template';
const TARGET_TEMPLATE_ID = 'merge-target-template';
const LOCAL_DECK_ID = 'merge-local-deck';
const TARGET_DECK_ID = 'merge-target-deck';
const LOCAL_NOTE_ID = 'merge-local-note';
const TARGET_NOTE_ID = 'merge-target-note';
const LOCAL_CARD_ID = 'merge-local-card';
const TARGET_CARD_ID = 'merge-target-card';

async function clearMergeFixtures() {
  await Promise.all([
    db.syncQueue.clear(),
    db.backups.clear(),
    db.cardCommands.clear(),
    db.reviewLogs.clear(),
    db.cards.clear(),
    db.notes.clear(),
    db.noteTypes.clear(),
    db.presets.clear(),
    db.decks.clear(),
    db.tags.clear(),
    db.flags.clear(),
    db.savedSearches.clear(),
    db.filteredDecks.clear(),
    db.mediaAssets.clear(),
    db.studySessions.clear(),
    db.activityEvents.clear(),
    db.dailySummaries.clear(),
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

function makeNoteType(userId: string, id: string, templateId: string): NoteType {
  return {
    id,
    userId,
    name: 'Basic',
    description: 'Basic card',
    kind: 'basic',
    css: '',
    version: 1,
    fields: [
      {
        id: `${id}-front`,
        noteTypeId: id,
        name: 'Front',
        ordinal: 0,
        required: true,
        sticky: false,
        rtl: false,
        uniqueBehavior: 'none',
        inputType: 'richtext',
      },
      {
        id: `${id}-back`,
        noteTypeId: id,
        name: 'Back',
        ordinal: 1,
        required: true,
        sticky: false,
        rtl: false,
        uniqueBehavior: 'none',
        inputType: 'richtext',
      },
    ],
    templates: [
      {
        id: templateId,
        noteTypeId: id,
        name: 'Card 1',
        frontTemplate: '{{Front}}',
        backTemplate: '{{Back}}',
        ordinal: 0,
        active: true,
        generationRules: {},
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePreset(userId: string): SchedulingPreset {
  return {
    id: `preset-${userId}`,
    userId,
    name: 'Default',
    desiredRetention: 0.9,
    learningSteps: [1, 10],
    relearningSteps: [10],
    maximumInterval: 36500,
    enableFuzz: true,
    buryNewSiblings: true,
    buryReviewSiblings: false,
    newCardOrder: 'sequential',
    reviewOrder: 'due_date',
    dailyLimits: { newCards: 20, reviews: 200 },
    fsrsParameters: [],
    optimizerMetadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeDeck(userId: string, id: string): Deck {
  return {
    id,
    userId,
    name: 'Anatomia',
    description: '',
    parentDeckId: null,
    sortOrder: 0,
    archived: false,
    presetId: `preset-${userId}`,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeNote(userId: string, id: string, deckId: string, noteTypeId: string, tags: string[]): Note {
  return {
    id,
    userId,
    deckId,
    noteTypeId,
    fieldValues: { Front: 'Q', Back: 'A' },
    tags,
    source: 'manual',
    sourceMetadata: {
      externalId: 'ext-1',
      duplicateKey: 'dup-1',
      academic: {
        subject: 'Anatomia',
      },
    },
    hash: 'hash-merge-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    suspended: false,
  };
}

function makeCard(userId: string, id: string, noteId: string, deckId: string, templateId: string): Card {
  return {
    id,
    userId,
    noteId,
    templateId,
    deckId,
    dueAt: '2026-01-01T00:00:00.000Z',
    state: 'new',
    queuePosition: 0,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    lastReviewAt: null,
    suspended: false,
    buriedUntil: null,
    customData: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeReviewLog(): ReviewLog {
  return {
    id: 'merge-local-log',
    userId: LOCAL_USER_ID,
    cardId: LOCAL_CARD_ID,
    reviewedAt: '2026-01-02T00:00:00.000Z',
    clientReviewedAt: '2026-01-02T00:00:00.000Z',
    serverReceivedAt: null,
    effectiveReviewedAt: '2026-01-02T00:00:00.000Z',
    offsetMeasuredAt: '2026-01-02T00:00:00.000Z',
    timeSource: 'client',
    rating: 'good',
    previousState: 'new',
    nextState: 'review',
    previousDueAt: '2026-01-01T00:00:00.000Z',
    nextDueAt: '2026-01-03T00:00:00.000Z',
    previousStability: 0,
    nextStability: 2,
    previousDifficulty: 0,
    nextDifficulty: 5,
    responseTimeMs: 1200,
    wasManualReschedule: false,
    wasFilteredDeck: false,
    sessionId: null,
    deviceId: 'device-local',
    deviceSeq: 1,
    clockOffsetMs: 0,
    replayOrdinal: null,
    schedulerContext: {},
    syncStatus: 'pending',
  };
}

function makeCardCommand(): CardCommand {
  return {
    id: 'merge-local-command',
    userId: LOCAL_USER_ID,
    cardId: LOCAL_CARD_ID,
    command: 'suspend',
    payload: {},
    clientIssuedAt: '2026-01-03T00:00:00.000Z',
    serverReceivedAt: null,
    effectiveAt: '2026-01-03T00:00:00.000Z',
    offsetMeasuredAt: '2026-01-03T00:00:00.000Z',
    timeSource: 'client',
    deviceId: 'device-local',
    deviceSeq: 2,
    clockOffsetMs: 0,
    createdAt: '2026-01-03T00:00:00.000Z',
  };
}

async function seedDuplicateScenario() {
  await db.presets.bulkAdd([makePreset(LOCAL_USER_ID), makePreset(TARGET_USER_ID)]);
  await db.decks.bulkAdd([makeDeck(LOCAL_USER_ID, LOCAL_DECK_ID), makeDeck(TARGET_USER_ID, TARGET_DECK_ID)]);
  await db.noteTypes.bulkAdd([
    makeNoteType(LOCAL_USER_ID, LOCAL_NOTE_TYPE_ID, LOCAL_TEMPLATE_ID),
    makeNoteType(TARGET_USER_ID, TARGET_NOTE_TYPE_ID, TARGET_TEMPLATE_ID),
  ]);
  await db.notes.bulkAdd([
    makeNote(LOCAL_USER_ID, LOCAL_NOTE_ID, LOCAL_DECK_ID, LOCAL_NOTE_TYPE_ID, ['local']),
    makeNote(TARGET_USER_ID, TARGET_NOTE_ID, TARGET_DECK_ID, TARGET_NOTE_TYPE_ID, ['remote']),
  ]);
  await db.cards.bulkAdd([
    makeCard(LOCAL_USER_ID, LOCAL_CARD_ID, LOCAL_NOTE_ID, LOCAL_DECK_ID, LOCAL_TEMPLATE_ID),
    makeCard(TARGET_USER_ID, TARGET_CARD_ID, TARGET_NOTE_ID, TARGET_DECK_ID, TARGET_TEMPLATE_ID),
  ]);
  await db.reviewLogs.add(makeReviewLog());
  await db.cardCommands.add(makeCardCommand());
}

beforeEach(async () => {
  await clearMergeFixtures();
});

describe('local-user merge service', () => {
  it('builds a preview that detects duplicate notes and reusable structures', async () => {
    await seedDuplicateScenario();

    const preview = await getLocalUserMergePreview(TARGET_USER_ID);

    expect(preview.hasLocalData).toBe(true);
    expect(preview.localCounts.notes).toBe(1);
    expect(preview.mergeCounts.deckReuses).toBe(1);
    expect(preview.mergeCounts.noteTypeReuses).toBe(1);
    expect(preview.mergeCounts.notesToMerge).toBe(1);
    expect(preview.mergeCounts.notesToCreate).toBe(0);
    expect(preview.duplicateExamples[0]?.matchedNoteId).toBe(TARGET_NOTE_ID);
  });

  it('commits a local merge, reassigns logs/commands and preserves a backup', async () => {
    await seedDuplicateScenario();

    const result = await commitLocalUserMerge(TARGET_USER_ID);

    expect(result.backupId).toBeTruthy();
    expect(result.reused.decks).toBe(1);
    expect(result.reused.noteTypes).toBe(1);
    expect(result.reused.notes).toBe(1);
    expect(result.reviewLogsMigrated).toBe(1);
    expect(result.cardCommandsMigrated).toBe(1);

    const localNotes = await db.notes.where('userId').equals(LOCAL_USER_ID).count();
    expect(localNotes).toBe(0);

    const targetNote = await db.notes.get(TARGET_NOTE_ID);
    expect(targetNote?.tags.sort()).toEqual(['local', 'remote']);

    const migratedLog = await db.reviewLogs.get('merge-local-log');
    expect(migratedLog?.userId).toBe(TARGET_USER_ID);
    expect(migratedLog?.cardId).toBe(TARGET_CARD_ID);

    const migratedCommand = await db.cardCommands.get('merge-local-command');
    expect(migratedCommand?.userId).toBe(TARGET_USER_ID);
    expect(migratedCommand?.cardId).toBe(TARGET_CARD_ID);

    const targetBackups = await db.backups.where('userId').equals(TARGET_USER_ID).toArray();
    expect(targetBackups.some((backup) => backup.id === result.backupId)).toBe(true);

    const queued = await db.syncQueue.toArray();
    expect(queued.some((item) => item.table === 'reviewLogs' && item.recordId === 'merge-local-log')).toBe(true);
    expect(queued.some((item) => item.table === 'cardCommands' && item.recordId === 'merge-local-command')).toBe(true);
  });

  it('can discard local data after saving a portable backup', async () => {
    await seedDuplicateScenario();

    const result = await discardLocalUserData(TARGET_USER_ID);

    expect(result.backupId).toBeTruthy();
    expect(result.deletedRecords).toBeGreaterThan(0);
    expect(await db.notes.where('userId').equals(LOCAL_USER_ID).count()).toBe(0);
    expect(await db.cards.where('userId').equals(LOCAL_USER_ID).count()).toBe(0);

    const targetBackups = await db.backups.where('userId').equals(TARGET_USER_ID).toArray();
    expect(targetBackups.some((backup) => backup.id === result.backupId)).toBe(true);
  });
});
