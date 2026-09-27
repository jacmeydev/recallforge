import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importApkg } from '@/lib/core/anki';
import { syncWithAnki } from '@/lib/core/anki-sync';
import { addCards, getCard, updateCard } from '@/lib/core/cards';
import { createTestUser, useFreshDatabase } from './helpers';

/** In-memory stand-in for AnkiConnect (the actions RecallForge uses). */
function fakeAnki() {
  const models = new Set(['Basic', 'Cloze']);
  const decks = new Set(['Default']);
  const notes = new Map<number, { model: string; deck: string; fields: Record<string, string>; tags: string[] }>();
  const cards = new Map<number, { note: number; ord: number }>();
  const reviews = new Map<number, Array<{ id: number; ease: number; type: number; time: number }>>();
  const media = new Map<string, string>();
  let nextId = 1_700_000_000_000;
  const handlers: Record<string, (p: any) => unknown> = {
    version: () => 6,
    modelNames: () => [...models],
    createModel: (p) => models.add(p.modelName),
    deckNames: () => [...decks],
    createDeck: (p) => decks.add(p.deck),
    storeMediaFile: (p) => media.set(p.filename, p.data),
    addNotes: (p) =>
      p.notes.map((n: any) => {
        if (!models.has(n.modelName) || !decks.has(n.deckName)) return null;
        const id = nextId++;
        notes.set(id, { model: n.modelName, deck: n.deckName, fields: n.fields, tags: n.tags });
        const ords = /Cloze/.test(n.modelName) ? [...new Set([...String(n.fields.Text).matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]) - 1))] : [0];
        for (const ord of ords) cards.set(nextId++, { note: id, ord });
        return id;
      }),
    findCards: (p) => {
      const ids = [...String(p.query).matchAll(/nid:(\d+)/g)].map((m) => Number(m[1]));
      return [...cards].filter(([, c]) => ids.includes(c.note)).map(([id]) => id);
    },
    cardsInfo: (p) => p.cards.map((id: number) => ({ cardId: id, note: cards.get(id)!.note, ord: cards.get(id)!.ord })),
    updateNoteFields: (p) => {
      const note = notes.get(p.note.id);
      if (!note) throw new Error('note was not found');
      Object.assign(note.fields, p.note.fields);
    },
    getReviewsOfCards: (p) => Object.fromEntries(p.cards.map((id: string) => [id, reviews.get(Number(id)) ?? []])),
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { action, params, version } = JSON.parse(body);
      let out: { result: unknown; error: string | null };
      try {
        if (version !== 6) throw new Error('version');
        out = { result: handlers[action](params ?? {}) ?? null, error: null };
      } catch (error) {
        out = { result: null, error: String((error as Error).message) };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });
  return { server, notes, cards, reviews, media, models };
}

let anki: ReturnType<typeof fakeAnki>;
let url: string;

beforeEach(async () => {
  useFreshDatabase();
  anki = fakeAnki();
  await new Promise<void>((resolve) => anki.server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(anki.server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((resolve) => anki.server.close(() => resolve())));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082', 'hex');

describe('sync with Anki (AnkiConnect)', () => {
  it('sends cards, brings back reviews made in Anki, pushes edits and never duplicates', async () => {
    const { user } = await createTestUser();
    const { saveMedia } = await import('@/lib/core/media');
    const image = saveMedia(user.id, { filename: 'fig.png', data: PNG });
    const { created } = addCards(user.id, {
      deck: 'Medicina::Farmacología',
      cards: [
        { front: 'Antídoto de la heparina', back: 'Protamina' },
        { front: 'La {{c1::naloxona}} revierte los {{c2::opioides}}' },
        { front: `¿Qué muestra?\n${image.markdown}`, back: 'Un corte' },
        { occlusion: { image: image.id, regions: [{ label: 'Axilar', left: 0.1, top: 0.1, width: 0.2, height: 0.2 }] } },
      ],
    });

    const first = await syncWithAnki(user.id, { url });
    expect(first).toMatchObject({ notesAdded: 3, mediaStored: 1, skipped: 1 });
    expect(first.warnings.join()).toMatch(/image occlusion note once/);
    expect(anki.models.has('RecallForge Basic') && anki.models.has('RecallForge Cloze')).toBe(true);
    expect([...anki.notes.values()].map((n) => n.deck)).toEqual(Array(3).fill('Medicina::Farmacología'));
    expect([...anki.notes.values()][2].fields.Front).toContain('<img src="rf-');

    // Once Anki has its Image Occlusion note type, occlusion cards go too.
    anki.models.add('Image Occlusion');
    expect(await syncWithAnki(user.id, { url })).toMatchObject({ notesAdded: 1, notesUpdated: 0, reviewsPulled: 0 });

    // Reviews made in Anki (e.g. on the phone) are replayed here.
    const ankiCard = [...anki.cards].find(([, c]) => c.note === [...anki.notes.keys()][0])![0];
    const t = Date.now() - 60_000;
    anki.reviews.set(ankiCard, [{ id: t, ease: 3, type: 0, time: 4000 }]);
    const pulled = await syncWithAnki(user.id, { url });
    expect(pulled.reviewsPulled).toBe(1);
    expect(getCard(user.id, created[0].id)).toMatchObject({ reps: 1, state: 'learning' });
    expect((await syncWithAnki(user.id, { url })).reviewsPulled).toBe(0);

    // Edits made here update the Anki note.
    updateCard(user.id, created[0].id, { back: 'Sulfato de protamina' });
    expect((await syncWithAnki(user.id, { url })).notesUpdated).toBe(1);
    expect([...anki.notes.values()][0].fields.Back).toBe('Sulfato de protamina');
    expect(await syncWithAnki(user.id, { url })).toMatchObject({ notesAdded: 0, notesUpdated: 0, reviewsPulled: 0 });
    expect(anki.notes.size).toBe(4);
  });

  it('does not send back cards that came from Anki', async () => {
    const { user } = await createTestUser();
    await importApkg(user.id, path.join(__dirname, 'data', 'anki-legacy.apkg'));
    const result = await syncWithAnki(user.id, { url });
    expect(result.notesAdded).toBe(0);
    expect(anki.notes.size).toBe(0);
  });

  it('explains how to connect when Anki is closed', async () => {
    const { user } = await createTestUser();
    await expect(syncWithAnki(user.id, { url: 'http://127.0.0.1:9' })).rejects.toThrow(/AnkiConnect add-on/);
  });
});
