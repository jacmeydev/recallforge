import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportApkg, importApkg, ankiHtmlToText, renderAnkiTemplate } from '@/lib/core/anki';
import { addCards, getCard, searchCards, updateCard } from '@/lib/core/cards';
import { clozeAnswer, clozeOrdinals, clozeQuestion, clozeRevealed } from '@/lib/core/cloze';
import { getDb } from '@/lib/core/db';
import { importDocumentFile, readDocument, getDocument } from '@/lib/core/documents';
import { saveMedia } from '@/lib/core/media';
import { imageSize, parseAnkiOcclusion, toAnkiOcclusion } from '@/lib/core/occlusion';
import { gradeCard, nextCard, revealCard } from '@/lib/core/study';
import { renderRichText } from '@/lib/ui/rich-text';
import { createMcpServer } from '@/lib/mcp/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getLocalUser } from '@/lib/core/users';
import { createTestUser, useFreshDatabase } from './helpers';

const DATA = path.join(__dirname, 'data');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082', 'hex');

beforeEach(() => {
  useFreshDatabase();
});

describe('cloze cards', () => {
  it('parses deletions, hints and repeated numbers like Anki', () => {
    const text = 'La {{c1::protamina}} revierte la {{c2::heparina::anticoagulante}}; la {{c1::sulfato}} es la sal';
    expect(clozeOrdinals(text)).toEqual([1, 2]);
    expect(clozeQuestion(text, 1)).toBe('La […] revierte la heparina; la […] es la sal');
    expect(clozeQuestion(text, 2)).toBe('La protamina revierte la [anticoagulante]; la sulfato es la sal');
    expect(clozeAnswer(text, 1)).toBe('protamina … sulfato');
    expect(clozeRevealed(text, 2)).toContain('==heparina==');
  });

  it('creates one card per deletion, keeps siblings in step and buries them for the day', async () => {
    const { user } = await createTestUser();
    const res = addCards(user.id, { deck: 'Farmaco', cards: [{ front: 'La {{c1::naloxona}} revierte los {{c2::opioides}}', back: 'Antagonista μ' }] });
    expect(res.created).toHaveLength(2);
    expect(res.created[0].front).toBe('La […] revierte los opioides');
    const [c1, c2] = res.created.map((c) => getCard(user.id, c.id));
    expect(c1).toMatchObject({ kind: 'cloze', back: 'naloxona', cloze: { ord: 1, extra: 'Antagonista μ' } });
    expect(c2.cloze?.noteId).toBe(c1.cloze?.noteId);

    // Adding the same note again is a duplicate.
    expect(addCards(user.id, { deck: 'Farmaco', cards: [{ front: 'La {{c1::naloxona}} revierte los {{c2::opioides}}' }] }).skipped).toHaveLength(2);

    // Sibling burying: after answering c1, c2 waits until tomorrow.
    const now = new Date('2026-03-02T15:00:00Z');
    expect(nextCard(user.id, {}, now).card?.id).toBe(c1.id);
    gradeCard(user.id, c1.id, { rating: 'easy' }, 'api', now);
    expect(nextCard(user.id, {}, now).card).toBeNull();
    expect(nextCard(user.id, {}, new Date(now.getTime() + 86_400_000)).card?.id).toBe(c2.id);

    // Editing the text updates every sibling, adds a card for a new deletion and suspends a removed one.
    updateCard(user.id, c1.id, { front: 'La {{c1::naloxona}} revierte la {{c3::depresión respiratoria}}' });
    const note = searchCards(user.id, { deck: 'Farmaco', limit: 10 }).cards.filter((c) => c.cloze?.noteId === c1.cloze?.noteId);
    expect(note.map((c) => c.cloze?.ord).sort()).toEqual([1, 2, 3]);
    expect(note.find((c) => c.cloze?.ord === 2)?.suspended).toBe(true);
    expect(note.find((c) => c.cloze?.ord === 3)?.back).toBe('depresión respiratoria');
  });

  it('turns a basic card into a cloze note when cloze syntax is added', async () => {
    const { user } = await createTestUser();
    const [{ id }] = addCards(user.id, { deck: 'X', cards: [{ front: 'Capital de Francia', back: 'París' }] }).created;
    updateCard(user.id, id, { front: 'La capital de Francia es {{c1::París}}' });
    expect(getCard(user.id, id)).toMatchObject({ kind: 'cloze', front: 'La capital de Francia es […]', back: 'París' });
  });
});

describe('images', () => {
  it('stores images once, references them from cards and renders them safely', async () => {
    const { user } = await createTestUser();
    const media = saveMedia(user.id, { filename: 'plexo braquial.png', data: PNG });
    expect(media.markdown).toBe(`![plexo braquial](media:${media.id})`);
    expect(saveMedia(user.id, { filename: 'otra.png', data: PNG }).id).toBe(media.id);
    expect(() => saveMedia(user.id, { filename: 'x.exe', data: Buffer.from('MZ') })).toThrow(/Unsupported/);

    const html = renderRichText(`<script>alert(1)</script> **negrita** ==clave==\n${media.markdown}`, (id) => `/m/${id}`);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>negrita</strong>');
    expect(html).toContain('<mark>clave</mark>');
    expect(html).toContain(`<img src="/m/${media.id}" alt="plexo braquial"`);
  });
});

describe('Anki packages (generated by Anki 26.09)', () => {
  for (const kind of ['modern', 'legacy']) {
    it(`imports the ${kind} format with cloze, images, tags, suspensions, FSRS state and history`, async () => {
      const { user } = await createTestUser();
      const result = await importApkg(user.id, path.join(DATA, `anki-${kind}.apkg`), { deck: 'Medicina' });
      expect(result).toMatchObject({ format: 'anki', cards: 5, reviews: 2, skipped: 0 });
      const { cards } = searchCards(user.id, { limit: 20 });
      const byFront = (text: string) => cards.find((c) => c.front.includes(text))!;
      expect(byFront('Antídoto de la').front).toBe('Antídoto de la **heparina**');
      expect(byFront('Antídoto de la').back).toBe('Protamina (sulfato)');
      expect(byFront('Antídoto de la').deck.name).toBe('Medicina::Medicina AnKing::Farmacología');
      expect(byFront('Antídoto de la').tags).toEqual(['#AK_Step1::Farmaco', 'antidotos']);
      expect(byFront('Antídoto de la').state).not.toBe('new');
      expect(byFront('Antídoto de la').stability).toBeGreaterThan(0);
      expect(byFront('La […] revierte')).toMatchObject({ kind: 'cloze', back: 'naloxona' });
      expect(byFront('[fármacos]').back).toBe('opioides');
      expect(byFront('suspendida').suspended).toBe(true);
      expect(byFront('imagen').front).toMatch(/!\[plexo\]\(media:[\w-]+\)/);

      const again = await importApkg(user.id, path.join(DATA, `anki-${kind}.apkg`), { deck: 'Medicina' });
      expect(again).toMatchObject({ cards: 0, skipped: 5 });
    });
  }

  it('exports a package that imports back with the same cards', async () => {
    const { user } = await createTestUser();
    const media = saveMedia(user.id, { filename: 'eje.png', data: PNG });
    addCards(user.id, {
      deck: 'Cardio',
      cards: [
        { front: `¿Qué muestra el ECG?\n${media.markdown}`, back: 'Fibrilación auricular' },
        { front: 'El {{c1::nodo sinusal}} marca el ritmo a {{c2::60-100}} lpm' },
      ],
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-apkg-')), 'out.apkg');
    fs.writeFileSync(file, await exportApkg(user.id));

    useFreshDatabase();
    const { user: other } = await createTestUser();
    const result = await importApkg(other.id, file);
    expect(result.cards).toBe(3);
    const { cards } = searchCards(other.id, { limit: 10 });
    expect(cards.find((c) => c.kind === 'cloze' && c.cloze?.ord === 2)?.back).toBe('60-100');
    expect(cards.find((c) => c.back === 'Fibrilación auricular')?.front).toMatch(/media:/);
  });

  it('renders Anki templates and HTML', () => {
    const fields = { Front: 'Q', Back: 'A', Extra: '' };
    expect(renderAnkiTemplate('{{Front}}{{#Extra}}<i>{{Extra}}</i>{{/Extra}}{{^Extra}}!{{/Extra}}', fields)).toBe('Q!');
    expect(renderAnkiTemplate('{{FrontSide}}<hr id=answer>{{text:Back}}{{type:Back}}', fields)).toBe('<hr id=answer>A');
    expect(ankiHtmlToText('<div>Uno&nbsp;<b>dos</b></div><ul><li>a</li><li>b</li></ul>[sound:x.mp3]<img src="y.png">', (n) => `IMG(${n})`)).toBe(
      'Uno **dos**\n\n- a\n- b\n\nIMG(y.png)'
    );
  });
});

describe('MCP Apps (study widget in the chat)', () => {
  async function connect() {
    const user = getLocalUser();
    const server = createMcpServer(user);
    const client = new Client({ name: 'host', version: '1' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } as never });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, user };
  }

  it('declares the widget, serves it and drives a full session through app-only tools', async () => {
    const { client, user } = await connect();
    const media = saveMedia(user.id, { filename: 'rx.png', data: PNG });
    addCards(user.id, { deck: 'Radio', cards: [{ front: `¿Qué se ve?\n${media.markdown}`, back: 'Neumotórax' }, { front: 'La {{c1::tráquea}} se desvía' }] });

    const tools = (await client.listTools()).tools;
    const study = tools.find((t) => t.name === 'study')!;
    expect((study._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe('ui://recallforge/study.html');
    expect((tools.find((t) => t.name === 'widget_grade')!._meta as { ui: { visibility: string[] } }).ui.visibility).toEqual(['app']);

    const resource = await client.readResource({ uri: 'ui://recallforge/study.html' });
    expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect((resource.contents[0] as { text: string }).text).toContain('<div id="app"');

    const opened = await client.callTool({ name: 'study', arguments: { deck: 'Radio' } });
    const content = opened.structuredContent as { view: string; next: { card: { id: string } }; images: Record<string, string> };
    expect(content.view).toBe('study');
    expect(Object.values(content.images)[0]).toMatch(/^data:image\/png;base64,/);
    expect((opened.content as Array<{ text: string }>)[0].text).toMatch(/interactive widget/);

    const cardId = content.next.card.id;
    const revealed = await client.callTool({ name: 'widget_reveal', arguments: { card_id: cardId } });
    expect((revealed.structuredContent as { reveal: { card: { back: string } } }).reveal.card.back).toBe('Neumotórax');
    const graded = await client.callTool({ name: 'widget_grade', arguments: { card_id: cardId, rating: 'again', deck: 'Radio' } });
    const next = graded.structuredContent as { result: { rating: string }; next: { card: { front: string } } };
    expect(next.result.rating).toBe('again');
    expect(next.next.card.front).toBe('La […] se desvía');
    const corrected = await client.callTool({ name: 'widget_correct', arguments: { card_id: cardId, rating: 'good' } });
    expect((corrected.structuredContent as { result: { correctedFrom: string } }).result.correctedFrom).toBe('again');

    const progress = await client.callTool({ name: 'show_progress', arguments: {} });
    expect((progress.structuredContent as { view: string }).view).toBe('progress');
  });

  it('lets agents create cloze cards without a back', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'add_cards', arguments: { deck: 'Cardio', cards: [{ front: 'El {{c1::nodo sinusal}} marca el {{c2::ritmo}}' }] } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).created).toHaveLength(2);
  });

  it('sends card images to agents that can see them', async () => {
    const { client, user } = await connect();
    const media = saveMedia(user.id, { filename: 'ecg.png', data: PNG });
    const [{ id }] = addCards(user.id, { deck: 'ECG', cards: [{ front: `Ritmo:\n${media.markdown}`, back: 'Sinusal' }] }).created;
    const next = await client.callTool({ name: 'get_next_card', arguments: {} });
    const blocks = next.content as Array<{ type: string; mimeType?: string }>;
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image']);
    expect(blocks[1].mimeType).toBe('image/png');
    expect(revealCard(user.id, id).card.front).toContain('media:');
  });
});

describe('image occlusion', () => {
  it('reads and writes Anki occlusion fields, including escapes and old pixel coordinates', () => {
    const field =
      '{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}<br>{{c2::image-occlusion:polygon:points=.6,.1 .9,.1 .75,.4:oi=1}}<br>{{c3::image-occlusion:text:text=C5\\:T1:left=.05:top=.9}}';
    const parsed = parseAnkiOcclusion(field);
    expect(parsed.hideAll).toBe(true);
    expect(parsed.shapes).toEqual([
      { ord: 1, shape: 'rect', left: 0.1, top: 0.2, width: 0.3, height: 0.1 },
      { ord: 2, shape: 'polygon', points: [[0.6, 0.1], [0.9, 0.1], [0.75, 0.4]] },
      { ord: 0, shape: 'text', left: 0.05, top: 0.9, label: 'C5:T1' },
    ]);
    expect(parseAnkiOcclusion(toAnkiOcclusion({ ...parsed }))).toEqual(parsed);
    const pixels = parseAnkiOcclusion('{{c1::image-occlusion:rect:left=30:top=40:width=60:height=20}}', { width: 300, height: 200 });
    expect(pixels.shapes[0]).toMatchObject({ left: 0.1, top: 0.2, width: 0.2, height: 0.1 });
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
  });

  it('creates one card per region (or group), hides the answer in the question and validates the image', async () => {
    const { user } = await createTestUser();
    const media = saveMedia(user.id, { filename: 'plexo.png', data: PNG });
    const res = addCards(user.id, {
      deck: 'Anatomía',
      cards: [
        {
          front: 'Plexo braquial',
          occlusion: {
            image: media.markdown,
            regions: [
              { label: 'Nervio axilar', left: 0.1, top: 0.1, width: 0.2, height: 0.1 },
              { label: 'Nervio radial', left: 0.5, top: 0.5, width: 0.2, height: 0.1, group: 2 },
              { label: 'Nervio radial', left: 0.5, top: 0.7, width: 0.2, height: 0.1, group: 2 },
            ],
          },
        },
      ],
    });
    expect(res.created).toHaveLength(2);
    const card = getCard(user.id, res.created[0].id);
    expect(card).toMatchObject({ kind: 'occlusion', back: 'Nervio axilar', front: 'Plexo braquial\n¿Qué hay bajo la región marcada (1)?' });
    const question = nextCard(user.id, { deck: 'Anatomía' }).card!;
    expect(question.occlusion?.shapes.find((s) => s.ord === question.occlusion?.ord)?.label).toBeUndefined();
    expect(question.occlusion?.shapes.some((s) => s.label === 'Nervio radial')).toBe(true);
    expect(getCard(user.id, res.created[1].id).back).toBe('Nervio radial');
    expect(() => addCards(user.id, { deck: 'X', cards: [{ occlusion: { image: 'media:nope', regions: [{ left: 0, top: 0, width: 0.1, height: 0.1 }] } }] })).toThrow(/not found/);
    expect(() => addCards(user.id, { deck: 'X', cards: [{ occlusion: { image: media.id, regions: [{ left: 0 }] } }] })).toThrow(/needs left, top/);
  });

  it('imports Anki image occlusion notes and exports them back as Anki image occlusion', async () => {
    const { user } = await createTestUser();
    const imported = await importApkg(user.id, path.join(DATA, 'anki-occlusion.apkg'));
    expect(imported).toMatchObject({ cards: 3, warnings: [] });
    const { cards } = searchCards(user.id, { limit: 10 });
    expect(cards.every((c) => c.kind === 'occlusion' && c.occlusion?.hideAll)).toBe(true);
    expect(cards.map((c) => c.occlusion?.ord).sort()).toEqual([1, 2, 3]);
    expect(cards[0].occlusion?.shapes.map((s) => s.shape).sort()).toEqual(['ellipse', 'polygon', 'rect', 'rect']);
    expect(cards[0].explanation).toBe('');
    expect(cards.find((c) => c.occlusion?.ord === 1)?.back).toBe('Raíces C5-T1');

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-io-')), 'io.apkg');
    fs.writeFileSync(file, await exportApkg(user.id));
    useFreshDatabase();
    const { user: other } = await createTestUser();
    expect((await importApkg(other.id, file)).cards).toBe(3);
    expect(searchCards(other.id, { limit: 10 }).cards.every((c) => c.kind === 'occlusion')).toBe(true);
  });
});

describe('figures in documents', () => {
  for (const [file, label] of [
    ['figs.pdf', 'p. 1'],
    ['figs.pptx', 'diapositiva 1'],
    ['figs.docx', 'Histologia'],
  ]) {
    it(`extracts the figures of ${file} into the right part and skips icons`, async () => {
      const { user } = await createTestUser();
      const doc = await importDocumentFile(user.id, { filename: file, data: fs.readFileSync(path.join(DATA, file)) });
      const { parts } = readDocument(user.id, doc.id);
      const withFigure = parts.find((p) => p.label === label)!;
      expect(withFigure.images).toHaveLength(1);
      expect(withFigure.images![0]).toMatchObject({ width: 400, height: 300 });
      expect(withFigure.images![0].markdown).toMatch(/^!\[.*\]\(media:[\w-]+\)$/);
      expect(parts.filter((p) => p.label !== label).every((p) => (p.images ?? []).length === 0)).toBe(true);
      expect(getDocument(user.id, doc.id).outline.find((p) => p.label === label)?.images).toHaveLength(1);

      // A figure can become an image occlusion card linked to its page.
      const res = addCards(user.id, {
        deck: 'Histología',
        documentId: doc.id,
        cards: [{ documentPart: withFigure.index, occlusion: { image: withFigure.images![0].markdown, regions: [{ label: 'Núcleo', left: 0.4, top: 0.4, width: 0.2, height: 0.2 }] } }],
      });
      expect(getCard(user.id, res.created[0].id)).toMatchObject({ kind: 'occlusion', back: 'Núcleo', document: { id: doc.id, part: withFigure.index } });
    });
  }

  it('lets agents look at a figure', async () => {
    const user = getLocalUser();
    const server = createMcpServer(user);
    const client = new Client({ name: 'host', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const doc = await importDocumentFile(user.id, { filename: 'figs.pdf', data: fs.readFileSync(path.join(DATA, 'figs.pdf')) });
    const figure = readDocument(user.id, doc.id).parts[0].images![0];
    const res = await client.callTool({ name: 'get_image', arguments: { image: figure.markdown } });
    const blocks = res.content as Array<{ type: string; text?: string; mimeType?: string }>;
    expect(JSON.parse(blocks[0].text!)).toMatchObject({ width: 400, height: 300 });
    expect(blocks[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });
});
