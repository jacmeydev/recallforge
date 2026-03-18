import { describe, it, expect } from 'vitest';
import { processIOFront, processIOBack } from '@/lib/utils';

// ─── serializeMasks / deserializeMasks ───────────────────────────────────────

// Import helpers directly (they are plain functions)
function serializeMasks(masks: { id: string; x: number; y: number; width: number; height: number }[]) {
  return JSON.stringify(masks.map(({ id, ...rest }) => rest));
}

function deserializeMasks(json: string) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: { x: number; y: number; width: number; height: number }, i: number) => ({
      id: `mask-loaded-${i}`,
      x: r.x ?? 0,
      y: r.y ?? 0,
      width: r.width ?? 0.1,
      height: r.height ?? 0.1,
    }));
  } catch {
    return [];
  }
}

describe('serializeMasks', () => {
  it('serializes masks without id field', () => {
    const masks = [
      { id: 'a', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      { id: 'b', x: 0.5, y: 0.6, width: 0.15, height: 0.25 },
    ];
    const json = serializeMasks(masks);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    expect(parsed[1]).toEqual({ x: 0.5, y: 0.6, width: 0.15, height: 0.25 });
    // Ensure id is stripped
    expect(parsed[0].id).toBeUndefined();
  });

  it('serializes empty array', () => {
    expect(serializeMasks([])).toBe('[]');
  });
});

describe('deserializeMasks', () => {
  it('deserializes valid JSON into IORect array', () => {
    const json = '[{"x":0.1,"y":0.2,"width":0.3,"height":0.4}]';
    const result = deserializeMasks(json);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(0.1);
    expect(result[0].y).toBe(0.2);
    expect(result[0].width).toBe(0.3);
    expect(result[0].height).toBe(0.4);
    expect(result[0].id).toBe('mask-loaded-0');
  });

  it('returns empty array for invalid JSON', () => {
    expect(deserializeMasks('not json')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(deserializeMasks('{"x":1}')).toEqual([]);
  });

  it('applies defaults for missing properties', () => {
    const json = '[{}]';
    const result = deserializeMasks(json);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(0.1);
    expect(result[0].height).toBe(0.1);
  });

  it('roundtrips correctly', () => {
    const masks = [
      { id: 'x', x: 0.25, y: 0.35, width: 0.2, height: 0.15 },
    ];
    const json = serializeMasks(masks);
    const restored = deserializeMasks(json);
    expect(restored[0].x).toBe(0.25);
    expect(restored[0].y).toBe(0.35);
    expect(restored[0].width).toBe(0.2);
    expect(restored[0].height).toBe(0.15);
  });
});

// ─── processIOFront ─────────────────────────────────────────────────────────

describe('processIOFront', () => {
  const masksJson = JSON.stringify([
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    { x: 0.5, y: 0.6, width: 0.15, height: 0.25 },
  ]);

  it('returns html with SVG overlay', () => {
    const html = processIOFront('data:image/png;base64,AAA', masksJson, 0);
    expect(html).toContain('io-container');
    expect(html).toContain('<img');
    expect(html).toContain('<svg');
    expect(html).toContain('<rect');
  });

  it('highlights the active mask in blue', () => {
    const html = processIOFront('img.png', masksJson, 0);
    // Active mask uses blue fill
    expect(html).toContain('rgba(33,150,243,0.85)');
    // Non-active uses orange
    expect(html).toContain('rgba(255,87,34,0.65)');
  });

  it('handles empty masks JSON', () => {
    const html = processIOFront('img.png', '[]', 0);
    // Falls back to just the image src
    expect(html).toBe('img.png');
  });

  it('handles invalid JSON', () => {
    const html = processIOFront('img.png', 'broken', 0);
    expect(html).toBe('img.png');
  });

  it('uses percentage-based coordinates', () => {
    const html = processIOFront('img.png', masksJson, 0);
    expect(html).toContain('10.00%'); // x: 0.1 → 10%
    expect(html).toContain('20.00%'); // y: 0.2 → 20%
    expect(html).toContain('30.00%'); // width: 0.3 → 30%
    expect(html).toContain('40.00%'); // height: 0.4 → 40%
  });
});

// ─── processIOBack ──────────────────────────────────────────────────────────

describe('processIOBack', () => {
  const masksJson = JSON.stringify([
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    { x: 0.5, y: 0.6, width: 0.15, height: 0.25 },
  ]);

  it('reveals active mask with dashed green border', () => {
    const html = processIOBack('img.png', masksJson, 0);
    expect(html).toContain('#4CAF50'); // green stroke
    expect(html).toContain('stroke-dasharray');
    expect(html).toContain('fill="none"');
  });

  it('keeps non-active masks hidden', () => {
    const html = processIOBack('img.png', masksJson, 0);
    // The second mask should still be opaque orange
    expect(html).toContain('rgba(255,87,34,0.65)');
  });

  it('handles second mask as active', () => {
    const html = processIOBack('img.png', masksJson, 1);
    // Should have green stroke for mask at index 1
    expect(html).toContain('#4CAF50');
  });

  it('handles empty masks JSON', () => {
    const html = processIOBack('img.png', '[]', 0);
    expect(html).toBe('img.png');
  });
});

// ─── IO card generation (real service calls) ───────────────────────────────

import { generateCardsFromNote } from '@/lib/services/note-service';
import type { Note, NoteType } from '@/types';

function makeIONoteType(overrides?: Partial<NoteType>): NoteType {
  return {
    id: 'nt-io-1',
    userId: 'u1',
    name: 'Image Occlusion',
    description: '',
    kind: 'image_occlusion',
    css: '',
    version: 1,
    fields: [],
    templates: [
      {
        id: 'tpl-io-1',
        noteTypeId: 'nt-io-1',
        name: 'IO Card',
        frontTemplate: '{{Image}}',
        backTemplate: '{{Image}}',
        ordinal: 0,
        active: true,
        generationRules: {},
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as NoteType;
}

function makeIONote(maskCount: number, overrides?: Partial<Note>): Note {
  const masks = Array.from({ length: maskCount }, (_, i) => ({
    x: i * 0.1,
    y: i * 0.1,
    width: 0.2,
    height: 0.2,
  }));
  return {
    id: 'note-io-1',
    userId: 'u1',
    deckId: 'deck-1',
    noteTypeId: 'nt-io-1',
    fieldValues: {
      Image: 'data:image/png;base64,AAAA',
      Masks: JSON.stringify(masks),
      Header: '',
      Extra: '',
    },
    tags: [],
    hash: 'abc',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    suspended: false,
    ...overrides,
  } as Note;
}

describe('IO card generation (generateCardsFromNote)', () => {
  const noteType = makeIONoteType();

  it('creates 1 card for 1 mask', () => {
    const note = makeIONote(1);
    const cards = generateCardsFromNote('u1', note, noteType);
    expect(cards).toHaveLength(1);
    expect((cards[0].customData as Record<string, number>).maskIndex).toBe(0);
  });

  it('creates 3 cards for 3 masks', () => {
    const note = makeIONote(3);
    const cards = generateCardsFromNote('u1', note, noteType);
    expect(cards).toHaveLength(3);
    cards.forEach((c, i) => {
      expect((c.customData as Record<string, number>).maskIndex).toBe(i);
    });
  });

  it('creates 5 cards for 5 masks with sequential maskIndex', () => {
    const note = makeIONote(5);
    const cards = generateCardsFromNote('u1', note, noteType);
    expect(cards).toHaveLength(5);
    expect(cards.map(c => (c.customData as Record<string, number>).maskIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('defaults to 1 card when Masks field is empty', () => {
    const note = makeIONote(0);
    note.fieldValues['Masks'] = '';
    const cards = generateCardsFromNote('u1', note, noteType);
    expect(cards).toHaveLength(1);
  });

  it('defaults to 1 card when Masks is invalid JSON', () => {
    const note = makeIONote(0);
    note.fieldValues['Masks'] = 'broken';
    const cards = generateCardsFromNote('u1', note, noteType);
    expect(cards).toHaveLength(1);
  });

  it('returns 0 cards if noteType has no templates', () => {
    const emptyNT = makeIONoteType({ templates: [] });
    const note = makeIONote(3);
    const cards = generateCardsFromNote('u1', note, emptyNT);
    expect(cards).toHaveLength(0);
  });

  it('sets correct noteId, deckId, templateId on generated cards', () => {
    const note = makeIONote(2);
    const cards = generateCardsFromNote('u1', note, noteType);
    for (const card of cards) {
      expect(card.noteId).toBe('note-io-1');
      expect(card.deckId).toBe('deck-1');
      expect(card.templateId).toBe('tpl-io-1');
      expect(card.userId).toBe('u1');
      expect(card.state).toBe('new');
      expect(card.suspended).toBe(false);
    }
  });

  it('each card has a unique id', () => {
    const note = makeIONote(4);
    const cards = generateCardsFromNote('u1', note, noteType);
    const ids = new Set(cards.map(c => c.id));
    expect(ids.size).toBe(4);
  });
});

// ─── Escaping ───────────────────────────────────────────────────────────────

describe('IO HTML escaping', () => {
  it('escapes special chars in image src', () => {
    const masksJson = JSON.stringify([{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }]);
    const html = processIOFront('img"<>test&.png', masksJson, 0);
    // Should not contain raw & < > " in img src
    expect(html).not.toContain('src="img"');
    expect(html).toContain('&amp;');
  });
});
