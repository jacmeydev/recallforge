import { describe, it, expect } from 'vitest';
import {
  AIImportItemSchema,
  AIImportFileSchema,
  AIImportOptionsSchema,
  AI_IMPORT_VERSION,
  validateClozeFields,
  validateImportItem,
  AIDuplicateStrategySchema,
} from '@/lib/validation/ai-import-schema';
import {
  detectFormat,
  parseJSON,
  parseJSONL,
  parseCSV,
  parseTSV,
  parseImportFile,
} from '@/lib/utils/file-parse';

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('AIImportItemSchema', () => {
  it('accepts valid item', () => {
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Español',
      fields: { Front: 'Hello', Back: 'Hola' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts item with all optional fields', () => {
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Español',
      fields: { Front: 'Hello', Back: 'Hola' },
      tags: ['idiomas', 'a1'],
      source: 'chatgpt',
      externalId: 'ext-001',
      duplicateKey: 'hello-hola',
      sourceMetadata: { model: 'gpt-4o' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['idiomas', 'a1']);
      expect(result.data.externalId).toBe('ext-001');
    }
  });

  it('rejects missing noteType', () => {
    const result = AIImportItemSchema.safeParse({
      deck: 'Español',
      fields: { Front: 'Hello' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing deck', () => {
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      fields: { Front: 'Hello' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty fields', () => {
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Español',
      fields: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects fields with all whitespace values', () => {
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Español',
      fields: { Front: '   ', Back: '  ' },
    });
    expect(result.success).toBe(false);
  });

  it('defaults tags to empty array', () => {
    const result = AIImportItemSchema.parse({
      noteType: 'Básica',
      deck: 'Español',
      fields: { Front: 'Hello' },
    });
    expect(result.tags).toEqual([]);
  });
});

describe('AIImportFileSchema', () => {
  it('accepts valid envelope', () => {
    const result = AIImportFileSchema.safeParse({
      version: AI_IMPORT_VERSION,
      items: [
        { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong version', () => {
    const result = AIImportFileSchema.safeParse({
      version: 'wrong-version',
      items: [
        { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty items array', () => {
    const result = AIImportFileSchema.safeParse({
      version: AI_IMPORT_VERSION,
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('AIDuplicateStrategySchema', () => {
  it.each(['skip', 'update', 'create_always', 'merge_tags'] as const)(
    'accepts "%s"',
    (strategy) => {
      const result = AIDuplicateStrategySchema.safeParse(strategy);
      expect(result.success).toBe(true);
    }
  );

  it('rejects invalid strategy', () => {
    const result = AIDuplicateStrategySchema.safeParse('overwrite');
    expect(result.success).toBe(false);
  });
});

describe('AIImportOptionsSchema', () => {
  it('applies defaults', () => {
    const result = AIImportOptionsSchema.parse({});
    expect(result.duplicateStrategy).toBe('skip');
    expect(result.batchSize).toBe(25);
    expect(result.dryRun).toBe(false);
  });

  it('rejects batchSize > 500', () => {
    const result = AIImportOptionsSchema.safeParse({ batchSize: 1000 });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Cloze Validation Tests
// ============================================================================

describe('validateClozeFields', () => {
  it('returns null for non-cloze types', () => {
    expect(validateClozeFields('basic', { Front: 'Hello' })).toBeNull();
    expect(validateClozeFields('Básica', { Front: 'Hello' })).toBeNull();
  });

  it('returns null for valid cloze', () => {
    expect(
      validateClozeFields('cloze', { Text: 'La capital de Francia es {{c1::París}}' })
    ).toBeNull();
  });

  it('returns null for Cloze (case-insensitive)', () => {
    expect(
      validateClozeFields('Cloze', { Text: '{{c1::answer}}' })
    ).toBeNull();
  });

  it('returns error for cloze without deletions', () => {
    const error = validateClozeFields('cloze', { Text: 'No cloze here' });
    expect(error).not.toBeNull();
    expect(error).toContain('cloze');
  });
});

describe('validateImportItem', () => {
  it('returns no errors for valid item', () => {
    const { errors } = validateImportItem(
      { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
      0
    );
    expect(errors).toHaveLength(0);
  });

  it('returns validation errors for invalid item', () => {
    const { errors } = validateImportItem({ noteType: '', deck: '', fields: {} }, 0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns cloze error for cloze type without deletions', () => {
    const { errors } = validateImportItem(
      { noteType: 'Cloze', deck: 'Test', fields: { Text: 'No cloze' } },
      5
    );
    expect(errors.some(e => e.includes('cloze'))).toBe(true);
  });
});

// ============================================================================
// Format Detection Tests
// ============================================================================

describe('detectFormat', () => {
  it('detects JSON object', () => {
    expect(detectFormat('{"version": "v1", "items": []}')).toBe('json');
  });

  it('detects JSON array', () => {
    expect(detectFormat('[{"noteType": "Básica"}]')).toBe('json');
  });

  it('detects JSONL', () => {
    expect(detectFormat('{"noteType":"a","deck":"b","fields":{"F":"v"}}\n{"noteType":"c","deck":"d","fields":{"F":"w"}}')).toBe('jsonl');
  });

  it('detects TSV', () => {
    expect(detectFormat('noteType\tdeck\tfield_Front\nBásica\tTest\tHello')).toBe('tsv');
  });

  it('detects CSV', () => {
    expect(detectFormat('noteType,deck,field_Front\nBásica,Test,Hello')).toBe('csv');
  });
});

// ============================================================================
// Parser Tests
// ============================================================================

describe('parseJSON', () => {
  it('parses envelope format', () => {
    const content = JSON.stringify({
      version: AI_IMPORT_VERSION,
      items: [
        { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
        { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q2', Back: 'A2' } },
      ],
    });
    const items = parseJSON(content);
    expect(items).toHaveLength(2);
    expect(items[0].fields.Front).toBe('Q');
  });

  it('parses bare array', () => {
    const content = JSON.stringify([
      { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
    ]);
    const items = parseJSON(content);
    expect(items).toHaveLength(1);
  });

  it('parses single object', () => {
    const content = JSON.stringify({
      noteType: 'Básica',
      deck: 'Test',
      fields: { Front: 'Q', Back: 'A' },
    });
    const items = parseJSON(content);
    expect(items).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJSON('not json')).toThrow();
  });
});

describe('parseJSONL', () => {
  it('parses multiple lines', () => {
    const content = [
      JSON.stringify({ noteType: 'Básica', deck: 'D', fields: { Front: 'A', Back: 'B' } }),
      JSON.stringify({ noteType: 'Básica', deck: 'D', fields: { Front: 'C', Back: 'D' } }),
    ].join('\n');
    const items = parseJSONL(content);
    expect(items).toHaveLength(2);
  });

  it('skips empty lines', () => {
    const content = `${JSON.stringify({ noteType: 'Básica', deck: 'D', fields: { Front: 'A', Back: 'B' } })}\n\n`;
    const items = parseJSONL(content);
    expect(items).toHaveLength(1);
  });

  it('throws on invalid line', () => {
    expect(() => parseJSONL('not json\n{"noteType":"a"}')).toThrow(/Línea 1/);
  });
});

describe('parseCSV', () => {
  it('parses standard CSV', () => {
    const content = 'noteType,deck,field_Front,field_Back,tags\nBásica,Test,Hello,Hola,idiomas;a1';
    const items = parseCSV(content);
    expect(items).toHaveLength(1);
    expect(items[0].noteType).toBe('Básica');
    expect(items[0].deck).toBe('Test');
    expect(items[0].fields.Front).toBe('Hello');
    expect(items[0].fields.Back).toBe('Hola');
    expect(items[0].tags).toEqual(['idiomas', 'a1']);
  });

  it('handles quoted fields with commas', () => {
    const content = 'noteType,deck,field_Front,field_Back\nBásica,Test,"Hello, world","Hola, mundo"';
    const items = parseCSV(content);
    expect(items[0].fields.Front).toBe('Hello, world');
  });

  it('handles escaped quotes', () => {
    const content = 'noteType,deck,field_Front\nBásica,Test,"He said ""hello"""';
    const items = parseCSV(content);
    expect(items[0].fields.Front).toBe('He said "hello"');
  });

  it('handles optional columns', () => {
    const content = 'noteType,deck,field_Front,externalId,source\nBásica,Test,Hello,ext-1,chatgpt';
    const items = parseCSV(content);
    expect(items[0].externalId).toBe('ext-1');
    expect(items[0].source).toBe('chatgpt');
  });

  it('throws on missing noteType header', () => {
    expect(() => parseCSV('deck,field_Front\nTest,Hello')).toThrow(/noteType/);
  });

  it('throws on missing deck header', () => {
    expect(() => parseCSV('noteType,field_Front\nBásica,Hello')).toThrow(/deck/);
  });

  it('throws on missing field columns', () => {
    expect(() => parseCSV('noteType,deck\nBásica,Test')).toThrow(/field_/);
  });

  it('skips empty rows', () => {
    const content = 'noteType,deck,field_Front\nBásica,Test,Hello\n\nBásica,Test,World';
    const items = parseCSV(content);
    expect(items).toHaveLength(2);
  });
});

describe('parseTSV', () => {
  it('parses tab-separated values', () => {
    const content = 'noteType\tdeck\tfield_Front\tfield_Back\nBásica\tTest\tHello\tHola';
    const items = parseTSV(content);
    expect(items).toHaveLength(1);
    expect(items[0].fields.Front).toBe('Hello');
  });
});

// ============================================================================
// Unified Parser Tests
// ============================================================================

describe('parseImportFile', () => {
  it('auto-detects and parses JSON', () => {
    const content = JSON.stringify([
      { noteType: 'Básica', deck: 'Test', fields: { Front: 'Q', Back: 'A' } },
    ]);
    const items = parseImportFile(content);
    expect(items).toHaveLength(1);
  });

  it('auto-detects and parses CSV', () => {
    const content = 'noteType,deck,field_Front\nBásica,Test,Hello';
    const items = parseImportFile(content);
    expect(items).toHaveLength(1);
  });

  it('respects explicit format override', () => {
    const content = 'noteType,deck,field_Front\nBásica,Test,Hello';
    const items = parseImportFile(content, 'csv');
    expect(items).toHaveLength(1);
  });
});
