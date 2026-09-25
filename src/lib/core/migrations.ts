// ============================================================================
// RecallForge — Schema migrations
// ============================================================================
// Append-only list. Each migration runs once, inside a transaction, and is
// recorded in schema_migrations.
// ============================================================================

import type Database from 'better-sqlite3';
import { archiveLegacyTables, convertLegacyData, hasLegacySchema } from './legacy';

type DB = Database.Database;

interface Migration {
  id: string;
  up: (db: DB) => void;
}

const MIGRATIONS: Migration[] = [
  {
    id: '2026_09_agent_core',
    up(db) {
      const legacy = hasLegacySchema(db);
      if (legacy) archiveLegacyTables(db);

      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          api_key_hash TEXT UNIQUE,
          api_key_preview TEXT,
          api_key_last_rotated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE decks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX ux_decks_user_name ON decks(user_id, name COLLATE NOCASE);

        CREATE TABLE cards (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
          front TEXT NOT NULL,
          back TEXT NOT NULL,
          explanation TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          state TEXT NOT NULL DEFAULT 'new',
          due_at TEXT NOT NULL,
          stability REAL NOT NULL DEFAULT 0,
          difficulty REAL NOT NULL DEFAULT 0,
          elapsed_days REAL NOT NULL DEFAULT 0,
          scheduled_days REAL NOT NULL DEFAULT 0,
          reps INTEGER NOT NULL DEFAULT 0,
          lapses INTEGER NOT NULL DEFAULT 0,
          learning_steps INTEGER NOT NULL DEFAULT 0,
          last_review_at TEXT,
          suspended INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX ix_cards_queue ON cards(user_id, suspended, state, due_at);
        CREATE INDEX ix_cards_deck ON cards(deck_id);

        CREATE TABLE review_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          reviewed_at TEXT NOT NULL,
          rating TEXT NOT NULL,
          state TEXT NOT NULL,
          next_state TEXT NOT NULL,
          due_at TEXT,
          next_due_at TEXT NOT NULL,
          stability REAL,
          next_stability REAL,
          difficulty REAL,
          next_difficulty REAL,
          elapsed_days REAL,
          scheduled_days REAL,
          duration_ms INTEGER,
          answer TEXT,
          feedback TEXT,
          source TEXT NOT NULL DEFAULT 'api'
        );
        CREATE INDEX ix_review_logs_user_time ON review_logs(user_id, reviewed_at);
        CREATE INDEX ix_review_logs_card_time ON review_logs(card_id, reviewed_at);
      `);

      // Per-user study settings (JSON). Added separately so legacy users tables get it too.
      const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      if (!userColumns.some((column) => column.name === 'settings')) {
        db.exec(`ALTER TABLE users ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'`);
      }

      if (legacy) convertLegacyData(db);
    },
  },
  {
    // Source documents (split into pages/slides/sections), draft review and
    // per-card provenance.
    id: '2026_09_documents_and_drafts',
    up(db) {
      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          filename TEXT,
          mime_type TEXT,
          deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
          parts INTEGER NOT NULL DEFAULT 0,
          chars INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX ix_documents_user ON documents(user_id, created_at);

        CREATE TABLE document_parts (
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          idx INTEGER NOT NULL,
          label TEXT NOT NULL,
          text TEXT NOT NULL,
          PRIMARY KEY (document_id, idx)
        );

        ALTER TABLE cards ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE cards ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
        ALTER TABLE cards ADD COLUMN document_part INTEGER;
        CREATE INDEX ix_cards_document ON cards(document_id, document_part);
        CREATE INDEX ix_cards_status ON cards(user_id, status);
      `);
    },
  },
  {
    // Exam dates per subject and the card state before each review (for undo).
    id: '2026_09_exams_and_undo',
    up(db) {
      db.exec(`
        ALTER TABLE decks ADD COLUMN exam_date TEXT;
        ALTER TABLE review_logs ADD COLUMN snapshot TEXT;
      `);
    },
  },
  {
    // Exact source excerpt per card, an audit trail of content edits, and the
    // study mode/format of each review (practice answers never reschedule).
    id: '2026_09_sources_revisions_formats',
    up(db) {
      db.exec(`
        ALTER TABLE cards ADD COLUMN excerpt TEXT NOT NULL DEFAULT '';

        CREATE TABLE card_revisions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          changed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          reason TEXT,
          before TEXT NOT NULL,
          after TEXT NOT NULL
        );
        CREATE INDEX ix_card_revisions_card ON card_revisions(card_id, changed_at);

        ALTER TABLE review_logs ADD COLUMN mode TEXT NOT NULL DEFAULT 'review';
        ALTER TABLE review_logs ADD COLUMN format TEXT NOT NULL DEFAULT 'recall';
      `);
    },
  },
  {
    // Cloze cards (one card per {{cN::…}} deletion, grouped by note), images and
    // other media stored in the database, external ids for Anki imports, and
    // personal FSRS parameters.
    id: '2026_09_cloze_media_anki',
    up(db) {
      db.exec(`
        ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'basic';
        ALTER TABLE cards ADD COLUMN cloze_ord INTEGER;
        ALTER TABLE cards ADD COLUMN note_id TEXT;
        ALTER TABLE cards ADD COLUMN external_id TEXT;
        CREATE INDEX ix_cards_note ON cards(note_id);
        CREATE INDEX ix_cards_external ON cards(user_id, external_id);

        CREATE TABLE media (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          data BLOB NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX ux_media_user_sha ON media(user_id, sha256);
      `);
    },
  },
];

export function runMigrations(db: DB): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT
    );
  `);

  const applied = new Set(
    (db.prepare(`SELECT id FROM schema_migrations`).all() as Array<{ id: string }>).map((row) => row.id)
  );

  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`).run(
        migration.id,
        migration.id,
        new Date().toISOString()
      );
    })();
    ran.push(migration.id);
  }
  return ran;
}
