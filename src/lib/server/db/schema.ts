// ============================================================================
// RecallForge — Server Database Schema (Drizzle + SQLite)
// ============================================================================
// Remote persistence layer for sync and multi-device support.
// Local Dexie remains the operational source of truth.
// ============================================================================

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ─── Users (server-only) ───────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  locale: text('locale').notNull().default('es'),
  timezone: text('timezone').notNull().default('America/Bogota'),
  theme: text('theme').notNull().default('system'),
  studyPreferences: text('study_preferences').notNull().default('{}'), // JSON
  apiKey: text('api_key').unique(), // For agent access (UniBot/OpenClaw)
  apiKeyHash: text('api_key_hash').unique(),
  apiKeyPreview: text('api_key_preview'),
  apiKeyLastRotatedAt: text('api_key_last_rotated_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Sessions (Auth.js) ────────────────────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

// ─── Synced Entities ───────────────────────────────────────────────────────
// These mirror the Dexie schema. The server stores the canonical remote copy.
// Sync uses updatedAt for last-write-wins conflict resolution.

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  parentDeckId: text('parent_deck_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  presetId: text('preset_id'),
  metadata: text('metadata').notNull().default('{}'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'), // soft delete for sync
});

export const presets = sqliteTable('presets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  desiredRetention: real('desired_retention').notNull().default(0.9),
  learningSteps: text('learning_steps').notNull().default('[]'), // JSON
  relearningSteps: text('relearning_steps').notNull().default('[]'), // JSON
  maximumInterval: integer('maximum_interval').notNull().default(36500),
  enableFuzz: integer('enable_fuzz', { mode: 'boolean' }).notNull().default(true),
  buryNewSiblings: integer('bury_new_siblings', { mode: 'boolean' }).notNull().default(true),
  buryReviewSiblings: integer('bury_review_siblings', { mode: 'boolean' }).notNull().default(true),
  newCardOrder: text('new_card_order').notNull().default('sequential'),
  reviewOrder: text('review_order').notNull().default('due_date'),
  dailyLimits: text('daily_limits').notNull().default('{"newCards":20,"reviews":200}'), // JSON
  fsrsParameters: text('fsrs_parameters').notNull().default('[]'), // JSON
  optimizerMetadata: text('optimizer_metadata').notNull().default('{}'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const noteTypes = sqliteTable('note_types', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind').notNull(),
  css: text('css').notNull().default(''),
  js: text('js'),
  version: integer('version').notNull().default(1),
  fields: text('fields').notNull().default('[]'), // JSON
  templates: text('templates').notNull().default('[]'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deckId: text('deck_id').notNull(),
  noteTypeId: text('note_type_id').notNull(),
  fieldValues: text('field_values').notNull().default('{}'), // JSON
  tags: text('tags').notNull().default('[]'), // JSON
  source: text('source'),
  sourceMetadata: text('source_metadata'), // JSON
  hash: text('hash').notNull(),
  suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  noteId: text('note_id').notNull(),
  templateId: text('template_id').notNull(),
  deckId: text('deck_id').notNull(),
  dueAt: text('due_at').notNull(),
  state: text('state').notNull().default('new'),
  queuePosition: integer('queue_position').notNull().default(0),
  stability: real('stability').notNull().default(0),
  difficulty: real('difficulty').notNull().default(0),
  retrievability: real('retrievability'),
  elapsedDays: real('elapsed_days').notNull().default(0),
  scheduledDays: real('scheduled_days').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  learningSteps: integer('learning_steps').notNull().default(0),
  lastReviewAt: text('last_review_at'),
  suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
  buriedUntil: text('buried_until'),
  customData: text('custom_data').notNull().default('{}'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const reviewLogs = sqliteTable('review_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  cardId: text('card_id').notNull(),
  reviewedAt: text('reviewed_at').notNull(),
  clientReviewedAt: text('client_reviewed_at'),
  serverReceivedAt: text('server_received_at'),
  effectiveReviewedAt: text('effective_reviewed_at'),
  offsetMeasuredAt: text('offset_measured_at'),
  timeSource: text('time_source').notNull().default('client'),
  rating: text('rating').notNull(),
  previousState: text('previous_state').notNull(),
  nextState: text('next_state').notNull(),
  previousDueAt: text('previous_due_at').notNull(),
  nextDueAt: text('next_due_at').notNull(),
  previousStability: real('previous_stability').notNull(),
  nextStability: real('next_stability').notNull(),
  previousDifficulty: real('previous_difficulty').notNull(),
  nextDifficulty: real('next_difficulty').notNull(),
  responseTimeMs: integer('response_time_ms').notNull(),
  wasManualReschedule: integer('was_manual_reschedule', { mode: 'boolean' }).notNull().default(false),
  wasFilteredDeck: integer('was_filtered_deck', { mode: 'boolean' }).notNull().default(false),
  sessionId: text('session_id'),
  deviceId: text('device_id'),
  deviceSeq: integer('device_seq'),
  clockOffsetMs: integer('clock_offset_ms'),
  replayOrdinal: integer('replay_ordinal'),
  schedulerContext: text('scheduler_context').notNull().default('{}'), // JSON
  createdAt: text('created_at').notNull(),
});

export const cardCommands = sqliteTable('card_commands', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull(),
  command: text('command').notNull(),
  payload: text('payload').notNull().default('{}'),
  clientIssuedAt: text('client_issued_at'),
  serverReceivedAt: text('server_received_at'),
  effectiveAt: text('effective_at'),
  offsetMeasuredAt: text('offset_measured_at'),
  timeSource: text('time_source').notNull().default('client'),
  deviceId: text('device_id'),
  deviceSeq: integer('device_seq'),
  clockOffsetMs: integer('clock_offset_ms'),
  createdAt: text('created_at').notNull(),
});

export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  ts: text('ts').notNull(),
  type: text('type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  sessionId: text('session_id'),
  source: text('source').notNull().default('web'),
  payload: text('payload').notNull().default('{}'), // JSON
  exportedAt: text('exported_at'),
});

export const dailySummaries = sqliteTable('daily_summaries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  metrics: text('metrics').notNull().default('{}'), // JSON
  generatedAt: text('generated_at').notNull(),
});

export const personalSummaries = sqliteTable('personal_summaries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  period: text('period').notNull(),
  date: text('date').notNull(),
  xpEarned: integer('xp_earned').notNull().default(0),
  streakDays: integer('streak_days').notNull().default(0),
  subjectsAdvanced: text('subjects_advanced').notNull().default('[]'), // JSON
  subjectsAbandoned: text('subjects_abandoned').notNull().default('[]'), // JSON
  riskChange: integer('risk_change').notNull().default(0),
  chaptersConsolidated: text('chapters_consolidated').notNull().default('[]'), // JSON
  aiCardsPendingReview: integer('ai_cards_pending_review').notNull().default(0),
  topMasteryGains: text('top_mastery_gains').notNull().default('[]'), // JSON
  questsCompleted: integer('quests_completed').notNull().default(0),
  highPriorityPending: integer('high_priority_pending').notNull().default(0),
  hardTopicsCount: integer('hard_topics_count').notNull().default(0),
  syllabusCoverageDelta: real('syllabus_coverage_delta').notNull().default(0),
  generatedAt: text('generated_at').notNull(),
});

// ─── Curriculum (synced) ───────────────────────────────────────────────────

export const curriculumPrograms = sqliteTable('curriculum_programs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  career: text('career'),
  year: integer('year'),
  semester: integer('semester'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const curriculumSubjects = sqliteTable('curriculum_subjects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  programId: text('program_id').notNull(),
  name: text('name').notNull(),
  code: text('code'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const curriculumModules = sqliteTable('curriculum_modules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  subjectId: text('subject_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const curriculumChapters = sqliteTable('curriculum_chapters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  moduleId: text('module_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  examScope: text('exam_scope'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const curriculumTopics = sqliteTable('curriculum_topics', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  chapterId: text('chapter_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  priorityDefault: text('priority_default'),
  conceptualDifficultyDefault: text('conceptual_difficulty_default'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const curriculumLinks = sqliteTable('curriculum_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  noteId: text('note_id'),
  cardId: text('card_id'),
  deckId: text('deck_id'),
  programId: text('program_id'),
  subjectId: text('subject_id'),
  moduleId: text('module_id'),
  chapterId: text('chapter_id'),
  topicId: text('topic_id'),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at'),
});

// ─── Gamification (synced) ─────────────────────────────────────────────────

export const userGamification = sqliteTable('user_gamification', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  totalXP: integer('total_xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  streakFreezes: integer('streak_freezes').notNull().default(0),
  lastStudyDate: text('last_study_date'),
  streakFrozenToday: integer('streak_frozen_today', { mode: 'boolean' }).notNull().default(false),
  dailyGoal: integer('daily_goal').notNull().default(20),
  easyDayMultiplier: real('easy_day_multiplier').notNull().default(0.5),
  achievements: text('achievements').notNull().default('[]'), // JSON
  updatedAt: text('updated_at').notNull(),
});

// ─── Sync metadata ─────────────────────────────────────────────────────────

export const syncCursors = sqliteTable('sync_cursors', {
  id: text('id').primaryKey(), // format: "{userId}:{deviceId}"
  userId: text('user_id').notNull().references(() => users.id),
  deviceId: text('device_id').notNull(),
  lastSyncedAt: text('last_synced_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const syncOperations = sqliteTable('sync_operations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deviceId: text('device_id'),
  tableName: text('table_name').notNull(),
  operation: text('operation').notNull(),
  recordId: text('record_id').notNull(),
  clientUpdatedAt: text('client_updated_at'),
  receivedAt: text('received_at').notNull(),
});

export const schemaMigrations = sqliteTable('schema_migrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  appliedAt: text('applied_at').notNull(),
  checksum: text('checksum'),
});

export const copilotDrafts = sqliteTable('copilot_drafts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  agentId: text('agent_id').notNull().default('copilot'),
  status: text('status').notNull().default('pending'),
  noteType: text('note_type').notNull(),
  deck: text('deck').notNull(),
  fields: text('fields').notNull().default('{}'),
  tags: text('tags').notNull().default('[]'),
  subject: text('subject'),
  reason: text('reason'),
  sourceMetadata: text('source_metadata').notNull().default('{}'),
  sourceAssets: text('source_assets').notNull().default('[]'),
  sourceActionId: text('source_action_id'),
  importedNoteId: text('imported_note_id'),
  reviewerComment: text('reviewer_comment'),
  createdAt: text('created_at').notNull(),
  reviewedAt: text('reviewed_at'),
  updatedAt: text('updated_at').notNull(),
});

export const copilotOutcomes = sqliteTable('copilot_outcomes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  recommendationId: text('recommendation_id'),
  actionType: text('action_type').notNull(),
  actionTaken: integer('action_taken', { mode: 'boolean' }).notNull().default(false),
  executedAt: text('executed_at'),
  resultSummary: text('result_summary'),
  cardsImported: integer('cards_imported').notNull().default(0),
  cardsStudied: integer('cards_studied').notNull().default(0),
  riskDelta: real('risk_delta'),
  masteryDelta: real('mastery_delta'),
  userDismissed: integer('user_dismissed', { mode: 'boolean' }).notNull().default(false),
  payload: text('payload').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  studyReminders: integer('study_reminders', { mode: 'boolean' }).notNull().default(true),
  streakAlerts: integer('streak_alerts', { mode: 'boolean' }).notNull().default(true),
  dailySummary: integer('daily_summary', { mode: 'boolean' }).notNull().default(false),
  quietStart: text('quiet_start').notNull().default('22:00'),
  quietEnd: text('quiet_end').notNull().default('08:00'),
  reminderTime: text('reminder_time').notNull().default('09:00'),
  pushSubscription: text('push_subscription'),
  updatedAt: text('updated_at').notNull(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull(),
  keysP256dh: text('keys_p256dh').notNull(),
  keysAuth: text('keys_auth').notNull(),
  createdAt: text('created_at').notNull(),
});
