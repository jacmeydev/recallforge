import { describe, it, expect } from 'vitest';
import {
  CreateDeckSchema,
  CreateNoteSchema,
  PresetSchema,
  ImportJSONSchema,
  CSVMappingSchema,
} from '@/lib/validation/schemas';

describe('CreateDeckSchema', () => {
  it('accepts valid deck data', () => {
    const result = CreateDeckSchema.safeParse({ name: 'Mi Mazo' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateDeckSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 chars', () => {
    const result = CreateDeckSchema.safeParse({ name: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('defaults optional fields', () => {
    const result = CreateDeckSchema.parse({ name: 'Test' });
    expect(result.description).toBe('');
    expect(result.parentDeckId).toBeNull();
    expect(result.presetId).toBeNull();
  });
});

describe('CreateNoteSchema', () => {
  it('accepts valid note data', () => {
    const result = CreateNoteSchema.safeParse({
      deckId: 'deck-12345678',
      noteTypeId: 'nt-12345678',
      fieldValues: { Front: 'Hello', Back: 'Hola' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty fieldValues', () => {
    const result = CreateNoteSchema.safeParse({
      deckId: 'deck-123',
      noteTypeId: 'nt-123',
      fieldValues: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects all-whitespace fieldValues', () => {
    const result = CreateNoteSchema.safeParse({
      deckId: 'deck-12345678',
      noteTypeId: 'nt-12345678',
      fieldValues: { Front: '   ', Back: '' },
    });
    expect(result.success).toBe(false);
  });

  it('defaults tags to empty array', () => {
    const result = CreateNoteSchema.parse({
      deckId: 'deck-12345678',
      noteTypeId: 'nt-12345678',
      fieldValues: { Front: 'test' },
    });
    expect(result.tags).toEqual([]);
  });
});

describe('PresetSchema', () => {
  const validPreset = {
    name: 'Default',
    desiredRetention: 0.9,
    learningSteps: [1, 10],
    relearningSteps: [10],
    maximumInterval: 36500,
    enableFuzz: true,
    buryNewSiblings: true,
    buryReviewSiblings: true,
    newCardOrder: 'sequential' as const,
    reviewOrder: 'due_date' as const,
    dailyLimits: { newCards: 20, reviews: 200 },
    fsrsParameters: new Array(19).fill(0.5),
  };

  it('accepts valid preset', () => {
    const result = PresetSchema.safeParse(validPreset);
    expect(result.success).toBe(true);
  });

  it('rejects retention below 0.7', () => {
    const result = PresetSchema.safeParse({ ...validPreset, desiredRetention: 0.3 });
    expect(result.success).toBe(false);
  });

  it('rejects retention above 0.99', () => {
    const result = PresetSchema.safeParse({ ...validPreset, desiredRetention: 1.0 });
    expect(result.success).toBe(false);
  });

  it('rejects wrong fsrsParameters length', () => {
    const result = PresetSchema.safeParse({ ...validPreset, fsrsParameters: [1, 2, 3] });
    expect(result.success).toBe(false);
  });
});

describe('ImportJSONSchema', () => {
  it('accepts valid import', () => {
    const result = ImportJSONSchema.safeParse({
      version: 1,
      app: 'RecallForge',
      data: {
        decks: [{ id: 'deck-123' }],
        notes: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty data', () => {
    const result = ImportJSONSchema.safeParse({ data: {} });
    expect(result.success).toBe(true);
  });

  it('rejects entities without id', () => {
    const result = ImportJSONSchema.safeParse({
      data: { decks: [{ name: 'noId' }] },
    });
    expect(result.success).toBe(false);
  });
});

describe('CSVMappingSchema', () => {
  it('accepts valid mapping', () => {
    const result = CSVMappingSchema.safeParse({
      columns: ['Front', 'Back'],
      fieldMapping: { '0': 'Front', '1': 'Back' },
      deckId: 'deck-12345678',
      noteTypeId: 'nt-12345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing deckId', () => {
    const result = CSVMappingSchema.safeParse({
      columns: ['Front'],
      fieldMapping: {},
      noteTypeId: 'nt-123',
    });
    expect(result.success).toBe(false);
  });
});
