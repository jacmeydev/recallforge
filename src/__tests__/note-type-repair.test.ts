import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { repairMissingServerNoteTypesInDatabase } from '@/lib/server/note-type-repair';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE note_types (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      note_type_id TEXT NOT NULL,
      field_values TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      hash TEXT NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'new',
      queue_position INTEGER NOT NULL DEFAULT 0,
      stability REAL NOT NULL DEFAULT 0,
      difficulty REAL NOT NULL DEFAULT 0,
      elapsed_days REAL NOT NULL DEFAULT 0,
      scheduled_days REAL NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      custom_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  return db;
}

describe('repairMissingServerNoteTypesInDatabase', () => {
  it('recreates a basic note type from imported notes and cards', () => {
    const db = createTestDb();
    const userId = 'u-1';
    const noteTypeId = 'nt-missing';
    const ts = '2026-03-13T15:00:00.000Z';

    db.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'note-1',
      userId,
      'deck-1',
      noteTypeId,
      JSON.stringify({ Front: 'Q', Back: 'A' }),
      'hash-1',
      ts,
      ts
    );

    db.prepare(`
      INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('card-1', userId, 'note-1', 'tpl-1', 'deck-1', ts, ts, ts);

    const result = repairMissingServerNoteTypesInDatabase(db, userId);
    expect(result.repaired).toBe(1);
    expect(result.noteTypeIds).toContain(noteTypeId);

    const repaired = db.prepare('SELECT kind, fields, templates FROM note_types WHERE id = ?').get(noteTypeId) as {
      kind: string;
      fields: string;
      templates: string;
    };

    expect(repaired.kind).toBe('basic');

    const fields = JSON.parse(repaired.fields) as Array<{ name: string; required: boolean }>;
    const templates = JSON.parse(repaired.templates) as Array<{ id: string; frontTemplate: string }>;

    expect(fields.map((field) => field.name)).toEqual(expect.arrayContaining(['Front', 'Back']));
    expect(fields.find((field) => field.name === 'Front')?.required).toBe(true);
    expect(templates[0]?.id).toBe('tpl-1');
    expect(templates[0]?.frontTemplate).toContain('{{Front}}');
  });

  it('does nothing when the note type already exists', () => {
    const db = createTestDb();
    const userId = 'u-1';
    const ts = '2026-03-13T15:00:00.000Z';

    db.prepare(`
      INSERT INTO note_types (id, user_id, name, kind, css, version, fields, templates, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      'nt-existing',
      userId,
      'basic',
      'basic',
      '',
      '[]',
      '[]',
      ts,
      ts
    );

    const result = repairMissingServerNoteTypesInDatabase(db, userId);
    expect(result.repaired).toBe(0);
    expect(result.noteTypeIds).toHaveLength(0);
  });
});

