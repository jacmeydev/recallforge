// ============================================================================
// RecallForge — Sync Roundtrip Test
// Proves: data pushed by Browser A → server → pulled by Browser B
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import {
  toServerRecord,
  toClientRecord,
  JSON_COLS,
  BOOL_COLS,
} from '@/lib/sync/transform';

const TEST_USER_ID = `test-sync-${Date.now()}`;
const TEST_EMAIL = `${TEST_USER_ID}@test.com`;

beforeAll(() => {
  runMigrations();

  // Clean up old test data
  const oldUsers = sqlite.prepare(
    `SELECT id FROM users WHERE email LIKE 'test-sync-%@test.com'`
  ).all() as Array<{ id: string }>;
  for (const u of oldUsers) {
    sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM daily_summaries WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM personal_summaries WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM user_gamification WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM notification_preferences WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM copilot_outcomes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM copilot_drafts WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM sync_operations WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM sync_cursors WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_links WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_topics WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_chapters WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_modules WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_subjects WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_programs WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM card_commands WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM presets WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(u.id);
  }

  // Create test user
  sqlite.prepare(`
    INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
    VALUES (?, ?, 'Sync Test User', 'dummy', datetime('now'), datetime('now'))
  `).run(TEST_USER_ID, TEST_EMAIL);
});

// ─── Push → Pull Roundtrip ─────────────────────────────────────────────────

describe('Sync Roundtrip: Push → Server → Pull', () => {
  const DECK_ID = `deck-sync-test-${Date.now()}`;
  const NOTE_ID = `note-sync-test-${Date.now()}`;
  const CARD_ID = `card-sync-test-${Date.now()}`;

  it('push: deck created by Browser A reaches the server', () => {
    // Simulate what pushChanges → POST /api/sync/push does:
    // Convert client record to server format and insert
    const clientDeck = {
      id: DECK_ID,
      userId: TEST_USER_ID,
      name: 'Matemáticas Discretas',
      description: 'Deck de prueba para sync',
      sortOrder: 0,
      archived: false,
      metadata: { color: 'blue' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serverRecord = toServerRecord(clientDeck, TEST_USER_ID, JSON_COLS['decks']);
    serverRecord['id'] = DECK_ID;

    const cols = Object.keys(serverRecord).map(k => `"${k}"`).join(', ');
    const placeholders = Object.keys(serverRecord).map(() => '?').join(', ');
    const values = Object.values(serverRecord).map(v => v === undefined ? null : v);

    sqlite.prepare(`INSERT INTO decks (${cols}) VALUES (${placeholders})`).run(...values);

    // Verify it's in the DB
    const row = sqlite.prepare('SELECT * FROM decks WHERE id = ?').get(DECK_ID) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row['name']).toBe('Matemáticas Discretas');
    expect(row['user_id']).toBe(TEST_USER_ID);
  });

  it('push: note + card created by Browser A reach the server', () => {
    const clientNote = {
      id: NOTE_ID,
      userId: TEST_USER_ID,
      deckId: DECK_ID,
      noteTypeId: 'nt-basic',
      fieldValues: { front: '¿Qué es un grafo?', back: 'Conjunto de vértices y aristas' },
      tags: ['grafos', 'discretas'],
      hash: 'abc123',
      suspended: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serverNote = toServerRecord(clientNote, TEST_USER_ID, JSON_COLS['notes']);
    serverNote['id'] = NOTE_ID;
    const noteCols = Object.keys(serverNote).map(k => `"${k}"`).join(', ');
    const notePlaceholders = Object.keys(serverNote).map(() => '?').join(', ');
    const noteValues = Object.values(serverNote).map(v => v === undefined ? null : v);
    sqlite.prepare(`INSERT INTO notes (${noteCols}) VALUES (${notePlaceholders})`).run(...noteValues);

    const clientCard = {
      id: CARD_ID,
      userId: TEST_USER_ID,
      noteId: NOTE_ID,
      templateId: 'tpl-front-back',
      deckId: DECK_ID,
      dueAt: new Date().toISOString(),
      state: 'new',
      queuePosition: 0,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      learningSteps: 0,
      suspended: false,
      customData: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serverCard = toServerRecord(clientCard, TEST_USER_ID, JSON_COLS['cards']);
    serverCard['id'] = CARD_ID;
    const cardCols = Object.keys(serverCard).map(k => `"${k}"`).join(', ');
    const cardPlaceholders = Object.keys(serverCard).map(() => '?').join(', ');
    const cardValues = Object.values(serverCard).map(v => v === undefined ? null : v);
    sqlite.prepare(`INSERT INTO cards (${cardCols}) VALUES (${cardPlaceholders})`).run(...cardValues);

    // Verify both exist
    const noteRow = sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(NOTE_ID);
    const cardRow = sqlite.prepare('SELECT * FROM cards WHERE id = ?').get(CARD_ID);
    expect(noteRow).toBeDefined();
    expect(cardRow).toBeDefined();
  });

  it('pull: Browser B retrieves the deck created by Browser A', () => {
    // Simulate what GET /api/sync/pull does:
    // Query server DB for records updated since epoch
    const since = '1970-01-01T00:00:00.000Z';
    const rows = sqlite.prepare(
      `SELECT * FROM decks WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    ).all(TEST_USER_ID, since) as Record<string, unknown>[];

    expect(rows.length).toBeGreaterThanOrEqual(1);

    const deckRow = rows.find(r => r['id'] === DECK_ID)!;
    expect(deckRow).toBeDefined();

    // Convert to client format (what pullChanges does before bulkPut)
    const clientRecord = toClientRecord(deckRow, JSON_COLS['decks'], BOOL_COLS['decks']);

    expect(clientRecord['id']).toBe(DECK_ID);
    expect(clientRecord['userId']).toBe(TEST_USER_ID);
    expect(clientRecord['name']).toBe('Matemáticas Discretas');
    expect(clientRecord['description']).toBe('Deck de prueba para sync');
    // JSON columns are parsed back to objects
    expect(clientRecord['metadata']).toEqual({ color: 'blue' });
    // Boolean columns are converted back from integer to boolean
    expect(clientRecord['archived']).toBe(false);
    expect(typeof clientRecord['archived']).toBe('boolean');
  });

  it('pull: Browser B retrieves notes and cards with correct format', () => {
    const since = '1970-01-01T00:00:00.000Z';

    const noteRows = sqlite.prepare(
      `SELECT * FROM notes WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    ).all(TEST_USER_ID, since) as Record<string, unknown>[];

    const noteRow = noteRows.find(r => r['id'] === NOTE_ID)!;
    const clientNote = toClientRecord(noteRow, JSON_COLS['notes'], BOOL_COLS['notes']);

    // Verify JSON fields are properly parsed back
    expect(clientNote['fieldValues']).toEqual({
      front: '¿Qué es un grafo?',
      back: 'Conjunto de vértices y aristas',
    });
    expect(clientNote['tags']).toEqual(['grafos', 'discretas']);
    expect(clientNote['deckId']).toBe(DECK_ID);
    expect(clientNote['userId']).toBe(TEST_USER_ID);
    // Boolean columns are converted back from integer to boolean
    expect(clientNote['suspended']).toBe(false);
    expect(typeof clientNote['suspended']).toBe('boolean');

    const cardRows = sqlite.prepare(
      `SELECT * FROM cards WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    ).all(TEST_USER_ID, since) as Record<string, unknown>[];

    const cardRow = cardRows.find(r => r['id'] === CARD_ID)!;
    const clientCard = toClientRecord(cardRow, JSON_COLS['cards'], BOOL_COLS['cards']);

    expect(clientCard['state']).toBe('new');
    expect(clientCard['noteId']).toBe(NOTE_ID);
    expect(clientCard['deckId']).toBe(DECK_ID);
    expect(clientCard['customData']).toEqual({});
    // Boolean columns are converted back from integer to boolean
    expect(clientCard['suspended']).toBe(false);
    expect(typeof clientCard['suspended']).toBe('boolean');
  });

  it('pull: only returns records for the authenticated user', () => {
    const otherUserId = 'other-user-should-not-see';
    const since = '1970-01-01T00:00:00.000Z';

    const rows = sqlite.prepare(
      `SELECT * FROM decks WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    ).all(otherUserId, since) as Record<string, unknown>[];

    // Other user should NOT see test user's deck
    const found = rows.find(r => r['id'] === DECK_ID);
    expect(found).toBeUndefined();
  });

  it('push idempotent: updating a deck from Browser A is an upsert', () => {
    // Simulate update push
    const updateData = {
      name: 'Matemáticas Discretas (actualizado)',
      description: 'Descripción actualizada',
      updatedAt: new Date().toISOString(),
    };
    const serverUpdate = toServerRecord(updateData, TEST_USER_ID, JSON_COLS['decks']);

    const entries = Object.entries(serverUpdate).filter(([k]) => k !== 'id');
    const setClauses = entries.map(([k]) => `"${k}" = ?`).join(', ');
    const values = entries.map(([, v]) => v === undefined ? null : v);

    sqlite.prepare(
      `UPDATE decks SET ${setClauses} WHERE id = ?`
    ).run(...values, DECK_ID);

    const row = sqlite.prepare('SELECT * FROM decks WHERE id = ?').get(DECK_ID) as Record<string, unknown>;
    expect(row['name']).toBe('Matemáticas Discretas (actualizado)');
  });

  it('soft delete: deleted records excluded from pull, IDs returned for client delete', () => {
    // Soft-delete the deck
    const deletedAt = new Date().toISOString();
    sqlite.prepare(
      `UPDATE decks SET deleted_at = ? WHERE id = ? AND user_id = ?`
    ).run(deletedAt, DECK_ID, TEST_USER_ID);

    // Pull should NOT include the deck in upserts
    const upserts = sqlite.prepare(
      `SELECT * FROM decks WHERE user_id = ? AND updated_at > ? AND deleted_at IS NULL`
    ).all(TEST_USER_ID, '1970-01-01T00:00:00.000Z') as Record<string, unknown>[];
    const found = upserts.find(r => r['id'] === DECK_ID);
    expect(found).toBeUndefined();

    // But it SHOULD appear in deletes query
    const deletes = sqlite.prepare(
      `SELECT id FROM decks WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`
    ).all(TEST_USER_ID, '1970-01-01T00:00:00.000Z') as Array<{ id: string }>;
    expect(deletes.some(d => d.id === DECK_ID)).toBe(true);
  });
});

// ─── Cascade Delete: deck delete also soft-deletes notes & cards ───────────

describe('Cascade Delete: deck delete soft-deletes children on server', () => {
  const CASCADE_DECK = `cascade-deck-${Date.now()}`;
  const CASCADE_NOTE1 = `cascade-note1-${Date.now()}`;
  const CASCADE_NOTE2 = `cascade-note2-${Date.now()}`;
  const CASCADE_CARD1 = `cascade-card1-${Date.now()}`;
  const CASCADE_CARD2 = `cascade-card2-${Date.now()}`;
  const CASCADE_CARD3 = `cascade-card3-${Date.now()}`;

  it('setup: create a deck with 2 notes and 3 cards', () => {
    const ts = new Date().toISOString();

    sqlite.prepare(`INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
      VALUES (?, ?, 'Cascade Test Deck', '', 0, 0, '{}', ?, ?)`).run(CASCADE_DECK, TEST_USER_ID, ts, ts);

    sqlite.prepare(`INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, hash, suspended, created_at, updated_at)
      VALUES (?, ?, ?, 'nt-basic', '{"front":"Q1","back":"A1"}', '[]', 'h1', 0, ?, ?)`).run(CASCADE_NOTE1, TEST_USER_ID, CASCADE_DECK, ts, ts);

    sqlite.prepare(`INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, hash, suspended, created_at, updated_at)
      VALUES (?, ?, ?, 'nt-basic', '{"front":"Q2","back":"A2"}', '[]', 'h2', 0, ?, ?)`).run(CASCADE_NOTE2, TEST_USER_ID, CASCADE_DECK, ts, ts);

    sqlite.prepare(`INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, queue_position, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, suspended, custom_data, created_at, updated_at)
      VALUES (?, ?, ?, 'tpl1', ?, ?, 'new', 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}', ?, ?)`).run(CASCADE_CARD1, TEST_USER_ID, CASCADE_NOTE1, CASCADE_DECK, ts, ts, ts);

    sqlite.prepare(`INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, queue_position, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, suspended, custom_data, created_at, updated_at)
      VALUES (?, ?, ?, 'tpl1', ?, ?, 'new', 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}', ?, ?)`).run(CASCADE_CARD2, TEST_USER_ID, CASCADE_NOTE1, CASCADE_DECK, ts, ts, ts);

    sqlite.prepare(`INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, queue_position, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, suspended, custom_data, created_at, updated_at)
      VALUES (?, ?, ?, 'tpl1', ?, ?, 'new', 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}', ?, ?)`).run(CASCADE_CARD3, TEST_USER_ID, CASCADE_NOTE2, CASCADE_DECK, ts, ts, ts);

    // Verify all exist and are alive
    const deckRow = sqlite.prepare('SELECT id FROM decks WHERE id = ? AND deleted_at IS NULL').get(CASCADE_DECK);
    const noteCount = sqlite.prepare('SELECT count(*) as c FROM notes WHERE deck_id = ? AND deleted_at IS NULL').get(CASCADE_DECK) as { c: number };
    const cardCount = sqlite.prepare('SELECT count(*) as c FROM cards WHERE deck_id = ? AND deleted_at IS NULL').get(CASCADE_DECK) as { c: number };
    expect(deckRow).toBeDefined();
    expect(noteCount.c).toBe(2);
    expect(cardCount.c).toBe(3);
  });

  it('cascade: soft-deleting deck also soft-deletes its notes and cards', () => {
    const deletedAt = new Date().toISOString();

    // Simulate what the push route does when it receives a deck delete
    sqlite.prepare(`UPDATE decks SET deleted_at = ? WHERE id = ? AND user_id = ?`).run(deletedAt, CASCADE_DECK, TEST_USER_ID);

    // Cascade: soft-delete child notes
    const childNotes = sqlite.prepare(`SELECT id FROM notes WHERE deck_id = ? AND user_id = ? AND deleted_at IS NULL`).all(CASCADE_DECK, TEST_USER_ID) as Array<{ id: string }>;
    for (const note of childNotes) {
      sqlite.prepare(`UPDATE cards SET deleted_at = ? WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL`).run(deletedAt, note.id, TEST_USER_ID);
    }
    sqlite.prepare(`UPDATE notes SET deleted_at = ? WHERE deck_id = ? AND user_id = ? AND deleted_at IS NULL`).run(deletedAt, CASCADE_DECK, TEST_USER_ID);

    // All should be soft-deleted now
    const aliveNotes = sqlite.prepare('SELECT count(*) as c FROM notes WHERE deck_id = ? AND deleted_at IS NULL').get(CASCADE_DECK) as { c: number };
    const aliveCards = sqlite.prepare('SELECT count(*) as c FROM cards WHERE deck_id = ? AND deleted_at IS NULL').get(CASCADE_DECK) as { c: number };
    expect(aliveNotes.c).toBe(0);
    expect(aliveCards.c).toBe(0);

    // All should appear in the deletes list for pull
    const deletedNoteIds = sqlite.prepare(`SELECT id FROM notes WHERE deck_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`).all(CASCADE_DECK, '1970-01-01T00:00:00.000Z') as Array<{ id: string }>;
    const deletedCardIds = sqlite.prepare(`SELECT id FROM cards WHERE deck_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`).all(CASCADE_DECK, '1970-01-01T00:00:00.000Z') as Array<{ id: string }>;
    expect(deletedNoteIds.length).toBe(2);
    expect(deletedCardIds.length).toBe(3);

    // Specifically check the IDs
    const noteIds = deletedNoteIds.map(n => n.id);
    const cardIds = deletedCardIds.map(c => c.id);
    expect(noteIds).toContain(CASCADE_NOTE1);
    expect(noteIds).toContain(CASCADE_NOTE2);
    expect(cardIds).toContain(CASCADE_CARD1);
    expect(cardIds).toContain(CASCADE_CARD2);
    expect(cardIds).toContain(CASCADE_CARD3);
  });
});

// ─── Transform: user_id is always forced from auth ─────────────────────────

describe('Security: user_id forced from authenticated user', () => {
  it('toServerRecord overwrites any client-supplied userId', () => {
    const maliciousData = {
      id: 'deck-evil',
      userId: 'attacker-id',
      name: 'Stolen Deck',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = toServerRecord(maliciousData, 'real-auth-user', JSON_COLS['decks']);

    // user_id MUST be the authenticated user, not the client-supplied one
    expect(result['user_id']).toBe('real-auth-user');
  });

  it('toServerRecord works even if client omits userId', () => {
    const data = {
      name: 'New Deck',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = toServerRecord(data, 'auth-user-123', JSON_COLS['decks']);
    expect(result['user_id']).toBe('auth-user-123');
  });
});
