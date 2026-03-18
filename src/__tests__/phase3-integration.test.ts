// ============================================================================
// RecallForge — Phase 3 Integration Tests
// ============================================================================
// Tests for sync data transformation, online status detection, and sync queue
// management. Does NOT test actual HTTP endpoints (requires running server).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  camelToSnake,
  snakeToCamel,
  toServerRecord,
  toClientRecord,
  JSON_COLS,
  SQLITE_TABLE,
} from '@/lib/sync/transform';

// ─── camelToSnake ──────────────────────────────────────────────────────────

describe('camelToSnake', () => {
  it('converts simple camelCase', () => {
    expect(camelToSnake('userId')).toBe('user_id');
    expect(camelToSnake('createdAt')).toBe('created_at');
    expect(camelToSnake('updatedAt')).toBe('updated_at');
  });

  it('handles multiple uppercase letters', () => {
    expect(camelToSnake('fieldValues')).toBe('field_values');
    expect(camelToSnake('sourceMetadata')).toBe('source_metadata');
    expect(camelToSnake('subjectsAdvanced')).toBe('subjects_advanced');
  });

  it('leaves already snake_case unchanged', () => {
    expect(camelToSnake('id')).toBe('id');
    expect(camelToSnake('name')).toBe('name');
    expect(camelToSnake('email')).toBe('email');
  });

  it('converts multi-hump camelCase', () => {
    expect(camelToSnake('customCardData')).toBe('custom_card_data');
  });
});

// ─── snakeToCamel ──────────────────────────────────────────────────────────

describe('snakeToCamel', () => {
  it('converts simple snake_case', () => {
    expect(snakeToCamel('user_id')).toBe('userId');
    expect(snakeToCamel('created_at')).toBe('createdAt');
    expect(snakeToCamel('updated_at')).toBe('updatedAt');
  });

  it('handles multi-segment snake_case', () => {
    expect(snakeToCamel('field_values')).toBe('fieldValues');
    expect(snakeToCamel('source_metadata')).toBe('sourceMetadata');
    expect(snakeToCamel('custom_card_data')).toBe('customCardData');
  });

  it('leaves already camelCase unchanged', () => {
    expect(snakeToCamel('id')).toBe('id');
    expect(snakeToCamel('name')).toBe('name');
  });

  it('round-trips with camelToSnake', () => {
    const terms = ['userId', 'createdAt', 'fieldValues', 'sourceMetadata'];
    for (const t of terms) {
      expect(snakeToCamel(camelToSnake(t))).toBe(t);
    }
  });
});

// ─── toServerRecord ────────────────────────────────────────────────────────

describe('toServerRecord', () => {
  it('converts camelCase keys to snake_case', () => {
    const input = { deckId: 'deck-1', frontText: 'hello', createdAt: '2024-01-01' };
    const result = toServerRecord(input, 'user-1', []);
    expect(result).toHaveProperty('deck_id', 'deck-1');
    expect(result).toHaveProperty('front_text', 'hello');
    expect(result).toHaveProperty('created_at', '2024-01-01');
  });

  it('adds user_id from parameter', () => {
    const result = toServerRecord({ name: 'Test' }, 'user-42', []);
    expect(result['user_id']).toBe('user-42');
  });

  it('JSON-stringifies specified columns', () => {
    const input = {
      id: 'note-1',
      fieldValues: { front: 'hello', back: 'world' },
      tags: ['tag1', 'tag2'],
    };
    const result = toServerRecord(input, 'user-1', ['fieldValues', 'tags']);
    expect(typeof result['field_values']).toBe('string');
    expect(JSON.parse(result['field_values'] as string)).toEqual({ front: 'hello', back: 'world' });
    expect(typeof result['tags']).toBe('string');
    expect(JSON.parse(result['tags'] as string)).toEqual(['tag1', 'tag2']);
  });

  it('does not stringify non-JSON columns', () => {
    const input = { name: 'Test Deck', description: 'A deck' };
    const result = toServerRecord(input, 'user-1', []);
    expect(result['name']).toBe('Test Deck');
    expect(result['description']).toBe('A deck');
  });

  it('handles null values gracefully', () => {
    const input = { name: null, metadata: null };
    const result = toServerRecord(input, 'user-1', ['metadata']);
    expect(result['name']).toBeNull();
    // null is not an object, so it should not be stringified
    expect(result['metadata']).toBeNull();
  });
});

// ─── toClientRecord ────────────────────────────────────────────────────────

describe('toClientRecord', () => {
  it('converts snake_case keys to camelCase', () => {
    const input = { deck_id: 'deck-1', front_text: 'hello', created_at: '2024-01-01' };
    const result = toClientRecord(input, []);
    expect(result).toHaveProperty('deckId', 'deck-1');
    expect(result).toHaveProperty('frontText', 'hello');
    expect(result).toHaveProperty('createdAt', '2024-01-01');
  });

  it('JSON-parses specified columns', () => {
    const input = {
      id: 'note-1',
      field_values: '{"front":"hello","back":"world"}',
      tags: '["tag1","tag2"]',
    };
    const result = toClientRecord(input, ['fieldValues', 'tags']);
    expect(result['fieldValues']).toEqual({ front: 'hello', back: 'world' });
    expect(result['tags']).toEqual(['tag1', 'tag2']);
  });

  it('strips deleted_at column', () => {
    const input = { id: 'card-1', name: 'Test', deleted_at: '2024-06-01' };
    const result = toClientRecord(input, []);
    expect(result).not.toHaveProperty('deletedAt');
    expect(result).not.toHaveProperty('deleted_at');
  });

  it('handles invalid JSON gracefully', () => {
    const input = { field_values: 'not-valid-json' };
    const result = toClientRecord(input, ['fieldValues']);
    // Should fall back to raw string value
    expect(result['fieldValues']).toBe('not-valid-json');
  });
});

// ─── Round-trip: toServerRecord → toClientRecord ──────────────────────────

describe('server ↔ client round-trip', () => {
  it('preserves data through server → client conversion', () => {
    const original = {
      id: 'deck-1',
      name: 'Test Deck',
      description: 'A test',
      metadata: { color: 'blue', icon: '📚' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const serverRecord = toServerRecord(original, 'user-1', ['metadata']);
    // Simulate what the server stores (snake_case + JSON strings)
    expect(serverRecord['metadata']).toBe('{"color":"blue","icon":"📚"}');

    const clientRecord = toClientRecord(serverRecord, ['metadata']);
    // Should get back the original structure (minus user_id which was added)
    expect(clientRecord['id']).toBe('deck-1');
    expect(clientRecord['name']).toBe('Test Deck');
    expect(clientRecord['metadata']).toEqual({ color: 'blue', icon: '📚' });
  });

  it('handles notes with fieldValues round-trip', () => {
    const noteJsonCols = JSON_COLS['notes'];
    const original = {
      id: 'note-1',
      noteTypeId: 'nt-1',
      deckId: 'deck-1',
      fieldValues: { front: '¿Qué es FSRS?', back: 'Free Spaced Repetition Scheduler' },
      tags: ['algorithm', 'srs'],
      sourceMetadata: { origin: 'ai-import', model: 'gpt-4' },
    };

    const serverRecord = toServerRecord(original, 'user-1', noteJsonCols);
    const clientRecord = toClientRecord(serverRecord, noteJsonCols);

    expect(clientRecord['fieldValues']).toEqual(original.fieldValues);
    expect(clientRecord['tags']).toEqual(original.tags);
    expect(clientRecord['sourceMetadata']).toEqual(original.sourceMetadata);
  });
});

// ─── TABLE & JSON_COLS mappings ────────────────────────────────────────────

describe('SQLITE_TABLE mapping', () => {
  it('maps all expected client table names', () => {
    const expected = [
      'decks', 'noteTypes', 'notes', 'cards', 'reviewLogs',
      'activityEvents', 'dailySummaries', 'personalSummaries',
      'curriculumPrograms', 'curriculumSubjects', 'curriculumLinks',
      'userGamification',
    ];
    for (const table of expected) {
      expect(SQLITE_TABLE[table]).toBeDefined();
      expect(typeof SQLITE_TABLE[table]).toBe('string');
    }
  });

  it('uses snake_case for SQLite table names', () => {
    expect(SQLITE_TABLE['noteTypes']).toBe('note_types');
    expect(SQLITE_TABLE['reviewLogs']).toBe('review_logs');
    expect(SQLITE_TABLE['activityEvents']).toBe('activity_events');
    expect(SQLITE_TABLE['dailySummaries']).toBe('daily_summaries');
    expect(SQLITE_TABLE['curriculumPrograms']).toBe('curriculum_programs');
    expect(SQLITE_TABLE['userGamification']).toBe('user_gamification');
  });
});

describe('JSON_COLS mapping', () => {
  it('maps all sync tables', () => {
    for (const tableName of Object.keys(SQLITE_TABLE)) {
      expect(JSON_COLS[tableName]).toBeDefined();
      expect(Array.isArray(JSON_COLS[tableName])).toBe(true);
    }
  });

  it('defines correct JSON columns for notes', () => {
    expect(JSON_COLS['notes']).toContain('fieldValues');
    expect(JSON_COLS['notes']).toContain('tags');
    expect(JSON_COLS['notes']).toContain('sourceMetadata');
  });

  it('defines correct JSON columns for decks', () => {
    expect(JSON_COLS['decks']).toContain('metadata');
  });

  it('defines correct JSON columns for noteTypes', () => {
    expect(JSON_COLS['noteTypes']).toContain('fields');
    expect(JSON_COLS['noteTypes']).toContain('templates');
  });

  it('defines correct JSON columns for activityEvents', () => {
    expect(JSON_COLS['activityEvents']).toContain('payload');
  });

  it('includes schedulerContext JSON for reviewLogs replay data', () => {
    expect(JSON_COLS['reviewLogs']).toEqual(['schedulerContext']);
  });
});

// ─── Sync online status ────────────────────────────────────────────────────

describe('getOnlineStatus', () => {
  it('returns boolean', async () => {
    const { getOnlineStatus } = await import('@/lib/sync');
    const status = getOnlineStatus();
    expect(typeof status).toBe('boolean');
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('toServerRecord with empty data object', () => {
    const result = toServerRecord({}, 'user-1', []);
    expect(result['user_id']).toBe('user-1');
    expect(Object.keys(result).length).toBe(1); // only user_id
  });

  it('toClientRecord with empty data object', () => {
    const result = toClientRecord({}, []);
    expect(Object.keys(result).length).toBe(0);
  });

  it('toServerRecord handles undefined values', () => {
    const input = { name: 'test', deletedAt: undefined };
    const result = toServerRecord(input, 'user-1', []);
    expect(result['name']).toBe('test');
    expect(result['deleted_at']).toBeUndefined();
  });

  it('handles deeply nested JSON objects', () => {
    const complex = {
      id: 'deck-1',
      metadata: {
        nested: { deep: { value: [1, 2, 3] } },
        array: [{ key: 'val' }],
      },
    };
    const serverRecord = toServerRecord(complex, 'user-1', ['metadata']);
    const clientRecord = toClientRecord(serverRecord, ['metadata']);
    expect(clientRecord['metadata']).toEqual(complex.metadata);
  });

  it('SQLITE_TABLE has no entries for non-synced tables', () => {
    expect(SQLITE_TABLE['syncQueue']).toBeUndefined();
    expect(SQLITE_TABLE['backups']).toBeUndefined();
    expect(SQLITE_TABLE['users']).toBeUndefined();
  });
});
