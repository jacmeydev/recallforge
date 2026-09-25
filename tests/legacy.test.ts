import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/lib/core/db';
import { getCard } from '@/lib/core/cards';
import { listDecks } from '@/lib/core/decks';
import { getLocalUser } from '@/lib/core/users';

// Subset of the v1 schema (Anki-style notes + templates synced from the browser).
const LEGACY_SCHEMA = `
  CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT);
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, avatar_url TEXT,
    locale TEXT NOT NULL DEFAULT 'es', timezone TEXT NOT NULL DEFAULT 'America/Bogota', theme TEXT NOT NULL DEFAULT 'system',
    study_preferences TEXT NOT NULL DEFAULT '{}', api_key TEXT UNIQUE, api_key_hash TEXT UNIQUE, api_key_preview TEXT,
    api_key_last_rotated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE decks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    parent_deck_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, preset_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE INDEX idx_decks_user ON decks(user_id);
  CREATE TABLE note_types (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL, css TEXT NOT NULL DEFAULT '', js TEXT, version INTEGER NOT NULL DEFAULT 1,
    fields TEXT NOT NULL DEFAULT '[]', templates TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE TABLE notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), deck_id TEXT NOT NULL, note_type_id TEXT NOT NULL,
    field_values TEXT NOT NULL DEFAULT '{}', tags TEXT NOT NULL DEFAULT '[]', source TEXT, source_metadata TEXT, hash TEXT NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), note_id TEXT NOT NULL, template_id TEXT NOT NULL,
    deck_id TEXT NOT NULL, due_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new', queue_position INTEGER NOT NULL DEFAULT 0,
    stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0, retrievability REAL, elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0, last_review_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, buried_until TEXT,
    custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE INDEX idx_cards_user_deck ON cards(user_id, deck_id);
  CREATE TABLE review_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), card_id TEXT NOT NULL, reviewed_at TEXT NOT NULL,
    client_reviewed_at TEXT, server_received_at TEXT, effective_reviewed_at TEXT, offset_measured_at TEXT,
    time_source TEXT NOT NULL DEFAULT 'client', rating TEXT NOT NULL, previous_state TEXT NOT NULL, next_state TEXT NOT NULL,
    previous_due_at TEXT NOT NULL, next_due_at TEXT NOT NULL, previous_stability REAL NOT NULL, next_stability REAL NOT NULL,
    previous_difficulty REAL NOT NULL, next_difficulty REAL NOT NULL, response_time_ms INTEGER NOT NULL,
    was_manual_reschedule INTEGER NOT NULL DEFAULT 0, was_filtered_deck INTEGER NOT NULL DEFAULT 0, session_id TEXT,
    device_id TEXT, device_seq INTEGER, clock_offset_ms INTEGER, replay_ordinal INTEGER,
    scheduler_context TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE TABLE user_gamification (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, total_xp INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
`;

const TS = '2026-01-10T10:00:00.000Z';

function seedLegacyDatabase(file: string) {
  const db = new Database(file);
  db.exec(LEGACY_SCHEMA);
  db.prepare(`INSERT INTO schema_migrations VALUES ('001_base_schema', 'base', ?, NULL)`).run(TS);
  db.prepare(`INSERT INTO users (id, email, name, api_key, created_at, updated_at) VALUES ('u1', 'ana@example.com', 'Ana', 'rf_legacy_plaintext', ?, ?)`).run(TS, TS);

  const deck = db.prepare(`INSERT INTO decks (id, user_id, name, parent_deck_id, created_at, updated_at, deleted_at) VALUES (?, 'u1', ?, ?, ?, ?, ?)`);
  deck.run('d-med', 'Medicina', null, TS, TS, null);
  deck.run('d-cardio', 'Cardio', 'd-med', TS, TS, null);
  deck.run('d-gone', 'Borrado', null, TS, TS, TS);

  const basicTemplates = JSON.stringify([
    { id: 't1', frontTemplate: '<div class="front">{{Front}}</div>', backTemplate: '{{FrontSide}}<hr id="answer">{{Back}}<div>{{Extra}}</div>' },
    { id: 't2', frontTemplate: '{{Back}}', backTemplate: '{{FrontSide}}<hr id="answer">{{Front}}' },
  ]);
  const clozeTemplates = JSON.stringify([{ id: 'tc', frontTemplate: '{{cloze:Text}}', backTemplate: '{{cloze:Text}}' }]);
  const noteType = db.prepare(`INSERT INTO note_types (id, user_id, name, kind, templates, created_at, updated_at) VALUES (?, 'u1', ?, ?, ?, ?, ?)`);
  noteType.run('nt-basic', 'Basic (and reversed)', 'basic_reversed', basicTemplates, TS, TS);
  noteType.run('nt-cloze', 'Cloze', 'cloze', clozeTemplates, TS, TS);
  noteType.run('nt-io', 'IO', 'image_occlusion', '[]', TS, TS);

  const note = db.prepare(
    `INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source_metadata, hash, created_at, updated_at)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, 'h', ?, ?)`
  );
  note.run('n1', 'd-cardio', 'nt-basic', JSON.stringify({ Front: 'Válvula entre AI y VI', Back: 'Mitral', Extra: 'Bicúspide' }), '["anatomía"]',
    JSON.stringify({ academic: { book: 'Moore', sourcePage: '120' } }), TS, TS);
  note.run('n2', 'd-cardio', 'nt-cloze', JSON.stringify({ Text: 'La {{c1::aorta}} sale del {{c2::ventrículo izquierdo::cavidad}}' }), '[]', null, TS, TS);
  note.run('n3', 'd-med', 'nt-io', JSON.stringify({ Image: 'x.png', Masks: '[]' }), '[]', null, TS, TS);

  const card = db.prepare(
    `INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, stability, difficulty, reps, lapses, last_review_at, custom_data, created_at, updated_at)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  card.run('c1', 'n1', 't1', 'd-cardio', '2026-01-20T10:00:00.000Z', 'review', 12.5, 5.1, 4, 1, TS, '{}', TS, TS);
  card.run('c2', 'n1', 't2', 'd-cardio', TS, 'new', 0, 0, 0, 0, null, '{}', TS, TS);
  card.run('c3', 'n2', 'tc', 'd-cardio', TS, 'new', 0, 0, 0, 0, null, '{"clozeIndex":2}', TS, TS);
  card.run('c4', 'n3', 'tio', 'd-med', TS, 'new', 0, 0, 0, 0, null, '{"maskIndex":0}', TS, TS);

  db.prepare(
    `INSERT INTO review_logs (id, user_id, card_id, reviewed_at, effective_reviewed_at, rating, previous_state, next_state, previous_due_at,
       next_due_at, previous_stability, next_stability, previous_difficulty, next_difficulty, response_time_ms, created_at)
     VALUES ('r1', 'u1', 'c1', ?, ?, 'good', 'learning', 'review', ?, '2026-01-20T10:00:00.000Z', 1, 12.5, 5, 5.1, 4200, ?)`
  ).run(TS, TS, TS, TS);
  db.close();
}

afterEach(() => closeDb());

describe('legacy v1 database conversion', () => {
  it('archives v1 tables and converts decks, cards, FSRS state and history; the v1 account becomes the local learner', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recallforge-legacy-'));
    const file = path.join(dir, 'legacy.db');
    seedLegacyDatabase(file);
    closeDb();
    process.env.RECALLFORGE_DB = file;
    const db = getDb();

    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['legacy_cards', 'legacy_notes', 'legacy_decks', 'legacy_user_gamification', 'cards', 'decks']));

    expect(listDecks('u1').map((d) => [d.name, d.counts.total])).toEqual([
      ['Medicina', 0],
      ['Medicina::Cardio', 3],
    ]);

    const forward = getCard('u1', 'c1');
    expect(forward).toMatchObject({
      front: 'Válvula entre AI y VI',
      back: 'Mitral',
      explanation: 'Bicúspide',
      source: 'Moore, p. 120',
      tags: ['anatomía'],
      state: 'review',
      reps: 4,
      lapses: 1,
      dueAt: '2026-01-20T10:00:00.000Z',
    });
    expect(getCard('u1', 'c2')).toMatchObject({ front: 'Mitral', back: 'Válvula entre AI y VI' });
    expect(getCard('u1', 'c3')).toMatchObject({
      front: 'La aorta sale del [cavidad]',
      back: 'ventrículo izquierdo',
      explanation: 'La aorta sale del ventrículo izquierdo',
    });
    expect(() => getCard('u1', 'c4')).toThrow(/not found/);

    const logs = db.prepare(`SELECT card_id, rating, state, duration_ms, source FROM review_logs`).all();
    expect(logs).toEqual([{ card_id: 'c1', rating: 'good', state: 'learning', duration_ms: 4200, source: 'legacy' }]);

    const user = db.prepare(`SELECT api_key FROM users WHERE id = 'u1'`).get() as { api_key: string | null };
    expect(user.api_key).toBeNull();
    expect(getLocalUser().id).toBe('u1');
  });
});
