import { db, queueSync } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import type {
  ActivityEvent,
  BackupSnapshot,
  Card,
  CardCommand,
  CurriculumChapter,
  CurriculumLink,
  CurriculumModule,
  CurriculumProgram,
  CurriculumSubject,
  CurriculumTopic,
  Deck,
  Flag,
  MediaAsset,
  Note,
  NoteType,
  OptimizationRun,
  PersonalSummary,
  ReviewLog,
  SavedSearch,
  SchedulingPreset,
  StudySession,
  Tag,
  UserGamification,
  XPEntry,
  Quest,
  JSONObject,
  FilteredDeck,
} from '@/types';
import { exportAllData } from '@/lib/services/import-export-service';

export const LOCAL_USER_ID = 'local-user';

export interface LocalUserMergePreview {
  targetUserId: string;
  hasLocalData: boolean;
  localCounts: {
    decks: number;
    presets: number;
    noteTypes: number;
    notes: number;
    cards: number;
    reviewLogs: number;
    cardCommands: number;
    curriculumNodes: number;
    curriculumLinks: number;
    activityEvents: number;
    auxiliaryRecords: number;
  };
  mergeCounts: {
    deckCreates: number;
    deckReuses: number;
    presetCreates: number;
    presetReuses: number;
    noteTypeCreates: number;
    noteTypeReuses: number;
    notesToCreate: number;
    notesToMerge: number;
    cardsToCreate: number;
    reviewLogsToReplay: number;
    cardCommandsToReplay: number;
    curriculumCreates: number;
    curriculumReuses: number;
    auxiliaryToReassign: number;
  };
  duplicateExamples: Array<{
    noteId: string;
    matchedNoteId: string;
    reason: 'externalId' | 'duplicateKey' | 'hash';
  }>;
}

export interface LocalUserMergeResult {
  targetUserId: string;
  backupId: string | null;
  created: {
    decks: number;
    presets: number;
    noteTypes: number;
    notes: number;
    cards: number;
    curriculum: number;
  };
  reused: {
    decks: number;
    presets: number;
    noteTypes: number;
    notes: number;
    curriculum: number;
  };
  mergedNotes: number;
  reviewLogsMigrated: number;
  cardCommandsMigrated: number;
  activityEventsMigrated: number;
  auxiliaryRecordsReassigned: number;
  syncOperationsQueued: number;
  localRecordsDiscarded: number;
}

interface PreviewContext {
  localDecks: Deck[];
  targetDecks: Deck[];
  localPresets: SchedulingPreset[];
  targetPresets: SchedulingPreset[];
  localNoteTypes: NoteType[];
  targetNoteTypes: NoteType[];
  localNotes: Note[];
  targetNotes: Note[];
  localCards: Card[];
  targetCards: Card[];
  localReviewLogs: ReviewLog[];
  localCardCommands: CardCommand[];
  localPrograms: CurriculumProgram[];
  targetPrograms: CurriculumProgram[];
  localSubjects: CurriculumSubject[];
  targetSubjects: CurriculumSubject[];
  localModules: CurriculumModule[];
  targetModules: CurriculumModule[];
  localChapters: CurriculumChapter[];
  targetChapters: CurriculumChapter[];
  localTopics: CurriculumTopic[];
  targetTopics: CurriculumTopic[];
  localLinks: CurriculumLink[];
  targetLinks: CurriculumLink[];
  localActivityEvents: ActivityEvent[];
  localAuxiliaryCount: number;
}

interface InternalMergePlan {
  preview: LocalUserMergePreview;
}

function normalizeString(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortObject(nested)])
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function tableKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part == null ? '' : String(part)))
    .join('::');
}

function parseMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractNoteIdentity(note: Note): Array<{ key: string; reason: 'externalId' | 'duplicateKey' | 'hash' }> {
  const keys: Array<{ key: string; reason: 'externalId' | 'duplicateKey' | 'hash' }> = [];
  const metadata = parseMetadataObject(note.sourceMetadata);
  const externalId = typeof metadata.externalId === 'string' ? metadata.externalId.trim() : '';
  const duplicateKey = typeof metadata.duplicateKey === 'string' ? metadata.duplicateKey.trim() : '';

  if (externalId) {
    keys.push({ key: `external:${externalId}`, reason: 'externalId' });
  }
  if (duplicateKey) {
    keys.push({ key: `duplicate:${duplicateKey}`, reason: 'duplicateKey' });
  }
  if (note.hash) {
    keys.push({ key: `hash:${note.hash}`, reason: 'hash' });
  }
  return keys;
}

function buildNoteIdentityIndex(notes: Note[]): Map<string, { note: Note; reason: 'externalId' | 'duplicateKey' | 'hash' }> {
  const index = new Map<string, { note: Note; reason: 'externalId' | 'duplicateKey' | 'hash' }>();
  for (const note of notes) {
    for (const identity of extractNoteIdentity(note)) {
      if (!index.has(identity.key)) {
        index.set(identity.key, { note, reason: identity.reason });
      }
    }
  }
  return index;
}

function mergeAcademicMetadata(existing: JSONObject | undefined, incoming: JSONObject | undefined): JSONObject | undefined {
  const current = parseMetadataObject(existing);
  const next = parseMetadataObject(incoming);

  if (Object.keys(current).length === 0 && Object.keys(next).length === 0) {
    return undefined;
  }

  const merged: Record<string, unknown> = { ...current, ...next };
  const currentAcademic = parseMetadataObject(current.academic);
  const nextAcademic = parseMetadataObject(next.academic);
  merged.academic = Object.fromEntries(
    Object.entries({ ...currentAcademic, ...nextAcademic }).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

  return merged as JSONObject;
}

function noteTypeSignature(noteType: NoteType): string {
  return stableStringify({
    name: normalizeString(noteType.name),
    kind: noteType.kind,
    fields: [...noteType.fields]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((field) => ({
        name: normalizeString(field.name),
        ordinal: field.ordinal,
        required: field.required,
        inputType: field.inputType,
      })),
    templates: [...noteType.templates]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((template) => ({
        name: normalizeString(template.name),
        ordinal: template.ordinal,
        active: template.active,
      })),
  });
}

function presetSignature(preset: SchedulingPreset): string {
  return stableStringify({
    name: normalizeString(preset.name),
    desiredRetention: preset.desiredRetention,
    maximumInterval: preset.maximumInterval,
    enableFuzz: preset.enableFuzz,
    learningSteps: preset.learningSteps,
    relearningSteps: preset.relearningSteps,
    fsrsParameters: preset.fsrsParameters,
  });
}

function buildDeckDepth(deck: Deck, byId: Map<string, Deck>): number {
  let depth = 0;
  let current = deck.parentDeckId ? byId.get(deck.parentDeckId) : undefined;
  while (current) {
    depth += 1;
    current = current.parentDeckId ? byId.get(current.parentDeckId) : undefined;
  }
  return depth;
}

function getDeckPath(deck: Deck, byId: Map<string, Deck>): string {
  const parts: string[] = [normalizeString(deck.name)];
  let current = deck.parentDeckId ? byId.get(deck.parentDeckId) : undefined;
  while (current) {
    parts.unshift(normalizeString(current.name));
    current = current.parentDeckId ? byId.get(current.parentDeckId) : undefined;
  }
  return parts.join('/');
}

function buildTemplateMap(localType: NoteType, targetType: NoteType): Map<string, string> {
  const map = new Map<string, string>();
  const bySignature = new Map<string, string>();

  for (const template of targetType.templates) {
    bySignature.set(tableKey([normalizeString(template.name), template.ordinal]), template.id);
  }

  for (const template of localType.templates) {
    const key = tableKey([normalizeString(template.name), template.ordinal]);
    const targetId = bySignature.get(key) ?? targetType.templates.find((candidate) => candidate.ordinal === template.ordinal)?.id;
    if (targetId) {
      map.set(template.id, targetId);
    }
  }

  return map;
}

function cardSignature(noteId: string, templateId: string, customData: JSONObject): string {
  return tableKey([noteId, templateId, stableStringify(customData)]);
}

function eventEntityId(event: ActivityEvent, mappings: MergeMappings): string {
  switch (event.entityType) {
    case 'deck':
      return mappings.deckId.get(event.entityId) ?? event.entityId;
    case 'note':
      return mappings.noteId.get(event.entityId) ?? event.entityId;
    case 'card':
      return mappings.cardId.get(event.entityId) ?? event.entityId;
    case 'note_type':
      return mappings.noteTypeId.get(event.entityId) ?? event.entityId;
    case 'preset':
      return mappings.presetId.get(event.entityId) ?? event.entityId;
    case 'curriculum':
      return mappings.curriculumAnyId.get(event.entityId) ?? event.entityId;
    default:
      return event.entityId;
  }
}

function ensureUniqueId(id: string, occupied: Set<string>): string {
  if (!occupied.has(id)) {
    occupied.add(id);
    return id;
  }

  let nextId = generateId();
  while (occupied.has(nextId)) {
    nextId = generateId();
  }
  occupied.add(nextId);
  return nextId;
}

function auxiliaryCount(context: {
  localTags: Tag[];
  localFlags: Flag[];
  localSavedSearches: SavedSearch[];
  localFilteredDecks: FilteredDeck[];
  localMediaAssets: MediaAsset[];
  localBackups: BackupSnapshot[];
  localStudySessions: StudySession[];
  localDailySummaries: Array<{ id: string }>;
  localXPEntries: XPEntry[];
  localGamification: UserGamification | undefined;
  localQuests: Quest[];
  localPersonalSummaries: PersonalSummary[];
  localOptimizationRuns: OptimizationRun[];
}): number {
  return (
    context.localTags.length +
    context.localFlags.length +
    context.localSavedSearches.length +
    context.localFilteredDecks.length +
    context.localMediaAssets.length +
    context.localBackups.length +
    context.localStudySessions.length +
    context.localDailySummaries.length +
    context.localXPEntries.length +
    (context.localGamification ? 1 : 0) +
    context.localQuests.length +
    context.localPersonalSummaries.length +
    context.localOptimizationRuns.length
  );
}

interface MergeMappings {
  deckId: Map<string, string>;
  presetId: Map<string, string>;
  noteTypeId: Map<string, string>;
  templateIdByNoteType: Map<string, Map<string, string>>;
  noteId: Map<string, string>;
  cardId: Map<string, string>;
  curriculumProgramId: Map<string, string>;
  curriculumSubjectId: Map<string, string>;
  curriculumModuleId: Map<string, string>;
  curriculumChapterId: Map<string, string>;
  curriculumTopicId: Map<string, string>;
  curriculumAnyId: Map<string, string>;
}

async function getPreviewContext(targetUserId: string): Promise<PreviewContext> {
  const [
    localDecks,
    targetDecks,
    localPresets,
    targetPresets,
    localNoteTypes,
    targetNoteTypes,
    localNotes,
    targetNotes,
    localCards,
    targetCards,
    localReviewLogs,
    localCardCommands,
    localPrograms,
    targetPrograms,
    localSubjects,
    targetSubjects,
    localModules,
    targetModules,
    localChapters,
    targetChapters,
    localTopics,
    targetTopics,
    localLinks,
    targetLinks,
    localActivityEvents,
    localTags,
    localFlags,
    localSavedSearches,
    localFilteredDecks,
    localMediaAssets,
    localBackups,
    localStudySessions,
    localDailySummaries,
    localXPEntries,
    localGamification,
    localQuests,
    localPersonalSummaries,
    localOptimizationRuns,
  ] = await Promise.all([
    db.decks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.decks.where('userId').equals(targetUserId).toArray(),
    db.presets.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.presets.where('userId').equals(targetUserId).toArray(),
    db.noteTypes.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.noteTypes.where('userId').equals(targetUserId).toArray(),
    db.notes.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.notes.where('userId').equals(targetUserId).toArray(),
    db.cards.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.cards.where('userId').equals(targetUserId).toArray(),
    db.reviewLogs.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.cardCommands.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumPrograms.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumPrograms.where('userId').equals(targetUserId).toArray(),
    db.curriculumSubjects.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumSubjects.where('userId').equals(targetUserId).toArray(),
    db.curriculumModules.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumModules.where('userId').equals(targetUserId).toArray(),
    db.curriculumChapters.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumChapters.where('userId').equals(targetUserId).toArray(),
    db.curriculumTopics.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumTopics.where('userId').equals(targetUserId).toArray(),
    db.curriculumLinks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumLinks.where('userId').equals(targetUserId).toArray(),
    db.activityEvents.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.tags.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.flags.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.savedSearches.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.filteredDecks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.mediaAssets.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.backups.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.studySessions.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.dailySummaries.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.xpLedger.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.userGamification.where('userId').equals(LOCAL_USER_ID).first(),
    db.quests.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.personalSummaries.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.optimizationRuns.where('userId').equals(LOCAL_USER_ID).toArray(),
  ]);

  return {
    localDecks,
    targetDecks,
    localPresets,
    targetPresets,
    localNoteTypes,
    targetNoteTypes,
    localNotes,
    targetNotes,
    localCards,
    targetCards,
    localReviewLogs,
    localCardCommands,
    localPrograms,
    targetPrograms,
    localSubjects,
    targetSubjects,
    localModules,
    targetModules,
    localChapters,
    targetChapters,
    localTopics,
    targetTopics,
    localLinks,
    targetLinks,
    localActivityEvents,
    localAuxiliaryCount: auxiliaryCount({
      localTags,
      localFlags,
      localSavedSearches,
      localFilteredDecks,
      localMediaAssets,
      localBackups,
      localStudySessions,
      localDailySummaries,
      localXPEntries,
      localGamification,
      localQuests,
      localPersonalSummaries,
      localOptimizationRuns,
    }),
  };
}

async function buildPreview(targetUserId: string): Promise<InternalMergePlan> {
  const context = await getPreviewContext(targetUserId);
  const noteIndex = buildNoteIdentityIndex(context.targetNotes);

  const localDecksById = new Map(context.localDecks.map((deck) => [deck.id, deck]));
  const targetDecksByPath = new Map(
    context.targetDecks.map((deck) => [getDeckPath(deck, new Map(context.targetDecks.map((entry) => [entry.id, entry]))), deck])
  );
  const localDecksSorted = [...context.localDecks].sort(
    (left, right) => buildDeckDepth(left, localDecksById) - buildDeckDepth(right, localDecksById)
  );

  let deckCreates = 0;
  let deckReuses = 0;
  for (const deck of localDecksSorted) {
    if (targetDecksByPath.has(getDeckPath(deck, localDecksById))) {
      deckReuses += 1;
    } else {
      deckCreates += 1;
    }
  }

  const targetPresetsBySignature = new Map(context.targetPresets.map((preset) => [presetSignature(preset), preset]));
  let presetCreates = 0;
  let presetReuses = 0;
  for (const preset of context.localPresets) {
    if (targetPresetsBySignature.has(presetSignature(preset))) {
      presetReuses += 1;
    } else {
      presetCreates += 1;
    }
  }

  const targetNoteTypesBySignature = new Map(context.targetNoteTypes.map((noteType) => [noteTypeSignature(noteType), noteType]));
  let noteTypeCreates = 0;
  let noteTypeReuses = 0;
  for (const noteType of context.localNoteTypes) {
    if (targetNoteTypesBySignature.has(noteTypeSignature(noteType))) {
      noteTypeReuses += 1;
    } else {
      noteTypeCreates += 1;
    }
  }

  let notesToCreate = 0;
  let notesToMerge = 0;
  const duplicateExamples: LocalUserMergePreview['duplicateExamples'] = [];
  for (const note of context.localNotes) {
    const match = extractNoteIdentity(note)
      .map((identity) => noteIndex.get(identity.key))
      .find((candidate) => candidate);
    if (match) {
      notesToMerge += 1;
      if (duplicateExamples.length < 5) {
        duplicateExamples.push({
          noteId: note.id,
          matchedNoteId: match.note.id,
          reason: match.reason,
        });
      }
    } else {
      notesToCreate += 1;
    }
  }

  const targetProgramIndex = new Map(
    context.targetPrograms.map((program) => [
      tableKey([normalizeString(program.name), normalizeString(program.career), program.year ?? '', program.semester ?? '']),
      program,
    ])
  );
  let curriculumCreates = 0;
  let curriculumReuses = 0;
  for (const program of context.localPrograms) {
    if (targetProgramIndex.has(tableKey([normalizeString(program.name), normalizeString(program.career), program.year ?? '', program.semester ?? '']))) {
      curriculumReuses += 1;
    } else {
      curriculumCreates += 1;
    }
  }
  curriculumCreates += context.localSubjects.length + context.localModules.length + context.localChapters.length + context.localTopics.length;

  const preview: LocalUserMergePreview = {
    targetUserId,
    hasLocalData:
      context.localDecks.length > 0 ||
      context.localNotes.length > 0 ||
      context.localReviewLogs.length > 0 ||
      context.localCardCommands.length > 0 ||
      context.localAuxiliaryCount > 0 ||
      context.localPrograms.length > 0,
    localCounts: {
      decks: context.localDecks.length,
      presets: context.localPresets.length,
      noteTypes: context.localNoteTypes.length,
      notes: context.localNotes.length,
      cards: context.localCards.length,
      reviewLogs: context.localReviewLogs.length,
      cardCommands: context.localCardCommands.length,
      curriculumNodes:
        context.localPrograms.length +
        context.localSubjects.length +
        context.localModules.length +
        context.localChapters.length +
        context.localTopics.length,
      curriculumLinks: context.localLinks.length,
      activityEvents: context.localActivityEvents.length,
      auxiliaryRecords: context.localAuxiliaryCount,
    },
    mergeCounts: {
      deckCreates,
      deckReuses,
      presetCreates,
      presetReuses,
      noteTypeCreates,
      noteTypeReuses,
      notesToCreate,
      notesToMerge,
      cardsToCreate: context.localCards.length,
      reviewLogsToReplay: context.localReviewLogs.length,
      cardCommandsToReplay: context.localCardCommands.length,
      curriculumCreates,
      curriculumReuses,
      auxiliaryToReassign: context.localAuxiliaryCount,
    },
    duplicateExamples,
  };

  return { preview };
}

export async function getLocalUserMergePreview(targetUserId: string): Promise<LocalUserMergePreview> {
  const plan = await buildPreview(targetUserId);
  return plan.preview;
}

async function createPortableBackup(ownerUserId: string, sourceUserId: string, label: string): Promise<BackupSnapshot> {
  const jsonData = await exportAllData(sourceUserId);
  const blob = new Blob([jsonData], { type: 'application/json' });
  const backup: BackupSnapshot = {
    id: generateId(),
    userId: ownerUserId,
    type: 'pre_operation',
    label,
    data: blob,
    createdAt: now(),
    metadata: {
      size: blob.size,
      sourceUserId,
      version: 1,
    },
  };

  await db.backups.add(backup);
  return backup;
}

function mapGamification(existing: UserGamification | undefined, local: UserGamification | undefined, targetUserId: string): UserGamification | undefined {
  if (!existing && !local) return undefined;
  if (!existing && local) {
    return { ...local, userId: targetUserId };
  }
  if (existing && !local) return existing;

  return {
    ...existing!,
    totalXP: Math.max(existing!.totalXP, local!.totalXP),
    level: Math.max(existing!.level, local!.level),
    currentStreak: Math.max(existing!.currentStreak, local!.currentStreak),
    longestStreak: Math.max(existing!.longestStreak, local!.longestStreak),
    streakFreezes: Math.max(existing!.streakFreezes, local!.streakFreezes),
    lastStudyDate: normalizeString(existing!.lastStudyDate) >= normalizeString(local!.lastStudyDate)
      ? existing!.lastStudyDate
      : local!.lastStudyDate,
    dailyGoal: existing!.dailyGoal || local!.dailyGoal,
    easyDayMultiplier: existing!.easyDayMultiplier || local!.easyDayMultiplier,
    achievements: Array.from(new Set([...existing!.achievements, ...local!.achievements])),
    updatedAt: laterIso(existing!.updatedAt, local!.updatedAt),
  };
}

function laterIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function buildCurriculumKey(name: string, parentId?: string | null, code?: string | null): string {
  return tableKey([normalizeString(name), parentId ?? '', normalizeString(code)]);
}

export async function commitLocalUserMerge(targetUserId: string): Promise<LocalUserMergeResult> {
  const preview = await getLocalUserMergePreview(targetUserId);
  if (!preview.hasLocalData) {
    return {
      targetUserId,
      backupId: null,
      created: { decks: 0, presets: 0, noteTypes: 0, notes: 0, cards: 0, curriculum: 0 },
      reused: { decks: 0, presets: 0, noteTypes: 0, notes: 0, curriculum: 0 },
      mergedNotes: 0,
      reviewLogsMigrated: 0,
      cardCommandsMigrated: 0,
      activityEventsMigrated: 0,
      auxiliaryRecordsReassigned: 0,
      syncOperationsQueued: 0,
      localRecordsDiscarded: 0,
    };
  }

  const backup = await createPortableBackup(targetUserId, LOCAL_USER_ID, `local-user-merge-${new Date().toISOString()}`);

  const [
    localDecks,
    targetDecks,
    localPresets,
    targetPresets,
    localNoteTypes,
    targetNoteTypes,
    localNotes,
    targetNotes,
    localCards,
    targetCards,
    localReviewLogs,
    targetReviewLogs,
    localCardCommands,
    targetCardCommands,
    localPrograms,
    targetPrograms,
    localSubjects,
    targetSubjects,
    localModules,
    targetModules,
    localChapters,
    targetChapters,
    localTopics,
    targetTopics,
    localLinks,
    targetLinks,
    localActivityEvents,
    targetActivityEvents,
    localTags,
    targetTags,
    localFlags,
    localSavedSearches,
    localFilteredDecks,
    localMediaAssets,
    localBackups,
    localStudySessions,
    localDailySummaries,
    targetDailySummaries,
    localXPEntries,
    targetXPEntries,
    localGamification,
    targetGamification,
    localQuests,
    targetQuests,
    localPersonalSummaries,
    targetPersonalSummaries,
    localOptimizationRuns,
    targetOptimizationRuns,
  ] = await Promise.all([
    db.decks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.decks.where('userId').equals(targetUserId).toArray(),
    db.presets.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.presets.where('userId').equals(targetUserId).toArray(),
    db.noteTypes.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.noteTypes.where('userId').equals(targetUserId).toArray(),
    db.notes.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.notes.where('userId').equals(targetUserId).toArray(),
    db.cards.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.cards.where('userId').equals(targetUserId).toArray(),
    db.reviewLogs.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.reviewLogs.where('userId').equals(targetUserId).toArray(),
    db.cardCommands.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.cardCommands.where('userId').equals(targetUserId).toArray(),
    db.curriculumPrograms.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumPrograms.where('userId').equals(targetUserId).toArray(),
    db.curriculumSubjects.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumSubjects.where('userId').equals(targetUserId).toArray(),
    db.curriculumModules.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumModules.where('userId').equals(targetUserId).toArray(),
    db.curriculumChapters.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumChapters.where('userId').equals(targetUserId).toArray(),
    db.curriculumTopics.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumTopics.where('userId').equals(targetUserId).toArray(),
    db.curriculumLinks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.curriculumLinks.where('userId').equals(targetUserId).toArray(),
    db.activityEvents.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.activityEvents.where('userId').equals(targetUserId).toArray(),
    db.tags.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.tags.where('userId').equals(targetUserId).toArray(),
    db.flags.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.savedSearches.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.filteredDecks.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.mediaAssets.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.backups.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.studySessions.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.dailySummaries.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.dailySummaries.where('userId').equals(targetUserId).toArray(),
    db.xpLedger.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.xpLedger.where('userId').equals(targetUserId).toArray(),
    db.userGamification.where('userId').equals(LOCAL_USER_ID).first(),
    db.userGamification.where('userId').equals(targetUserId).first(),
    db.quests.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.quests.where('userId').equals(targetUserId).toArray(),
    db.personalSummaries.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.personalSummaries.where('userId').equals(targetUserId).toArray(),
    db.optimizationRuns.where('userId').equals(LOCAL_USER_ID).toArray(),
    db.optimizationRuns.where('userId').equals(targetUserId).toArray(),
  ]);

  const localDeckById = new Map(localDecks.map((deck) => [deck.id, deck]));
  const targetDeckById = new Map(targetDecks.map((deck) => [deck.id, deck]));
  const targetDeckPathIndex = new Map(targetDecks.map((deck) => [getDeckPath(deck, targetDeckById), deck]));
  const targetPresetIndex = new Map(targetPresets.map((preset) => [presetSignature(preset), preset]));
  const targetNoteTypeIndex = new Map(targetNoteTypes.map((noteType) => [noteTypeSignature(noteType), noteType]));
  const targetNoteIdentityIndex = buildNoteIdentityIndex(targetNotes);
  const targetCardIndex = new Map(targetCards.map((card) => [cardSignature(card.noteId, card.templateId, card.customData), card]));

  const occupiedDeckIds = new Set(targetDecks.map((deck) => deck.id));
  const occupiedPresetIds = new Set(targetPresets.map((preset) => preset.id));
  const occupiedNoteTypeIds = new Set(targetNoteTypes.map((noteType) => noteType.id));
  const occupiedNoteIds = new Set(targetNotes.map((note) => note.id));
  const occupiedCardIds = new Set(targetCards.map((card) => card.id));
  const occupiedProgramIds = new Set(targetPrograms.map((program) => program.id));
  const occupiedSubjectIds = new Set(targetSubjects.map((subject) => subject.id));
  const occupiedModuleIds = new Set(targetModules.map((module) => module.id));
  const occupiedChapterIds = new Set(targetChapters.map((chapter) => chapter.id));
  const occupiedTopicIds = new Set(targetTopics.map((topic) => topic.id));

  const mappings: MergeMappings = {
    deckId: new Map(),
    presetId: new Map(),
    noteTypeId: new Map(),
    templateIdByNoteType: new Map(),
    noteId: new Map(),
    cardId: new Map(),
    curriculumProgramId: new Map(),
    curriculumSubjectId: new Map(),
    curriculumModuleId: new Map(),
    curriculumChapterId: new Map(),
    curriculumTopicId: new Map(),
    curriculumAnyId: new Map(),
  };

  const deckCreates: Deck[] = [];
  const deckSorted = [...localDecks].sort(
    (left, right) => buildDeckDepth(left, localDeckById) - buildDeckDepth(right, localDeckById)
  );

  for (const localDeck of deckSorted) {
    const pathKey = getDeckPath(localDeck, localDeckById);
    const reusedDeck = targetDeckPathIndex.get(pathKey);
    if (reusedDeck) {
      mappings.deckId.set(localDeck.id, reusedDeck.id);
      continue;
    }

    const nextId = ensureUniqueId(localDeck.id, occupiedDeckIds);
    const nextDeck: Deck = {
      ...localDeck,
      id: nextId,
      userId: targetUserId,
      parentDeckId: localDeck.parentDeckId ? mappings.deckId.get(localDeck.parentDeckId) ?? null : null,
    };
    deckCreates.push(nextDeck);
    mappings.deckId.set(localDeck.id, nextDeck.id);
  }

  const presetCreates: SchedulingPreset[] = [];
  for (const localPreset of localPresets) {
    const reusedPreset = targetPresetIndex.get(presetSignature(localPreset));
    if (reusedPreset) {
      mappings.presetId.set(localPreset.id, reusedPreset.id);
      continue;
    }

    const nextId = ensureUniqueId(localPreset.id, occupiedPresetIds);
    const nextPreset: SchedulingPreset = { ...localPreset, id: nextId, userId: targetUserId };
    presetCreates.push(nextPreset);
    mappings.presetId.set(localPreset.id, nextPreset.id);
  }

  const noteTypeCreates: NoteType[] = [];
  for (const localNoteType of localNoteTypes) {
    const reusedNoteType = targetNoteTypeIndex.get(noteTypeSignature(localNoteType));
    if (reusedNoteType) {
      mappings.noteTypeId.set(localNoteType.id, reusedNoteType.id);
      mappings.templateIdByNoteType.set(localNoteType.id, buildTemplateMap(localNoteType, reusedNoteType));
      continue;
    }

    const nextId = ensureUniqueId(localNoteType.id, occupiedNoteTypeIds);
    const nextType: NoteType = {
      ...localNoteType,
      id: nextId,
      userId: targetUserId,
      fields: localNoteType.fields.map((field) => ({ ...field, noteTypeId: nextId })),
      templates: localNoteType.templates.map((template) => ({ ...template, noteTypeId: nextId })),
    };
    noteTypeCreates.push(nextType);
    mappings.noteTypeId.set(localNoteType.id, nextType.id);
    mappings.templateIdByNoteType.set(
      localNoteType.id,
      new Map(localNoteType.templates.map((template, index) => [template.id, nextType.templates[index]?.id ?? template.id]))
    );
  }

  const mergedNotes: Note[] = [];
  const noteCreates: Note[] = [];
  const cardCreates: Card[] = [];

  const localCardsByNote = new Map<string, Card[]>();
  for (const card of localCards) {
    const bucket = localCardsByNote.get(card.noteId) ?? [];
    bucket.push(card);
    localCardsByNote.set(card.noteId, bucket);
  }

  for (const localNote of localNotes) {
    const duplicateMatch = extractNoteIdentity(localNote)
      .map((identity) => targetNoteIdentityIndex.get(identity.key))
      .find((candidate) => candidate);

    if (duplicateMatch) {
      const targetNote = duplicateMatch.note;
      mappings.noteId.set(localNote.id, targetNote.id);

      const mergedTags = Array.from(new Set([...targetNote.tags, ...localNote.tags]));
      const mergedMetadata = mergeAcademicMetadata(targetNote.sourceMetadata, localNote.sourceMetadata);
      if (
        mergedTags.length !== targetNote.tags.length ||
        stableStringify(mergedMetadata ?? {}) !== stableStringify(targetNote.sourceMetadata ?? {})
      ) {
        mergedNotes.push({
          ...targetNote,
          tags: mergedTags,
          sourceMetadata: mergedMetadata,
          updatedAt: now(),
        });
      }

      const localNoteType = localNoteTypes.find((noteType) => noteType.id === localNote.noteTypeId);
      const targetNoteType = targetNoteTypes.find((noteType) => noteType.id === targetNote.noteTypeId)
        ?? noteTypeCreates.find((noteType) => noteType.id === targetNote.noteTypeId);
      const templateMap =
        mappings.templateIdByNoteType.get(localNote.noteTypeId) ??
        (localNoteType && targetNoteType ? buildTemplateMap(localNoteType, targetNoteType) : new Map<string, string>());

      for (const localCard of localCardsByNote.get(localNote.id) ?? []) {
        const mappedTemplateId = templateMap.get(localCard.templateId) ?? localCard.templateId;
        const existingCard = targetCardIndex.get(cardSignature(targetNote.id, mappedTemplateId, localCard.customData));
        if (existingCard) {
          mappings.cardId.set(localCard.id, existingCard.id);
          continue;
        }

        const nextCardId = ensureUniqueId(localCard.id, occupiedCardIds);
        const nextCard: Card = {
          ...localCard,
          id: nextCardId,
          userId: targetUserId,
          noteId: targetNote.id,
          templateId: mappedTemplateId,
          deckId: targetNote.deckId,
        };
        cardCreates.push(nextCard);
        targetCardIndex.set(cardSignature(nextCard.noteId, nextCard.templateId, nextCard.customData), nextCard);
        mappings.cardId.set(localCard.id, nextCard.id);
      }

      continue;
    }

    const nextNoteId = ensureUniqueId(localNote.id, occupiedNoteIds);
    const nextNote: Note = {
      ...localNote,
      id: nextNoteId,
      userId: targetUserId,
      deckId: mappings.deckId.get(localNote.deckId) ?? localNote.deckId,
      noteTypeId: mappings.noteTypeId.get(localNote.noteTypeId) ?? localNote.noteTypeId,
    };
    noteCreates.push(nextNote);
    mappings.noteId.set(localNote.id, nextNote.id);

    const templateMap = mappings.templateIdByNoteType.get(localNote.noteTypeId) ?? new Map<string, string>();
    for (const localCard of localCardsByNote.get(localNote.id) ?? []) {
      const nextCardId = ensureUniqueId(localCard.id, occupiedCardIds);
      const nextCard: Card = {
        ...localCard,
        id: nextCardId,
        userId: targetUserId,
        noteId: nextNote.id,
        deckId: nextNote.deckId,
        templateId: templateMap.get(localCard.templateId) ?? localCard.templateId,
      };
      cardCreates.push(nextCard);
      mappings.cardId.set(localCard.id, nextCard.id);
    }
  }

  const reviewLogCreates: ReviewLog[] = [];
  const existingReviewLogIds = new Set(targetReviewLogs.map((log) => log.id));
  for (const localLog of localReviewLogs) {
    if (existingReviewLogIds.has(localLog.id)) continue;
    const mappedCardId = mappings.cardId.get(localLog.cardId);
    if (!mappedCardId) continue;
    reviewLogCreates.push({
      ...localLog,
      userId: targetUserId,
      cardId: mappedCardId,
    });
    existingReviewLogIds.add(localLog.id);
  }

  const cardCommandCreates: CardCommand[] = [];
  const existingCommandIds = new Set(targetCardCommands.map((command) => command.id));
  for (const localCommand of localCardCommands) {
    if (existingCommandIds.has(localCommand.id)) continue;
    const mappedCardId = mappings.cardId.get(localCommand.cardId);
    if (!mappedCardId) continue;
    cardCommandCreates.push({
      ...localCommand,
      userId: targetUserId,
      cardId: mappedCardId,
    });
    existingCommandIds.add(localCommand.id);
  }

  const programCreates: CurriculumProgram[] = [];
  const targetProgramIndex = new Map(
    targetPrograms.map((program) => [
      tableKey([normalizeString(program.name), normalizeString(program.career), program.year ?? '', program.semester ?? '']),
      program,
    ])
  );
  for (const localProgram of localPrograms) {
    const key = tableKey([normalizeString(localProgram.name), normalizeString(localProgram.career), localProgram.year ?? '', localProgram.semester ?? '']);
    const existing = targetProgramIndex.get(key);
    if (existing) {
      mappings.curriculumProgramId.set(localProgram.id, existing.id);
      mappings.curriculumAnyId.set(localProgram.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId(localProgram.id, occupiedProgramIds);
    const nextProgram = { ...localProgram, id: nextId, userId: targetUserId };
    programCreates.push(nextProgram);
    mappings.curriculumProgramId.set(localProgram.id, nextProgram.id);
    mappings.curriculumAnyId.set(localProgram.id, nextProgram.id);
  }

  const subjectCreates: CurriculumSubject[] = [];
  const targetSubjectIndex = new Map(
    targetSubjects.map((subject) => [buildCurriculumKey(subject.name, subject.programId, subject.code), subject])
  );
  for (const localSubject of localSubjects) {
    const mappedProgramId = mappings.curriculumProgramId.get(localSubject.programId) ?? localSubject.programId;
    const key = buildCurriculumKey(localSubject.name, mappedProgramId, localSubject.code);
    const existing = targetSubjectIndex.get(key);
    if (existing) {
      mappings.curriculumSubjectId.set(localSubject.id, existing.id);
      mappings.curriculumAnyId.set(localSubject.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId(localSubject.id, occupiedSubjectIds);
    const nextSubject = { ...localSubject, id: nextId, userId: targetUserId, programId: mappedProgramId };
    subjectCreates.push(nextSubject);
    mappings.curriculumSubjectId.set(localSubject.id, nextSubject.id);
    mappings.curriculumAnyId.set(localSubject.id, nextSubject.id);
  }

  const moduleCreates: CurriculumModule[] = [];
  const targetModuleIndex = new Map(
    targetModules.map((module) => [buildCurriculumKey(module.name, module.subjectId), module])
  );
  for (const localModule of localModules) {
    const mappedSubjectId = mappings.curriculumSubjectId.get(localModule.subjectId) ?? localModule.subjectId;
    const key = buildCurriculumKey(localModule.name, mappedSubjectId);
    const existing = targetModuleIndex.get(key);
    if (existing) {
      mappings.curriculumModuleId.set(localModule.id, existing.id);
      mappings.curriculumAnyId.set(localModule.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId(localModule.id, occupiedModuleIds);
    const nextModule = { ...localModule, id: nextId, userId: targetUserId, subjectId: mappedSubjectId };
    moduleCreates.push(nextModule);
    mappings.curriculumModuleId.set(localModule.id, nextModule.id);
    mappings.curriculumAnyId.set(localModule.id, nextModule.id);
  }

  const chapterCreates: CurriculumChapter[] = [];
  const targetChapterIndex = new Map(
    targetChapters.map((chapter) => [buildCurriculumKey(chapter.name, chapter.moduleId), chapter])
  );
  for (const localChapter of localChapters) {
    const mappedModuleId = mappings.curriculumModuleId.get(localChapter.moduleId) ?? localChapter.moduleId;
    const key = buildCurriculumKey(localChapter.name, mappedModuleId);
    const existing = targetChapterIndex.get(key);
    if (existing) {
      mappings.curriculumChapterId.set(localChapter.id, existing.id);
      mappings.curriculumAnyId.set(localChapter.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId(localChapter.id, occupiedChapterIds);
    const nextChapter = { ...localChapter, id: nextId, userId: targetUserId, moduleId: mappedModuleId };
    chapterCreates.push(nextChapter);
    mappings.curriculumChapterId.set(localChapter.id, nextChapter.id);
    mappings.curriculumAnyId.set(localChapter.id, nextChapter.id);
  }

  const topicCreates: CurriculumTopic[] = [];
  const targetTopicIndex = new Map(
    targetTopics.map((topic) => [buildCurriculumKey(topic.name, topic.chapterId), topic])
  );
  for (const localTopic of localTopics) {
    const mappedChapterId = mappings.curriculumChapterId.get(localTopic.chapterId) ?? localTopic.chapterId;
    const key = buildCurriculumKey(localTopic.name, mappedChapterId);
    const existing = targetTopicIndex.get(key);
    if (existing) {
      mappings.curriculumTopicId.set(localTopic.id, existing.id);
      mappings.curriculumAnyId.set(localTopic.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId(localTopic.id, occupiedTopicIds);
    const nextTopic = { ...localTopic, id: nextId, userId: targetUserId, chapterId: mappedChapterId };
    topicCreates.push(nextTopic);
    mappings.curriculumTopicId.set(localTopic.id, nextTopic.id);
    mappings.curriculumAnyId.set(localTopic.id, nextTopic.id);
  }

  const linkCreates: CurriculumLink[] = [];
  const targetLinkIndex = new Set(
    targetLinks.map((link) =>
      tableKey([
        link.noteId ?? '',
        link.cardId ?? '',
        link.deckId ?? '',
        link.programId ?? '',
        link.subjectId ?? '',
        link.moduleId ?? '',
        link.chapterId ?? '',
        link.topicId ?? '',
      ])
    )
  );
  for (const localLink of localLinks) {
    const nextLink: CurriculumLink = {
      ...localLink,
      userId: targetUserId,
      noteId: localLink.noteId ? mappings.noteId.get(localLink.noteId) ?? localLink.noteId : undefined,
      cardId: localLink.cardId ? mappings.cardId.get(localLink.cardId) ?? localLink.cardId : undefined,
      deckId: localLink.deckId ? mappings.deckId.get(localLink.deckId) ?? localLink.deckId : undefined,
      programId: localLink.programId ? mappings.curriculumProgramId.get(localLink.programId) ?? localLink.programId : undefined,
      subjectId: localLink.subjectId ? mappings.curriculumSubjectId.get(localLink.subjectId) ?? localLink.subjectId : undefined,
      moduleId: localLink.moduleId ? mappings.curriculumModuleId.get(localLink.moduleId) ?? localLink.moduleId : undefined,
      chapterId: localLink.chapterId ? mappings.curriculumChapterId.get(localLink.chapterId) ?? localLink.chapterId : undefined,
      topicId: localLink.topicId ? mappings.curriculumTopicId.get(localLink.topicId) ?? localLink.topicId : undefined,
    };
    const key = tableKey([
      nextLink.noteId ?? '',
      nextLink.cardId ?? '',
      nextLink.deckId ?? '',
      nextLink.programId ?? '',
      nextLink.subjectId ?? '',
      nextLink.moduleId ?? '',
      nextLink.chapterId ?? '',
      nextLink.topicId ?? '',
    ]);
    if (!targetLinkIndex.has(key)) {
      linkCreates.push(nextLink);
      targetLinkIndex.add(key);
    }
  }

  const targetTagByName = new Map(targetTags.map((tag) => [normalizeString(tag.name), tag]));
  const tagCreates: Tag[] = [];
  for (const localTag of localTags) {
    if (targetTagByName.has(normalizeString(localTag.name))) continue;
    tagCreates.push({ ...localTag, userId: targetUserId });
  }

  const flagCreates: Flag[] = [];
  for (const localFlag of localFlags) {
    const mappedCardId = mappings.cardId.get(localFlag.cardId);
    if (!mappedCardId) continue;
    flagCreates.push({ ...localFlag, userId: targetUserId, cardId: mappedCardId });
  }

  const savedSearchCreates = localSavedSearches.map((savedSearch) => ({ ...savedSearch, userId: targetUserId }));
  const filteredDeckCreates = localFilteredDecks.map((filteredDeck) => ({ ...filteredDeck, userId: targetUserId }));
  const mediaCreates = localMediaAssets.map((media) => ({ ...media, userId: targetUserId }));
  const studySessionCreates = localStudySessions.map((session) => ({
    ...session,
    userId: targetUserId,
    deckScope: session.deckScope.map((deckId) => mappings.deckId.get(deckId) ?? deckId),
  }));

  const targetDailySummaryByDate = new Set(targetDailySummaries.map((summary) => summary.date));
  const dailySummaryCreates = localDailySummaries
    .filter((summary) => !targetDailySummaryByDate.has(summary.date))
    .map((summary) => ({ ...summary, userId: targetUserId }));

  const existingXPIds = new Set(targetXPEntries.map((entry) => entry.id));
  const xpCreates = localXPEntries
    .filter((entry) => !existingXPIds.has(entry.id))
    .map((entry) => ({ ...entry, userId: targetUserId }));

  const mergedGamification = mapGamification(targetGamification, localGamification, targetUserId);

  const targetQuestIndex = new Set(targetQuests.map((quest) => tableKey([quest.templateId, quest.startDate, quest.frequency])));
  const questCreates = localQuests
    .filter((quest) => !targetQuestIndex.has(tableKey([quest.templateId, quest.startDate, quest.frequency])))
    .map((quest) => ({ ...quest, userId: targetUserId }));

  const targetPersonalSummaryIndex = new Set(targetPersonalSummaries.map((summary) => tableKey([summary.period, summary.date])));
  const personalSummaryCreates = localPersonalSummaries
    .filter((summary) => !targetPersonalSummaryIndex.has(tableKey([summary.period, summary.date])))
    .map((summary) => ({ ...summary, userId: targetUserId }));

  const targetOptimizationRunIds = new Set(targetOptimizationRuns.map((run) => run.id));
  const optimizationCreates = localOptimizationRuns
    .filter((run) => !targetOptimizationRunIds.has(run.id))
    .map((run) => ({
      ...run,
      userId: targetUserId,
      presetId: mappings.presetId.get(run.presetId) ?? run.presetId,
    }));

  const existingActivityIds = new Set(targetActivityEvents.map((event) => event.id));
  const activityCreates = localActivityEvents
    .filter((event) => !existingActivityIds.has(event.id))
    .map((event) => ({
      ...event,
      userId: targetUserId,
      entityId: eventEntityId(event, mappings),
    }));

  const reassignedBackups = localBackups.map((backupEntry) => ({ ...backupEntry, userId: targetUserId }));

  const queueItemsToDelete = await db.syncQueue.toArray();
  const queueIdsToDelete = queueItemsToDelete
    .filter((item) => {
      if (item.data.userId === LOCAL_USER_ID) return true;
      const table = item.table;
      if (table === 'notes') return localNotes.some((note) => note.id === item.recordId);
      if (table === 'cards') return localCards.some((card) => card.id === item.recordId);
      if (table === 'reviewLogs') return localReviewLogs.some((log) => log.id === item.recordId);
      if (table === 'cardCommands') return localCardCommands.some((command) => command.id === item.recordId);
      if (table === 'decks') return localDecks.some((deck) => deck.id === item.recordId);
      if (table === 'presets') return localPresets.some((preset) => preset.id === item.recordId);
      if (table === 'noteTypes') return localNoteTypes.some((noteType) => noteType.id === item.recordId);
      return false;
    })
    .map((item) => item.id);

  await db.transaction(
    'rw',
    [
      db.decks,
      db.presets,
      db.noteTypes,
      db.notes,
      db.cards,
      db.reviewLogs,
      db.cardCommands,
      db.curriculumPrograms,
      db.curriculumSubjects,
      db.curriculumModules,
      db.curriculumChapters,
      db.curriculumTopics,
      db.curriculumLinks,
      db.activityEvents,
      db.tags,
      db.flags,
      db.savedSearches,
      db.filteredDecks,
      db.mediaAssets,
      db.backups,
      db.studySessions,
      db.dailySummaries,
      db.xpLedger,
      db.userGamification,
      db.quests,
      db.personalSummaries,
      db.optimizationRuns,
      db.syncQueue,
    ],
    async () => {
      if (deckCreates.length > 0) await db.decks.bulkPut(deckCreates);
      if (presetCreates.length > 0) await db.presets.bulkPut(presetCreates);
      if (noteTypeCreates.length > 0) await db.noteTypes.bulkPut(noteTypeCreates);
      if (mergedNotes.length > 0) await db.notes.bulkPut(mergedNotes);
      if (noteCreates.length > 0) await db.notes.bulkPut(noteCreates);
      if (cardCreates.length > 0) await db.cards.bulkPut(cardCreates);
      if (reviewLogCreates.length > 0) await db.reviewLogs.bulkPut(reviewLogCreates);
      if (cardCommandCreates.length > 0) await db.cardCommands.bulkPut(cardCommandCreates);
      if (programCreates.length > 0) await db.curriculumPrograms.bulkPut(programCreates);
      if (subjectCreates.length > 0) await db.curriculumSubjects.bulkPut(subjectCreates);
      if (moduleCreates.length > 0) await db.curriculumModules.bulkPut(moduleCreates);
      if (chapterCreates.length > 0) await db.curriculumChapters.bulkPut(chapterCreates);
      if (topicCreates.length > 0) await db.curriculumTopics.bulkPut(topicCreates);
      if (linkCreates.length > 0) await db.curriculumLinks.bulkPut(linkCreates);
      if (activityCreates.length > 0) await db.activityEvents.bulkPut(activityCreates);
      if (tagCreates.length > 0) await db.tags.bulkPut(tagCreates);
      if (flagCreates.length > 0) await db.flags.bulkPut(flagCreates);
      if (savedSearchCreates.length > 0) await db.savedSearches.bulkPut(savedSearchCreates);
      if (filteredDeckCreates.length > 0) await db.filteredDecks.bulkPut(filteredDeckCreates);
      if (mediaCreates.length > 0) await db.mediaAssets.bulkPut(mediaCreates);
      if (reassignedBackups.length > 0) await db.backups.bulkPut(reassignedBackups);
      if (studySessionCreates.length > 0) await db.studySessions.bulkPut(studySessionCreates);
      if (dailySummaryCreates.length > 0) await db.dailySummaries.bulkPut(dailySummaryCreates);
      if (xpCreates.length > 0) await db.xpLedger.bulkPut(xpCreates);
      if (mergedGamification) await db.userGamification.put(mergedGamification);
      if (questCreates.length > 0) await db.quests.bulkPut(questCreates);
      if (personalSummaryCreates.length > 0) await db.personalSummaries.bulkPut(personalSummaryCreates);
      if (optimizationCreates.length > 0) await db.optimizationRuns.bulkPut(optimizationCreates);
      if (queueIdsToDelete.length > 0) await db.syncQueue.bulkDelete(queueIdsToDelete);

      await Promise.all([
        db.decks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.presets.where('userId').equals(LOCAL_USER_ID).delete(),
        db.noteTypes.where('userId').equals(LOCAL_USER_ID).delete(),
        db.notes.where('userId').equals(LOCAL_USER_ID).delete(),
        db.cards.where('userId').equals(LOCAL_USER_ID).delete(),
        db.reviewLogs.where('userId').equals(LOCAL_USER_ID).delete(),
        db.cardCommands.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumPrograms.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumSubjects.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumModules.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumChapters.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumTopics.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumLinks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.activityEvents.where('userId').equals(LOCAL_USER_ID).delete(),
        db.tags.where('userId').equals(LOCAL_USER_ID).delete(),
        db.flags.where('userId').equals(LOCAL_USER_ID).delete(),
        db.savedSearches.where('userId').equals(LOCAL_USER_ID).delete(),
        db.filteredDecks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.mediaAssets.where('userId').equals(LOCAL_USER_ID).delete(),
        db.backups.where('userId').equals(LOCAL_USER_ID).delete(),
        db.studySessions.where('userId').equals(LOCAL_USER_ID).delete(),
        db.dailySummaries.where('userId').equals(LOCAL_USER_ID).delete(),
        db.xpLedger.where('userId').equals(LOCAL_USER_ID).delete(),
        db.userGamification.where('userId').equals(LOCAL_USER_ID).delete(),
        db.quests.where('userId').equals(LOCAL_USER_ID).delete(),
        db.personalSummaries.where('userId').equals(LOCAL_USER_ID).delete(),
        db.optimizationRuns.where('userId').equals(LOCAL_USER_ID).delete(),
      ]);
    }
  );

  let syncOperationsQueued = 0;
  const queueMany = async <T extends { id: string }>(table: string, operation: 'create' | 'update', records: T[]) => {
    for (const record of records) {
      await queueSync(table, record.id, operation, record as unknown as JSONObject);
      syncOperationsQueued += 1;
    }
  };

  await queueMany('decks', 'create', deckCreates);
  await queueMany('presets', 'create', presetCreates);
  await queueMany('noteTypes', 'create', noteTypeCreates);
  await queueMany('notes', 'update', mergedNotes);
  await queueMany('notes', 'create', noteCreates);
  await queueMany('cards', 'create', cardCreates);
  await queueMany('reviewLogs', 'create', reviewLogCreates);
  await queueMany('cardCommands', 'create', cardCommandCreates);
  await queueMany('curriculumPrograms', 'create', programCreates);
  await queueMany('curriculumSubjects', 'create', subjectCreates);
  await queueMany('curriculumModules', 'create', moduleCreates);
  await queueMany('curriculumChapters', 'create', chapterCreates);
  await queueMany('curriculumTopics', 'create', topicCreates);
  await queueMany('curriculumLinks', 'create', linkCreates);
  await queueMany('activityEvents', 'create', activityCreates);

  return {
    targetUserId,
    backupId: backup.id,
    created: {
      decks: deckCreates.length,
      presets: presetCreates.length,
      noteTypes: noteTypeCreates.length,
      notes: noteCreates.length,
      cards: cardCreates.length,
      curriculum:
        programCreates.length + subjectCreates.length + moduleCreates.length + chapterCreates.length + topicCreates.length + linkCreates.length,
    },
    reused: {
      decks: preview.mergeCounts.deckReuses,
      presets: preview.mergeCounts.presetReuses,
      noteTypes: preview.mergeCounts.noteTypeReuses,
      notes: preview.mergeCounts.notesToMerge,
      curriculum: preview.mergeCounts.curriculumReuses,
    },
    mergedNotes: mergedNotes.length,
    reviewLogsMigrated: reviewLogCreates.length,
    cardCommandsMigrated: cardCommandCreates.length,
    activityEventsMigrated: activityCreates.length,
    auxiliaryRecordsReassigned:
      tagCreates.length +
      flagCreates.length +
      savedSearchCreates.length +
      filteredDeckCreates.length +
      mediaCreates.length +
      reassignedBackups.length +
      studySessionCreates.length +
      dailySummaryCreates.length +
      xpCreates.length +
      questCreates.length +
      personalSummaryCreates.length +
      optimizationCreates.length +
      (mergedGamification ? 1 : 0),
    syncOperationsQueued,
    localRecordsDiscarded:
      preview.localCounts.decks +
      preview.localCounts.presets +
      preview.localCounts.noteTypes +
      preview.localCounts.notes +
      preview.localCounts.cards +
      preview.localCounts.reviewLogs +
      preview.localCounts.cardCommands +
      preview.localCounts.curriculumNodes +
      preview.localCounts.curriculumLinks +
      preview.localCounts.activityEvents +
      preview.localCounts.auxiliaryRecords,
  };
}

export async function discardLocalUserData(ownerUserId: string): Promise<{ backupId: string; deletedRecords: number }> {
  const preview = await getLocalUserMergePreview(ownerUserId);
  const backup = await createPortableBackup(ownerUserId, LOCAL_USER_ID, `local-user-discard-${new Date().toISOString()}`);

  const queueIdsToDelete = (await db.syncQueue.toArray())
    .filter((item) => item.data.userId === LOCAL_USER_ID)
    .map((item) => item.id);

  await db.transaction(
    'rw',
    [
      db.decks,
      db.presets,
      db.noteTypes,
      db.notes,
      db.cards,
      db.reviewLogs,
      db.cardCommands,
      db.curriculumPrograms,
      db.curriculumSubjects,
      db.curriculumModules,
      db.curriculumChapters,
      db.curriculumTopics,
      db.curriculumLinks,
      db.activityEvents,
      db.tags,
      db.flags,
      db.savedSearches,
      db.filteredDecks,
      db.mediaAssets,
      db.backups,
      db.studySessions,
      db.dailySummaries,
      db.xpLedger,
      db.userGamification,
      db.quests,
      db.personalSummaries,
      db.optimizationRuns,
      db.syncQueue,
    ],
    async () => {
      if (queueIdsToDelete.length > 0) {
        await db.syncQueue.bulkDelete(queueIdsToDelete);
      }

      await Promise.all([
        db.decks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.presets.where('userId').equals(LOCAL_USER_ID).delete(),
        db.noteTypes.where('userId').equals(LOCAL_USER_ID).delete(),
        db.notes.where('userId').equals(LOCAL_USER_ID).delete(),
        db.cards.where('userId').equals(LOCAL_USER_ID).delete(),
        db.reviewLogs.where('userId').equals(LOCAL_USER_ID).delete(),
        db.cardCommands.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumPrograms.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumSubjects.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumModules.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumChapters.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumTopics.where('userId').equals(LOCAL_USER_ID).delete(),
        db.curriculumLinks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.activityEvents.where('userId').equals(LOCAL_USER_ID).delete(),
        db.tags.where('userId').equals(LOCAL_USER_ID).delete(),
        db.flags.where('userId').equals(LOCAL_USER_ID).delete(),
        db.savedSearches.where('userId').equals(LOCAL_USER_ID).delete(),
        db.filteredDecks.where('userId').equals(LOCAL_USER_ID).delete(),
        db.mediaAssets.where('userId').equals(LOCAL_USER_ID).delete(),
        db.backups.where('userId').equals(LOCAL_USER_ID).delete(),
        db.studySessions.where('userId').equals(LOCAL_USER_ID).delete(),
        db.dailySummaries.where('userId').equals(LOCAL_USER_ID).delete(),
        db.xpLedger.where('userId').equals(LOCAL_USER_ID).delete(),
        db.userGamification.where('userId').equals(LOCAL_USER_ID).delete(),
        db.quests.where('userId').equals(LOCAL_USER_ID).delete(),
        db.personalSummaries.where('userId').equals(LOCAL_USER_ID).delete(),
        db.optimizationRuns.where('userId').equals(LOCAL_USER_ID).delete(),
      ]);
    }
  );

  return {
    backupId: backup.id,
    deletedRecords:
      preview.localCounts.decks +
      preview.localCounts.presets +
      preview.localCounts.noteTypes +
      preview.localCounts.notes +
      preview.localCounts.cards +
      preview.localCounts.reviewLogs +
      preview.localCounts.cardCommands +
      preview.localCounts.curriculumNodes +
      preview.localCounts.curriculumLinks +
      preview.localCounts.activityEvents +
      preview.localCounts.auxiliaryRecords,
  };
}
