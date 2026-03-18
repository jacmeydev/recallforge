// ============================================================================
// RecallForge — Core Type Definitions
// ============================================================================

import { State, Rating } from 'ts-fsrs';

// ─── Base ───────────────────────────────────────────────────────────────────

export type UUID = string;
export type ISO8601 = string;
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = Record<string, JSONValue>;

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: UUID;
  email: string;
  name: string;
  avatarUrl?: string;
  locale: string;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  studyPreferences: StudyPreferences;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface StudyPreferences {
  defaultDeckId?: UUID;
  showNextIntervals: boolean;
  simpleMode: boolean; // Again + Good only
  autoplayAudio: boolean;
  doubleScrollProtection: boolean;
  focusModeDefault: boolean;
}

// ─── Deck ───────────────────────────────────────────────────────────────────

export interface Deck {
  id: UUID;
  userId: UUID;
  name: string;
  description: string;
  parentDeckId: UUID | null;
  sortOrder: number;
  archived: boolean;
  presetId: UUID | null;
  metadata: JSONObject;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface DeckWithCounts extends Deck {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  totalCount: number;
  children?: DeckWithCounts[];
}

// ─── Scheduling Preset ──────────────────────────────────────────────────────

export interface SchedulingPreset {
  id: UUID;
  userId: UUID;
  name: string;
  desiredRetention: number;
  learningSteps: number[]; // in minutes
  relearningSteps: number[];
  maximumInterval: number; // in days
  enableFuzz: boolean;
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  newCardOrder: 'sequential' | 'random';
  reviewOrder: 'due_date' | 'random' | 'intervals_ascending' | 'intervals_descending';
  dailyLimits: {
    newCards: number;
    reviews: number;
  };
  fsrsParameters: number[];
  optimizerMetadata: JSONObject;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

// ─── Note Type ──────────────────────────────────────────────────────────────

export type NoteTypeKind = 'basic' | 'basic_reversed' | 'cloze' | 'type_answer' | 'image_occlusion' | 'custom';

export interface NoteType {
  id: UUID;
  userId: UUID;
  name: string;
  description: string;
  kind: NoteTypeKind;
  css: string;
  js?: string;
  version: number;
  fields: FieldDefinition[];
  templates: CardTemplate[];
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface FieldDefinition {
  id: UUID;
  noteTypeId: UUID;
  name: string;
  ordinal: number;
  required: boolean;
  sticky: boolean;
  rtl: boolean;
  uniqueBehavior: 'none' | 'unique_in_deck' | 'unique_global';
  inputType: 'text' | 'richtext' | 'image' | 'audio' | 'video';
}

export interface CardTemplate {
  id: UUID;
  noteTypeId: UUID;
  name: string;
  frontTemplate: string;
  backTemplate: string;
  previewTemplate?: string;
  ordinal: number;
  active: boolean;
  generationRules: JSONObject;
}

// ─── Note ───────────────────────────────────────────────────────────────────

export interface Note {
  id: UUID;
  userId: UUID;
  deckId: UUID;
  noteTypeId: UUID;
  fieldValues: Record<string, string>;
  tags: string[];
  source?: string;
  sourceMetadata?: JSONObject;
  hash: string;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  suspended: boolean;
}

// ─── Card ───────────────────────────────────────────────────────────────────

export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type CardQueue = 'new' | 'learning' | 'review' | 'day_learning' | 'suspended' | 'buried';

export interface Card {
  id: UUID;
  userId: UUID;
  noteId: UUID;
  templateId: UUID;
  deckId: UUID;
  dueAt: ISO8601;
  state: CardState;
  queuePosition: number;
  stability: number;
  difficulty: number;
  retrievability?: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  lastReviewAt: ISO8601 | null;
  suspended: boolean;
  buriedUntil: ISO8601 | null;
  customData: JSONObject;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

// ─── Review Log ─────────────────────────────────────────────────────────────

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewLog {
  id: UUID;
  userId: UUID;
  cardId: UUID;
  reviewedAt: ISO8601;
  clientReviewedAt?: ISO8601;
  serverReceivedAt?: ISO8601 | null;
  effectiveReviewedAt?: ISO8601 | null;
  offsetMeasuredAt?: ISO8601 | null;
  timeSource?: 'client' | 'server' | 'clock_corrected';
  rating: ReviewRating;
  previousState: CardState;
  nextState: CardState;
  previousDueAt: ISO8601;
  nextDueAt: ISO8601;
  previousStability: number;
  nextStability: number;
  previousDifficulty: number;
  nextDifficulty: number;
  responseTimeMs: number;
  wasManualReschedule: boolean;
  wasFilteredDeck: boolean;
  sessionId: UUID | null;
  deviceId: string | null;
  deviceSeq?: number | null;
  clockOffsetMs?: number | null;
  replayOrdinal?: number | null;
  schedulerContext?: JSONObject;
  syncStatus: 'pending' | 'synced' | 'conflict';
}

// ─── Card Commands ──────────────────────────────────────────────────────────

export type CardCommandType =
  | 'bury'
  | 'unbury'
  | 'suspend'
  | 'unsuspend'
  | 'manual_reschedule'
  | 'reset';

export interface CardCommand {
  id: UUID;
  userId: UUID;
  cardId: UUID;
  command: CardCommandType;
  payload: JSONObject;
  clientIssuedAt?: ISO8601 | null;
  serverReceivedAt?: ISO8601 | null;
  effectiveAt?: ISO8601 | null;
  offsetMeasuredAt?: ISO8601 | null;
  timeSource?: 'client' | 'server' | 'clock_corrected';
  deviceId: string | null;
  deviceSeq?: number | null;
  clockOffsetMs?: number | null;
  createdAt: ISO8601;
}

// ─── Tag / Flag / SavedSearch ───────────────────────────────────────────────

export interface Tag {
  id: UUID;
  userId: UUID;
  name: string;
  color?: string;
}

export interface Flag {
  id: UUID;
  userId: UUID;
  cardId: UUID;
  color: 'red' | 'orange' | 'green' | 'blue' | 'pink' | 'turquoise' | 'purple';
  label?: string;
}

export interface SavedSearch {
  id: UUID;
  userId: UUID;
  name: string;
  query: string;
  scope: 'all' | 'deck' | 'tag';
}

// ─── Filtered Deck (NOT YET IMPLEMENTED — schema only) ─────────────────────

export interface FilteredDeck {
  id: UUID;
  userId: UUID;
  name: string;
  query: string;
  limit: number;
  sortMode: 'due_date' | 'random' | 'lapses' | 'intervals' | 'added';
  rescheduleBehavior: 'reschedule' | 'no_reschedule' | 'reset';
  previewMode: boolean;
  temporary: boolean;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

// ─── Media (NOT YET IMPLEMENTED — schema only) ─────────────────────────────

export interface MediaAsset {
  id: UUID;
  userId: UUID;
  storageKey: string;
  mimeType: string;
  hash: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  data?: Blob;
  createdAt: ISO8601;
  usageCount: number;
}

// ─── Backup ─────────────────────────────────────────────────────────────────

export interface BackupSnapshot {
  id: UUID;
  userId: UUID;
  type: 'auto' | 'manual' | 'pre_operation';
  label?: string;
  data?: Blob;
  createdAt: ISO8601;
  metadata: JSONObject;
}

// ─── Study Session ──────────────────────────────────────────────────────────

export interface StudySession {
  id: UUID;
  userId: UUID;
  startedAt: ISO8601;
  endedAt: ISO8601 | null;
  mode: 'normal' | 'filtered' | 'cram' | 'preview' | 'rescue' | 'academic';
  deckScope: UUID[];
  presetSnapshot: JSONObject;
  metrics: StudySessionMetrics;
}

export interface StudySessionMetrics {
  cardsStudied: number;
  newCards: number;
  reviewCards: number;
  learningCards: number;
  relearningCards: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  totalTimeMs: number;
  averageTimeMs: number;
  correctRate: number;
}

// ─── Activity Events (OpenClaw Telemetry) ───────────────────────────────────

export type ActivityEventType =
  | 'user_logged_in'
  | 'deck_created'
  | 'deck_updated'
  | 'deck_deleted'
  | 'note_created'
  | 'note_updated'
  | 'note_deleted'
  | 'card_reviewed'
  | 'card_suspended'
  | 'card_unsuspended'
  | 'card_buried'
  | 'note_type_created'
  | 'note_type_updated'
  | 'preset_changed'
  | 'optimizer_run'
  | 'import_run'
  | 'export_run'
  | 'backup_created'
  | 'restore_run'
  | 'sync_started'
  | 'sync_completed'
  | 'study_session_started'
  | 'study_session_finished'
  | 'ai_import_started'
  | 'ai_import_completed'
  | 'xp_earned'
  | 'achievement_unlocked'
  | 'quest_completed'
  | 'streak_milestone'
  | 'curriculum_program_created'
  | 'curriculum_subject_created'
  | 'curriculum_module_created'
  | 'curriculum_chapter_created'
  | 'curriculum_topic_created'
  | 'curriculum_linked'
  | 'personal_summary_generated'
  | 'study_scope_selected'
  | 'high_priority_review_completed'
  | 'hard_topic_rescued';

export type EntityType =
  | 'user'
  | 'deck'
  | 'note'
  | 'card'
  | 'note_type'
  | 'preset'
  | 'backup'
  | 'session'
  | 'filtered_deck'
  | 'gamification'
  | 'curriculum'
  | 'summary';

export type EventSource = 'web' | 'mobile' | 'sync' | 'agent';

export interface ActivityEvent {
  id: UUID;
  userId: UUID;
  ts: ISO8601;
  type: ActivityEventType;
  entityType: EntityType;
  entityId: UUID;
  sessionId?: UUID;
  source: EventSource;
  payload: JSONObject;
  exportedAt?: ISO8601;
}

// ─── Daily Summary ──────────────────────────────────────────────────────────

export interface DailySummary {
  id: UUID;
  userId: UUID;
  date: string; // YYYY-MM-DD
  metrics: DailySummaryMetrics;
  generatedAt: ISO8601;
}

export interface DailySummaryMetrics {
  cardsStudied: number;
  newCardsStudied: number;
  reviewsCompleted: number;
  totalTimeMs: number;
  retentionRate: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  averageResponseTimeMs: number;
  sessionsCount: number;
  decksStudied: string[];
  leeches: number;
  streak: number;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncQueueItem {
  id: UUID;
  operationId?: UUID;
  table: string;
  recordId: UUID;
  operation: 'create' | 'update' | 'delete';
  data: JSONObject;
  deviceId?: string;
  clientUpdatedAt?: ISO8601;
  createdAt: ISO8601;
  retries: number;
  lastError?: string;
}

// ─── UI State Types ─────────────────────────────────────────────────────────

export interface BrowserColumn {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  sortable: boolean;
}

export interface BrowserFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in';
  value: string | number | boolean | string[];
}

export interface StudyQueueCard {
  card: Card;
  note: Note;
  noteType: NoteType;
  template: CardTemplate;
  deck: Deck;
}

export interface IntervalPreview {
  again: { interval: string; dueDate: ISO8601 };
  hard: { interval: string; dueDate: ISO8601 };
  good: { interval: string; dueDate: ISO8601 };
  easy: { interval: string; dueDate: ISO8601 };
}

// ─── AI Batch Import ────────────────────────────────────────────────────────

export interface AIImportSummary {
  totalItems: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
  durationMs: number;
  dryRun: boolean;
}

// ─── Gamification: XP Ledger ────────────────────────────────────────────────

export type XPSource =
  | 'review_card'
  | 'high_risk_recovered'
  | 'overdue_resolved'
  | 'session_accuracy_bonus'
  | 'quest_completed'
  | 'streak_milestone'
  | 'rescue_session';

export interface XPEntry {
  id: UUID;
  userId: UUID;
  amount: number;
  source: XPSource;
  reason: string;
  entityId?: UUID;
  ts: ISO8601;
}

export interface UserGamification {
  id: UUID;
  userId: UUID;
  totalXP: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  streakFreezes: number;
  lastStudyDate: string; // YYYY-MM-DD
  streakFrozenToday: boolean;
  dailyGoal: number; // min reviews to keep streak
  easyDayMultiplier: number; // 0.5 = half the daily goal on easy days
  achievements: string[]; // achievement IDs
  updatedAt: ISO8601;
}

// ─── Gamification: Achievements ─────────────────────────────────────────────

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'streak' | 'mastery' | 'volume' | 'rescue' | 'academic';
  condition: string; // human-readable
  xpReward: number;
}

// ─── Gamification: Quests ───────────────────────────────────────────────────

export type QuestFrequency = 'daily' | 'weekly';
export type QuestStatus = 'active' | 'completed' | 'expired';

export interface Quest {
  id: UUID;
  userId: UUID;
  templateId: string;
  name: string;
  description: string;
  frequency: QuestFrequency;
  status: QuestStatus;
  progress: number;
  target: number;
  xpReward: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  completedAt?: ISO8601;
  metadata: JSONObject;
}

// ─── Gamification: Mastery Score ────────────────────────────────────────────

export interface MasteryScore {
  deckId: UUID;
  deckName: string;
  score: number;         // 0-100
  retrievability: number; // avg R across cards
  stability: number;      // avg stability
  retention: number;      // actual retention last 30d
  coverage: number;       // % cards not new
  backlog: number;        // overdue cards count
  riskCards: number;      // cards with R < 0.7
  totalCards: number;
  matureCards: number;
}

// ─── Conceptual Priority & Difficulty ───────────────────────────────────────

export type ConceptualPriority = 'low' | 'medium' | 'high' | 'critical';
export type ConceptualDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard';

// ─── Academic Classification ────────────────────────────────────────────────

export interface AcademicMeta {
  subject?: string;
  module?: string;
  chapter?: string;
  topic?: string;
  subtopic?: string;
  lectureDate?: string;
  professor?: string;
  sourcePage?: string;
  book?: string;
  className?: string;
  examScope?: string;
  aiGenerated?: boolean;
  aiReviewStatus?: 'pending-review' | 'reviewed' | 'corrected';
  priority?: ConceptualPriority;
  conceptualDifficulty?: ConceptualDifficulty;
}

export type SourceAssetKind =
  | 'image'
  | 'page-image'
  | 'pdf-page'
  | 'url'
  | 'text-snippet';

export interface SourceAsset {
  id?: string;
  kind: SourceAssetKind;
  name?: string;
  mimeType?: string;
  sha256?: string;
  sourceUrl?: string;
  pageNumber?: number;
  pageStart?: number;
  pageEnd?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface DraftSourceContext {
  importSource?: string;
  externalId?: string;
  duplicateKey?: string;
  agentId?: string;
  sourceActionId?: string;
  ingestionId?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  chapterTitle?: string;
  sourceAssets?: SourceAsset[];
  draftMode?: 'create' | 'improve-existing';
  targetNoteId?: string;
  targetCardIds?: string[];
  targetDeckId?: string;
  targetDeckName?: string;
  confidence?: number;
  issues?: string[];
  recommendationSummary?: string;
  academic?: AcademicMeta;
}

// ─── Curriculum (Normalized Academic Structure) ─────────────────────────────

export interface CurriculumProgram {
  id: UUID;
  userId: UUID;
  name: string;
  description: string;
  career?: string;
  year?: number;
  semester?: number;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface CurriculumSubject {
  id: UUID;
  userId: UUID;
  programId: UUID;
  name: string;
  code?: string;
  description?: string;
  sortOrder: number;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface CurriculumModule {
  id: UUID;
  userId: UUID;
  subjectId: UUID;
  name: string;
  description?: string;
  sortOrder: number;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface CurriculumChapter {
  id: UUID;
  userId: UUID;
  moduleId: UUID;
  name: string;
  description?: string;
  examScope?: string;
  sortOrder: number;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface CurriculumTopic {
  id: UUID;
  userId: UUID;
  chapterId: UUID;
  name: string;
  description?: string;
  priorityDefault?: ConceptualPriority;
  conceptualDifficultyDefault?: ConceptualDifficulty;
  sortOrder: number;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface CurriculumLink {
  id: UUID;
  userId: UUID;
  noteId?: UUID;
  cardId?: UUID;
  deckId?: UUID;
  programId?: UUID;
  subjectId?: UUID;
  moduleId?: UUID;
  chapterId?: UUID;
  topicId?: UUID;
  createdAt: ISO8601;
}

// ─── Curriculum Progress ────────────────────────────────────────────────────

export interface CurriculumProgress {
  entityId: UUID;
  entityName: string;
  totalCards: number;
  newCards: number;
  matureCards: number;
  overdueCards: number;
  riskCards: number;
  highPriorityPending: number;
  aiPendingReview: number;
  coverage: number;       // 0-1
  masteryScore: number;   // 0-100
  avgRetrievability: number;
  childCount: number;
}

// ─── Study Scope (for academic study sessions) ─────────────────────────────

export interface StudyScope {
  type: 'subject' | 'module' | 'chapter' | 'topic' | 'priority' | 'ai_pending' | 'curriculum_gap';
  id?: UUID;
  label?: string;
  priority?: ConceptualPriority;
}

// ─── Personal Summary ────────────────────────────────────────────────────────

export interface PersonalSummary {
  id: UUID;
  userId: UUID;
  period: 'daily' | 'weekly' | 'monthly';
  date: string;
  xpEarned: number;
  streakDays: number;
  subjectsAdvanced: string[];
  subjectsAbandoned: string[];
  riskChange: number; // positive = risk increased
  chaptersConsolidated: string[];
  aiCardsPendingReview: number;
  topMasteryGains: Array<{ deck: string; change: number }>;
  questsCompleted: number;
  highPriorityPending: number;
  hardTopicsCount: number;
  syllabusCoverageDelta: number;
  generatedAt: ISO8601;
}

// ─── Optimization Run (FSRS parameter training history) ─────────────────────

export interface OptimizationRun {
  id: UUID;
  userId: UUID;
  presetId: UUID;
  previousParameters: number[];
  optimizedParameters: number[];
  previousRetention: number;
  optimizedRetention?: number;
  reviewLogCount: number;
  cardCount: number;
  trainingTimeMs: number;
  applied: boolean;
  discardedAt?: ISO8601;
  createdAt: ISO8601;
}

// ─── FSRS Reexports ─────────────────────────────────────────────────────────

export { State as FSRSState, Rating as FSRSRating } from 'ts-fsrs';
