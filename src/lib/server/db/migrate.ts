// ============================================================================
// RecallForge — Versioned Database Migrations
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { sqlite, DB_PATH } from './index';
import { getApiKeyPreview, hashApiKey } from '@/lib/server/api-keys';

type SQLiteDatabase = Database.Database;

interface MigrationIssue {
  level: 'error' | 'warn';
  message: string;
}

interface MigrationContext {
  db: SQLiteDatabase;
}

interface MigrationDefinition {
  id: string;
  name: string;
  checksum: string;
  apply: (ctx: MigrationContext) => void;
  precheck?: (ctx: MigrationContext) => MigrationIssue[];
  postcheck?: (ctx: MigrationContext) => MigrationIssue[];
}

export interface MigrationRunResult {
  applied: string[];
  schemaVersion: string | null;
  lastMigration: string | null;
  issues: MigrationIssue[];
}

export interface SchemaStatus {
  schemaVersion: string | null;
  lastMigration: string | null;
  appliedCount: number;
  pendingCount: number;
  replayBacklog: number;
}

const CORE_TABLES = [
  'users',
  'sessions',
  'decks',
  'presets',
  'note_types',
  'notes',
  'cards',
  'review_logs',
  'card_commands',
  'activity_events',
  'curriculum_programs',
  'curriculum_subjects',
  'curriculum_modules',
  'curriculum_chapters',
  'curriculum_topics',
  'curriculum_links',
  'copilot_drafts',
  'copilot_outcomes',
  'notification_preferences',
  'push_subscriptions',
  'sync_cursors',
  'sync_operations',
  'schema_migrations',
];

function checksumFor(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function tableExists(db: SQLiteDatabase, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function columnExists(db: SQLiteDatabase, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) return false;
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function indexExists(db: SQLiteDatabase, indexName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1`)
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

function addColumnIfMissing(db: SQLiteDatabase, tableName: string, sql: string, columnName: string) {
  if (!columnExists(db, tableName, columnName)) {
    db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${sql}`);
  }
}

function createIndexIfMissing(db: SQLiteDatabase, indexName: string, sql: string) {
  if (!indexExists(db, indexName)) {
    db.exec(sql);
  }
}

function ensureSchemaMigrationsTable(db: SQLiteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT
    );
  `);
}

function appliedMigrationIds(db: SQLiteDatabase): Set<string> {
  ensureSchemaMigrationsTable(db);
  const rows = db.prepare(`SELECT id FROM schema_migrations ORDER BY applied_at ASC`).all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

function normalizeAcademicMetadata(
  source: string | null,
  value: string | null
): string | null {
  if (!value) return value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return value;
  }

  const raw = parsed as Record<string, unknown>;
  const rawAcademic =
    raw.academic && typeof raw.academic === 'object' && !Array.isArray(raw.academic)
      ? (raw.academic as Record<string, unknown>)
      : {};

  const next: Record<string, unknown> = { ...raw };
  const academic: Record<string, unknown> = { ...rawAcademic };

  const academicFields = [
    'subject',
    'module',
    'chapter',
    'topic',
    'subtopic',
    'lectureDate',
    'professor',
    'sourcePage',
    'book',
    'className',
    'examScope',
    'aiGenerated',
    'aiReviewStatus',
    'priority',
    'conceptualDifficulty',
  ];

  for (const field of academicFields) {
    if (academic[field] === undefined && raw[field] !== undefined) {
      academic[field] = raw[field];
    }
  }

  if (academic.aiGenerated === undefined && source && ['ai-import', 'agent-import', 'ai-batch-import'].includes(source)) {
    academic.aiGenerated = true;
  }

  next.importSource = raw.importSource ?? source ?? 'manual';
  next.externalId = raw.externalId ?? null;
  next.duplicateKey = raw.duplicateKey ?? null;
  next.agentId = raw.agentId ?? null;
  next.academic = Object.fromEntries(
    Object.entries(academic).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
  );

  for (const field of academicFields) {
    delete next[field];
  }

  return JSON.stringify(next);
}

function backfillCanonicalSourceMetadata(db: SQLiteDatabase) {
  const rows = db
    .prepare(`SELECT id, source, source_metadata FROM notes WHERE source_metadata IS NOT NULL AND source_metadata != ''`)
    .all() as Array<{ id: string; source: string | null; source_metadata: string | null }>;

  const update = db.prepare(`UPDATE notes SET source_metadata = ? WHERE id = ?`);
  for (const row of rows) {
    const normalized = normalizeAcademicMetadata(row.source, row.source_metadata);
    if (normalized && normalized !== row.source_metadata) {
      update.run(normalized, row.id);
    }
  }
}

function backfillApiKeyHashes(db: SQLiteDatabase) {
  if (!columnExists(db, 'users', 'api_key_hash')) return;

  const rows = db.prepare(`
    SELECT id, api_key, api_key_hash, api_key_preview, api_key_last_rotated_at, updated_at
    FROM users
  `).all() as Array<{
    id: string;
    api_key: string | null;
    api_key_hash: string | null;
    api_key_preview: string | null;
    api_key_last_rotated_at: string | null;
    updated_at: string | null;
  }>;

  const update = db.prepare(`
    UPDATE users
    SET api_key = ?,
        api_key_hash = ?,
        api_key_preview = ?,
        api_key_last_rotated_at = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    if (!row.api_key && row.api_key_hash) continue;

    if (row.api_key) {
      update.run(
        null,
        hashApiKey(row.api_key),
        row.api_key_preview ?? getApiKeyPreview(row.api_key),
        row.api_key_last_rotated_at ?? row.updated_at ?? new Date().toISOString(),
        row.id
      );
    }
  }
}

function createBaseSchema(db: SQLiteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      avatar_url TEXT,
      locale TEXT NOT NULL DEFAULT 'es',
      timezone TEXT NOT NULL DEFAULT 'America/Bogota',
      theme TEXT NOT NULL DEFAULT 'system',
      study_preferences TEXT NOT NULL DEFAULT '{}',
      api_key TEXT UNIQUE,
      api_key_hash TEXT UNIQUE,
      api_key_preview TEXT,
      api_key_last_rotated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      parent_deck_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      preset_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      desired_retention REAL NOT NULL DEFAULT 0.9,
      learning_steps TEXT NOT NULL DEFAULT '[]',
      relearning_steps TEXT NOT NULL DEFAULT '[]',
      maximum_interval INTEGER NOT NULL DEFAULT 36500,
      enable_fuzz INTEGER NOT NULL DEFAULT 1,
      bury_new_siblings INTEGER NOT NULL DEFAULT 1,
      bury_review_siblings INTEGER NOT NULL DEFAULT 1,
      new_card_order TEXT NOT NULL DEFAULT 'sequential',
      review_order TEXT NOT NULL DEFAULT 'due_date',
      daily_limits TEXT NOT NULL DEFAULT '{"newCards":20,"reviews":200}',
      fsrs_parameters TEXT NOT NULL DEFAULT '[]',
      optimizer_metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS note_types (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      css TEXT NOT NULL DEFAULT '',
      js TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      fields TEXT NOT NULL DEFAULT '[]',
      templates TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      deck_id TEXT NOT NULL,
      note_type_id TEXT NOT NULL,
      field_values TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      source_metadata TEXT,
      hash TEXT NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      note_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'new',
      queue_position INTEGER NOT NULL DEFAULT 0,
      stability REAL NOT NULL DEFAULT 0,
      difficulty REAL NOT NULL DEFAULT 0,
      retrievability REAL,
      elapsed_days REAL NOT NULL DEFAULT 0,
      scheduled_days REAL NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      last_review_at TEXT,
      suspended INTEGER NOT NULL DEFAULT 0,
      buried_until TEXT,
      custom_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      card_id TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      client_reviewed_at TEXT,
      server_received_at TEXT,
      effective_reviewed_at TEXT,
      offset_measured_at TEXT,
      time_source TEXT NOT NULL DEFAULT 'client',
      rating TEXT NOT NULL,
      previous_state TEXT NOT NULL,
      next_state TEXT NOT NULL,
      previous_due_at TEXT NOT NULL,
      next_due_at TEXT NOT NULL,
      previous_stability REAL NOT NULL,
      next_stability REAL NOT NULL,
      previous_difficulty REAL NOT NULL,
      next_difficulty REAL NOT NULL,
      response_time_ms INTEGER NOT NULL,
      was_manual_reschedule INTEGER NOT NULL DEFAULT 0,
      was_filtered_deck INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      device_id TEXT,
      device_seq INTEGER,
      clock_offset_ms INTEGER,
      replay_ordinal INTEGER,
      scheduler_context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      command TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      client_issued_at TEXT,
      server_received_at TEXT,
      effective_at TEXT,
      offset_measured_at TEXT,
      time_source TEXT NOT NULL DEFAULT 'client',
      device_id TEXT,
      device_seq INTEGER,
      clock_offset_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      session_id TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      payload TEXT NOT NULL DEFAULT '{}',
      exported_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personal_summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      period TEXT NOT NULL,
      date TEXT NOT NULL,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 0,
      subjects_advanced TEXT NOT NULL DEFAULT '[]',
      subjects_abandoned TEXT NOT NULL DEFAULT '[]',
      risk_change INTEGER NOT NULL DEFAULT 0,
      chapters_consolidated TEXT NOT NULL DEFAULT '[]',
      ai_cards_pending_review INTEGER NOT NULL DEFAULT 0,
      top_mastery_gains TEXT NOT NULL DEFAULT '[]',
      quests_completed INTEGER NOT NULL DEFAULT 0,
      high_priority_pending INTEGER NOT NULL DEFAULT 0,
      hard_topics_count INTEGER NOT NULL DEFAULT 0,
      syllabus_coverage_delta REAL NOT NULL DEFAULT 0,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS curriculum_programs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      career TEXT,
      year INTEGER,
      semester INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS curriculum_subjects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      program_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS curriculum_modules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subject_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS curriculum_chapters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      module_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      exam_scope TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS curriculum_topics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      chapter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      priority_default TEXT,
      conceptual_difficulty_default TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS curriculum_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      note_id TEXT,
      card_id TEXT,
      deck_id TEXT,
      program_id TEXT,
      subject_id TEXT,
      module_id TEXT,
      chapter_id TEXT,
      topic_id TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_gamification (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      total_xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      streak_freezes INTEGER NOT NULL DEFAULT 0,
      last_study_date TEXT,
      streak_frozen_today INTEGER NOT NULL DEFAULT 0,
      daily_goal INTEGER NOT NULL DEFAULT 20,
      easy_day_multiplier REAL NOT NULL DEFAULT 0.5,
      achievements TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      record_id TEXT NOT NULL,
      client_updated_at TEXT,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copilot_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      agent_id TEXT NOT NULL DEFAULT 'copilot',
      status TEXT NOT NULL DEFAULT 'pending',
      note_type TEXT NOT NULL,
      deck TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      subject TEXT,
      reason TEXT,
      source_metadata TEXT NOT NULL DEFAULT '{}',
      source_assets TEXT NOT NULL DEFAULT '[]',
      source_action_id TEXT,
      imported_note_id TEXT,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copilot_outcomes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      recommendation_id TEXT,
      action_type TEXT NOT NULL,
      action_taken INTEGER NOT NULL DEFAULT 0,
      executed_at TEXT,
      result_summary TEXT,
      cards_imported INTEGER NOT NULL DEFAULT 0,
      cards_studied INTEGER NOT NULL DEFAULT 0,
      risk_delta REAL,
      mastery_delta REAL,
      user_dismissed INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      enabled INTEGER NOT NULL DEFAULT 1,
      study_reminders INTEGER NOT NULL DEFAULT 1,
      streak_alerts INTEGER NOT NULL DEFAULT 1,
      daily_summary INTEGER NOT NULL DEFAULT 0,
      quiet_start TEXT NOT NULL DEFAULT '22:00',
      quiet_end TEXT NOT NULL DEFAULT '08:00',
      reminder_time TEXT NOT NULL DEFAULT '09:00',
      push_subscription TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, 'users', `api_key_hash TEXT`, 'api_key_hash');
  addColumnIfMissing(db, 'users', `api_key_preview TEXT`, 'api_key_preview');
  addColumnIfMissing(db, 'users', `api_key_last_rotated_at TEXT`, 'api_key_last_rotated_at');

  addColumnIfMissing(db, 'review_logs', `client_reviewed_at TEXT`, 'client_reviewed_at');
  addColumnIfMissing(db, 'review_logs', `server_received_at TEXT`, 'server_received_at');
  addColumnIfMissing(db, 'review_logs', `effective_reviewed_at TEXT`, 'effective_reviewed_at');
  addColumnIfMissing(db, 'review_logs', `offset_measured_at TEXT`, 'offset_measured_at');
  addColumnIfMissing(db, 'review_logs', `time_source TEXT NOT NULL DEFAULT 'client'`, 'time_source');
  addColumnIfMissing(db, 'review_logs', `device_seq INTEGER`, 'device_seq');
  addColumnIfMissing(db, 'review_logs', `clock_offset_ms INTEGER`, 'clock_offset_ms');
  addColumnIfMissing(db, 'review_logs', `replay_ordinal INTEGER`, 'replay_ordinal');
  addColumnIfMissing(db, 'review_logs', `scheduler_context TEXT NOT NULL DEFAULT '{}'`, 'scheduler_context');

  addColumnIfMissing(db, 'card_commands', `client_issued_at TEXT`, 'client_issued_at');
  addColumnIfMissing(db, 'card_commands', `server_received_at TEXT`, 'server_received_at');
  addColumnIfMissing(db, 'card_commands', `effective_at TEXT`, 'effective_at');
  addColumnIfMissing(db, 'card_commands', `offset_measured_at TEXT`, 'offset_measured_at');
  addColumnIfMissing(db, 'card_commands', `time_source TEXT NOT NULL DEFAULT 'client'`, 'time_source');
  addColumnIfMissing(db, 'card_commands', `device_seq INTEGER`, 'device_seq');
  addColumnIfMissing(db, 'card_commands', `clock_offset_ms INTEGER`, 'clock_offset_ms');
  addColumnIfMissing(db, 'copilot_drafts', `source_metadata TEXT NOT NULL DEFAULT '{}'`, 'source_metadata');
  addColumnIfMissing(db, 'copilot_drafts', `source_assets TEXT NOT NULL DEFAULT '[]'`, 'source_assets');

  createIndexIfMissing(db, 'idx_decks_user', `CREATE INDEX idx_decks_user ON decks(user_id)`);
  createIndexIfMissing(db, 'idx_users_api_key_hash_unique', `CREATE UNIQUE INDEX idx_users_api_key_hash_unique ON users(api_key_hash) WHERE api_key_hash IS NOT NULL`);
  createIndexIfMissing(db, 'idx_presets_user', `CREATE INDEX idx_presets_user ON presets(user_id, updated_at)`);
  createIndexIfMissing(db, 'idx_notes_user_deck', `CREATE INDEX idx_notes_user_deck ON notes(user_id, deck_id)`);
  createIndexIfMissing(db, 'idx_notes_hash', `CREATE INDEX idx_notes_hash ON notes(user_id, hash)`);
  createIndexIfMissing(db, 'idx_cards_user_deck', `CREATE INDEX idx_cards_user_deck ON cards(user_id, deck_id)`);
  createIndexIfMissing(db, 'idx_cards_user_state', `CREATE INDEX idx_cards_user_state ON cards(user_id, state)`);
  createIndexIfMissing(db, 'idx_review_logs_user', `CREATE INDEX idx_review_logs_user ON review_logs(user_id, reviewed_at)`);
  createIndexIfMissing(db, 'idx_review_logs_card_effective', `CREATE INDEX idx_review_logs_card_effective ON review_logs(card_id, effective_reviewed_at)`);
  createIndexIfMissing(db, 'idx_review_logs_device_seq', `CREATE UNIQUE INDEX idx_review_logs_device_seq ON review_logs(user_id, device_id, device_seq) WHERE device_id IS NOT NULL AND device_seq IS NOT NULL`);
  createIndexIfMissing(db, 'idx_card_commands_card_effective', `CREATE INDEX idx_card_commands_card_effective ON card_commands(card_id, effective_at)`);
  createIndexIfMissing(db, 'idx_card_commands_device_seq', `CREATE UNIQUE INDEX idx_card_commands_device_seq ON card_commands(user_id, device_id, device_seq) WHERE device_id IS NOT NULL AND device_seq IS NOT NULL`);
  createIndexIfMissing(db, 'idx_events_user_ts', `CREATE INDEX idx_events_user_ts ON activity_events(user_id, ts)`);
  createIndexIfMissing(db, 'idx_events_user_type', `CREATE INDEX idx_events_user_type ON activity_events(user_id, type)`);
  createIndexIfMissing(db, 'idx_daily_user_date', `CREATE INDEX idx_daily_user_date ON daily_summaries(user_id, date)`);
  createIndexIfMissing(db, 'idx_personal_user_date', `CREATE INDEX idx_personal_user_date ON personal_summaries(user_id, date)`);
  createIndexIfMissing(db, 'idx_curriculum_user', `CREATE INDEX idx_curriculum_user ON curriculum_programs(user_id)`);
  createIndexIfMissing(db, 'idx_curriculum_subject_user', `CREATE INDEX idx_curriculum_subject_user ON curriculum_subjects(user_id, program_id)`);
  createIndexIfMissing(db, 'idx_curriculum_module_user', `CREATE INDEX idx_curriculum_module_user ON curriculum_modules(user_id, subject_id)`);
  createIndexIfMissing(db, 'idx_curriculum_chapter_user', `CREATE INDEX idx_curriculum_chapter_user ON curriculum_chapters(user_id, module_id)`);
  createIndexIfMissing(db, 'idx_curriculum_topic_user', `CREATE INDEX idx_curriculum_topic_user ON curriculum_topics(user_id, chapter_id)`);
  createIndexIfMissing(db, 'idx_curriculum_links_note', `CREATE INDEX idx_curriculum_links_note ON curriculum_links(user_id, note_id)`);
  createIndexIfMissing(db, 'idx_decks_updated', `CREATE INDEX idx_decks_updated ON decks(user_id, updated_at)`);
  createIndexIfMissing(db, 'idx_notes_updated', `CREATE INDEX idx_notes_updated ON notes(user_id, updated_at)`);
  createIndexIfMissing(db, 'idx_cards_updated', `CREATE INDEX idx_cards_updated ON cards(user_id, updated_at)`);
  createIndexIfMissing(db, 'idx_copilot_drafts_user', `CREATE INDEX idx_copilot_drafts_user ON copilot_drafts(user_id, status)`);
  createIndexIfMissing(db, 'idx_copilot_outcomes_user', `CREATE INDEX idx_copilot_outcomes_user ON copilot_outcomes(user_id, created_at)`);
  createIndexIfMissing(db, 'idx_notification_prefs_user', `CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id)`);
  createIndexIfMissing(db, 'idx_push_subs_user', `CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id)`);
  createIndexIfMissing(db, 'idx_sync_operations_user_record', `CREATE INDEX idx_sync_operations_user_record ON sync_operations(user_id, table_name, record_id, received_at)`);
}

function applyPhase1Canonicalization(db: SQLiteDatabase) {
  addColumnIfMissing(db, 'users', `api_key_hash TEXT`, 'api_key_hash');
  addColumnIfMissing(db, 'users', `api_key_preview TEXT`, 'api_key_preview');
  addColumnIfMissing(db, 'users', `api_key_last_rotated_at TEXT`, 'api_key_last_rotated_at');

  addColumnIfMissing(db, 'review_logs', `client_reviewed_at TEXT`, 'client_reviewed_at');
  addColumnIfMissing(db, 'review_logs', `server_received_at TEXT`, 'server_received_at');
  addColumnIfMissing(db, 'review_logs', `effective_reviewed_at TEXT`, 'effective_reviewed_at');
  addColumnIfMissing(db, 'review_logs', `offset_measured_at TEXT`, 'offset_measured_at');
  addColumnIfMissing(db, 'review_logs', `time_source TEXT NOT NULL DEFAULT 'client'`, 'time_source');
  addColumnIfMissing(db, 'review_logs', `device_seq INTEGER`, 'device_seq');
  addColumnIfMissing(db, 'review_logs', `clock_offset_ms INTEGER`, 'clock_offset_ms');
  addColumnIfMissing(db, 'review_logs', `replay_ordinal INTEGER`, 'replay_ordinal');
  addColumnIfMissing(db, 'review_logs', `scheduler_context TEXT NOT NULL DEFAULT '{}'`, 'scheduler_context');

  createBaseSchema(db);
  backfillCanonicalSourceMetadata(db);
  backfillApiKeyHashes(db);
}

function applyCardCommandSchema(db: SQLiteDatabase) {
  createBaseSchema(db);
  addColumnIfMissing(db, 'card_commands', `client_issued_at TEXT`, 'client_issued_at');
  addColumnIfMissing(db, 'card_commands', `server_received_at TEXT`, 'server_received_at');
  addColumnIfMissing(db, 'card_commands', `effective_at TEXT`, 'effective_at');
  addColumnIfMissing(db, 'card_commands', `offset_measured_at TEXT`, 'offset_measured_at');
  addColumnIfMissing(db, 'card_commands', `time_source TEXT NOT NULL DEFAULT 'client'`, 'time_source');
  addColumnIfMissing(db, 'card_commands', `device_seq INTEGER`, 'device_seq');
  addColumnIfMissing(db, 'card_commands', `clock_offset_ms INTEGER`, 'clock_offset_ms');
  createIndexIfMissing(db, 'idx_card_commands_card_effective', `CREATE INDEX idx_card_commands_card_effective ON card_commands(card_id, effective_at)`);
  createIndexIfMissing(db, 'idx_card_commands_device_seq', `CREATE UNIQUE INDEX idx_card_commands_device_seq ON card_commands(user_id, device_id, device_seq) WHERE device_id IS NOT NULL AND device_seq IS NOT NULL`);
}

function coreSchemaIssues(db: SQLiteDatabase): MigrationIssue[] {
  const issues: MigrationIssue[] = [];

  for (const tableName of CORE_TABLES) {
    if (!tableExists(db, tableName)) {
      issues.push({ level: 'error', message: `Missing table: ${tableName}` });
    }
  }

  if (!columnExists(db, 'users', 'api_key_hash')) {
    issues.push({ level: 'error', message: 'Missing users.api_key_hash' });
  }

  if (!columnExists(db, 'review_logs', 'effective_reviewed_at')) {
    issues.push({ level: 'error', message: 'Missing review_logs.effective_reviewed_at' });
  }

  if (!indexExists(db, 'idx_review_logs_device_seq')) {
    issues.push({ level: 'warn', message: 'Missing review log idempotency index idx_review_logs_device_seq' });
  }

  return issues;
}

function cardCommandSchemaIssues(db: SQLiteDatabase): MigrationIssue[] {
  const issues: MigrationIssue[] = [];

  if (!tableExists(db, 'card_commands')) {
    issues.push({ level: 'error', message: 'Missing table: card_commands' });
  }

  if (!indexExists(db, 'idx_card_commands_device_seq')) {
    issues.push({ level: 'warn', message: 'Missing card command idempotency index idx_card_commands_device_seq' });
  }

  return issues;
}

function copilotDraftSchemaIssues(db: SQLiteDatabase): MigrationIssue[] {
  const issues: MigrationIssue[] = [];

  if (!tableExists(db, 'copilot_drafts')) {
    issues.push({ level: 'error', message: 'Missing table: copilot_drafts' });
    return issues;
  }

  if (!columnExists(db, 'copilot_drafts', 'source_metadata')) {
    issues.push({ level: 'error', message: 'Missing copilot_drafts.source_metadata' });
  }

  if (!columnExists(db, 'copilot_drafts', 'source_assets')) {
    issues.push({ level: 'error', message: 'Missing copilot_drafts.source_assets' });
  }

  return issues;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    id: '20260312_001_bootstrap_schema',
    name: 'Bootstrap core schema',
    checksum: checksumFor('20260312_001_bootstrap_schema'),
    apply: ({ db }) => {
      createBaseSchema(db);
    },
    postcheck: ({ db }) => coreSchemaIssues(db),
  },
  {
    id: '20260312_002_phase1_canonicalization',
    name: 'Canonicalize API keys, source metadata, review replay columns',
    checksum: checksumFor('20260312_002_phase1_canonicalization'),
    precheck: ({ db }) => coreSchemaIssues(db).filter((issue) => issue.level === 'error'),
    apply: ({ db }) => {
      applyPhase1Canonicalization(db);
    },
    postcheck: ({ db }) => coreSchemaIssues(db),
  },
  {
    id: '20260312_003_card_commands',
    name: 'Add explicit card command stream for sync-safe operational actions',
    checksum: checksumFor('20260312_003_card_commands'),
    apply: ({ db }) => {
      applyCardCommandSchema(db);
    },
    postcheck: ({ db }) => cardCommandSchemaIssues(db),
  },
  {
    id: '20260312_004_openclaw_draft_metadata',
    name: 'Persist rich draft metadata and source assets for OpenClaw ingestion',
    checksum: checksumFor('20260312_004_openclaw_draft_metadata'),
    apply: ({ db }) => {
      createBaseSchema(db);
      addColumnIfMissing(db, 'copilot_drafts', `source_metadata TEXT NOT NULL DEFAULT '{}'`, 'source_metadata');
      addColumnIfMissing(db, 'copilot_drafts', `source_assets TEXT NOT NULL DEFAULT '[]'`, 'source_assets');
    },
    postcheck: ({ db }) => copilotDraftSchemaIssues(db),
  },
];

function recordMigration(db: SQLiteDatabase, migration: MigrationDefinition) {
  db.prepare(`
    INSERT INTO schema_migrations (id, name, applied_at, checksum)
    VALUES (?, ?, ?, ?)
  `).run(migration.id, migration.name, new Date().toISOString(), migration.checksum);
}

function pendingMigrations(db: SQLiteDatabase): MigrationDefinition[] {
  const applied = appliedMigrationIds(db);
  return MIGRATIONS.filter((migration) => !applied.has(migration.id));
}

function runMigrationChecks(migration: MigrationDefinition, phase: 'precheck' | 'postcheck', db: SQLiteDatabase): MigrationIssue[] {
  const fn = phase === 'precheck' ? migration.precheck : migration.postcheck;
  if (!fn) return [];
  return fn({ db });
}

export function runMigrations(options: { database?: SQLiteDatabase } = {}): MigrationRunResult {
  const db = options.database ?? sqlite;
  ensureSchemaMigrationsTable(db);

  const issues: MigrationIssue[] = [];
  const applied: string[] = [];

  for (const migration of pendingMigrations(db)) {
    const preIssues = runMigrationChecks(migration, 'precheck', db);
    const fatalPreIssues = preIssues.filter((issue) => issue.level === 'error');
    if (fatalPreIssues.length > 0) {
      throw new Error(`Migration ${migration.id} precheck failed: ${fatalPreIssues.map((issue) => issue.message).join('; ')}`);
    }
    issues.push(...preIssues);

    db.transaction(() => {
      migration.apply({ db });
      recordMigration(db, migration);
    })();
    applied.push(migration.id);

    const postIssues = runMigrationChecks(migration, 'postcheck', db);
    const fatalPostIssues = postIssues.filter((issue) => issue.level === 'error');
    issues.push(...postIssues);

    if (fatalPostIssues.length > 0) {
      throw new Error(`Migration ${migration.id} postcheck failed: ${fatalPostIssues.map((issue) => issue.message).join('; ')}`);
    }
  }

  return {
    applied,
    ...getSchemaStatus(db),
    issues,
  };
}

export function getSchemaStatus(database: SQLiteDatabase = sqlite): SchemaStatus {
  ensureSchemaMigrationsTable(database);

  const lastMigration = database
    .prepare(`SELECT id FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`)
    .get() as { id: string } | undefined;

  const appliedCountRow = database
    .prepare(`SELECT COUNT(*) AS count FROM schema_migrations`)
    .get() as { count: number };

  return {
    schemaVersion: lastMigration?.id ?? null,
    lastMigration: lastMigration?.id ?? null,
    appliedCount: appliedCountRow.count,
    pendingCount: pendingMigrations(database).length,
    replayBacklog: getReplayBacklogCount(database),
  };
}

export function getReplayBacklogCount(database: SQLiteDatabase = sqlite): number {
  if (!tableExists(database, 'review_logs')) return 0;
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM review_logs
      WHERE effective_reviewed_at IS NULL
         OR server_received_at IS NULL
         OR scheduler_context IS NULL
         OR scheduler_context = ''
    `)
    .get() as { count: number };
  return row.count;
}

export function createDatabaseBackup(options: {
  database?: SQLiteDatabase;
  databasePath?: string;
  label?: string;
} = {}): string {
  const db = options.database ?? sqlite;
  const sourcePath = options.databasePath ?? DB_PATH;
  const label = options.label ?? 'manual';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'data', 'backups');
  const backupPath = path.join(backupDir, `${path.basename(sourcePath, '.db')}-${label}-${timestamp}.db`);

  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(backupPath)) {
    fs.rmSync(backupPath);
  }

  db.pragma('wal_checkpoint(FULL)');
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return backupPath;
}

export function rehearseMigrations(options: {
  sourcePath?: string;
  targetPath?: string;
} = {}): { backupPath: string; rehearsalPath: string; result: MigrationRunResult } {
  const sourcePath = options.sourcePath ?? DB_PATH;
  const rehearsalDir = path.join(process.cwd(), '.tmp', 'migration-rehearsal');
  fs.mkdirSync(rehearsalDir, { recursive: true });

  const rehearsalPath =
    options.targetPath ??
    path.join(rehearsalDir, `${path.basename(sourcePath, '.db')}-rehearsal-${Date.now()}.db`);

  fs.copyFileSync(sourcePath, rehearsalPath);
  const rehearsalDb = new Database(rehearsalPath);
  rehearsalDb.pragma('journal_mode = WAL');
  rehearsalDb.pragma('foreign_keys = ON');

  try {
    const backupPath = createDatabaseBackup({
      database: rehearsalDb,
      databasePath: rehearsalPath,
      label: 'rehearsal-preflight',
    });
    const result = runMigrations({ database: rehearsalDb });
    return { backupPath, rehearsalPath, result };
  } finally {
    rehearsalDb.close();
  }
}

export function restoreDatabaseBackup(backupPath: string, targetPath: string = DB_PATH) {
  fs.copyFileSync(backupPath, targetPath);
}
