import { beforeEach, describe, expect, it } from 'vitest';
import { addCards, approveCards, getCard, searchCards } from '@/lib/core/cards';
import { createDeck, deleteDeck, listDecks, updateDeck } from '@/lib/core/decks';
import {
  deleteDocument,
  getDocument,
  importDocumentFile,
  importDocumentText,
  listDocuments,
  readDocument,
} from '@/lib/core/documents';
import { AppError } from '@/lib/core/errors';
import { extractDocument } from '@/lib/core/extract';
import { checkCardQuality } from '@/lib/core/quality';
import { getStats } from '@/lib/core/stats';
import { nextCard } from '@/lib/core/study';
import { buildDocx, buildPdf, buildPptx } from './fixtures';
import { createTestUser, useFreshDatabase } from './helpers';

const T0 = new Date('2026-03-02T15:00:00.000Z');
const encode = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  useFreshDatabase();
});

describe('text extraction', () => {
  it('reads PDFs page by page', async () => {
    const doc = await extractDocument({ filename: 'Clase 3.pdf', data: buildPdf(['Pagina uno: el corazon', 'Pagina dos: los pulmones']) });
    expect(doc.title).toBe('Clase 3');
    expect(doc.parts).toEqual([
      { label: 'p. 1', text: 'Pagina uno: el corazon' },
      { label: 'p. 2', text: 'Pagina dos: los pulmones' },
    ]);
  });

  it('reads Word documents by heading and PowerPoint by slide with speaker notes', async () => {
    const docx = await extractDocument({
      filename: 'apuntes.docx',
      data: await buildDocx([
        { heading: 'Betalactámicos', paragraphs: ['Inhiben la síntesis de la pared celular.'] },
        { heading: 'Macrólidos', paragraphs: ['Inhiben la subunidad 50S.'] },
      ]),
    });
    expect(docx.parts.map((p) => p.label)).toEqual(['Betalactámicos', 'Macrólidos']);
    expect(docx.parts[1].text).toContain('subunidad 50S');

    const pptx = await extractDocument({
      filename: 'tema4.pptx',
      data: await buildPptx([{ lines: ['Insulina', 'Hormona anabólica'], notes: 'Preguntan mucho esto' }, { lines: ['Glucagón'] }]),
    });
    expect(pptx.parts).toEqual([
      { label: 'diapositiva 1', text: 'Insulina\nHormona anabólica\n\nNotas del orador:\nPreguntan mucho esto' },
      { label: 'diapositiva 2', text: 'Glucagón' },
    ]);
  });

  it('splits markdown by headings, strips HTML, and rejects unsupported or empty files', async () => {
    const md = await extractDocument({ filename: 'notas.md', data: encode('# Riñón\nFiltra la sangre.\n\n## Nefrona\nUnidad funcional.') });
    expect(md.parts.map((p) => p.label)).toEqual(['Riñón', 'Nefrona']);

    const html = await extractDocument({ filename: 'x.html', data: encode('<html><head><style>p{}</style></head><body><p>Hola</p><script>x()</script></body></html>') });
    expect(html.parts[0].text).toBe('Hola');

    await expect(extractDocument({ filename: 'foto.png', data: encode('x') })).rejects.toThrow(/Unsupported/);
    await expect(extractDocument({ filename: 'vacio.txt', data: new Uint8Array() })).rejects.toThrow(/empty/);
    await expect(extractDocument({ filename: 'scan.pdf', data: buildPdf(['']) })).rejects.toThrow(/no selectable text/);
  });

  it('splits oversized parts into labelled pieces', async () => {
    const big = Array.from({ length: 30 }, (_, i) => `Párrafo ${i} ${'x'.repeat(900)}`).join('\n\n');
    const doc = await extractDocument({ filename: 'largo.txt', data: encode(big) });
    expect(doc.parts.length).toBeGreaterThan(1);
    expect(doc.parts.every((p) => p.text.length <= 12_000)).toBe(true);
    expect(doc.parts[0].label).toBe('Sección 1');
  });
});

describe('hierarchical subjects', () => {
  it('creates parent decks, rolls counts up and filters by subtree', async () => {
    const { user } = await createTestUser();
    addCards(user.id, {
      cards: [
        { front: 'Mecanismo de la penicilina', back: 'Inhibe la transpeptidasa', deck: 'Medicina::Farmacología::Antibióticos' },
        { front: 'Antídoto de la heparina', back: 'Protamina', deck: 'Medicina::Farmacología' },
        { front: 'Músculo abductor 15-90°', back: 'Deltoides', deck: 'Medicina::Anatomía' },
      ],
    });

    const decks = listDecks(user.id);
    expect(decks.map((d) => [d.name, d.depth, d.counts.total, d.totals.total])).toEqual([
      ['Medicina', 0, 0, 3],
      ['Medicina::Anatomía', 1, 1, 1],
      ['Medicina::Farmacología', 1, 1, 2],
      ['Medicina::Farmacología::Antibióticos', 2, 1, 1],
    ]);
    const pharma = decks.find((d) => d.name === 'Medicina::Farmacología')!;
    expect(decks.find((d) => d.shortName === 'Antibióticos')?.parentId).toBe(pharma.id);

    expect(nextCard(user.id, { deck: 'medicina::farmacología' }, T0).remaining.new).toBe(2);
    expect(searchCards(user.id, { deck: 'Medicina' }).total).toBe(3);
  });

  it('moves and deletes whole subtrees', async () => {
    const { user } = await createTestUser();
    addCards(user.id, { deck: 'Fisio::Cardio::Arritmias', cards: [{ front: 'Onda P representa', back: 'Despolarización auricular' }] });
    createDeck(user.id, { name: ' Fisio :: Renal ' });

    updateDeck(user.id, 'Fisio', { name: 'Medicina::Fisiología' });
    expect(listDecks(user.id).map((d) => d.name)).toEqual([
      'Medicina',
      'Medicina::Fisiología',
      'Medicina::Fisiología::Cardio',
      'Medicina::Fisiología::Cardio::Arritmias',
      'Medicina::Fisiología::Renal',
    ]);
    expect(() => updateDeck(user.id, 'Medicina', { name: 'Medicina::Otra' })).toThrow(/inside itself/);

    expect(deleteDeck(user.id, 'Medicina::Fisiología')).toMatchObject({ deletedDecks: 4, deletedCards: 1 });
    expect(listDecks(user.id).map((d) => d.name)).toEqual(['Medicina']);
  });
});

describe('documents, drafts and quality', () => {
  it('turns a document into linked draft cards that only enter study after approval', async () => {
    const { user } = await createTestUser();
    const document = await importDocumentFile(
      user.id,
      { filename: 'farmaco.pdf', data: buildPdf(['Penicilina: inhibe la pared', 'Vancomicina: se une a D-Ala-D-Ala']) },
      { deck: 'Medicina::Farmacología' }
    );
    expect(document).toMatchObject({ title: 'farmaco', parts: 2, deck: { name: 'Medicina::Farmacología' } });

    const read = readDocument(user.id, document.id, { fromPart: 0, maxChars: 500 });
    expect(read.parts.map((p) => [p.index, p.label, p.cards])).toEqual([
      [0, 'p. 1', 0],
      [1, 'p. 2', 0],
    ]);
    expect(readDocument(user.id, document.id, { maxChars: 500, fromPart: 1 }).nextPart).toBeNull();

    const result = addCards(user.id, {
      documentId: document.id,
      draft: true,
      cards: [
        { front: '¿Cuál es el mecanismo de acción de la penicilina?', back: 'Inhibe la síntesis de la pared celular', documentPart: 0 },
        { front: '¿A qué se une la vancomicina?', back: 'Al extremo D-Ala-D-Ala', documentPart: 1 },
      ],
    });
    expect(result.status).toBe('draft');
    const card = getCard(user.id, result.created[0].id);
    expect(card).toMatchObject({
      status: 'draft',
      source: 'farmaco, p. 1',
      deck: { name: 'Medicina::Farmacología' },
      document: { id: document.id, title: 'farmaco', part: 0, label: 'p. 1' },
    });

    // Drafts are never studied and are counted separately.
    expect(nextCard(user.id, {}, T0).card).toBeNull();
    expect(getStats(user.id, {}, T0).cards).toMatchObject({ total: 0, drafts: 2 });
    expect(listDecks(user.id).find((d) => d.name === 'Medicina')?.totals).toMatchObject({ total: 0, drafts: 2 });
    expect(searchCards(user.id, { state: 'draft' }).total).toBe(2);
    expect(getDocument(user.id, document.id).outline.map((p) => p.cards)).toEqual([1, 1]);
    expect(listDocuments(user.id)[0].cards).toEqual({ active: 0, drafts: 2, partsCovered: 2 });

    expect(approveCards(user.id, { documentId: document.id })).toEqual({ approved: 2 });
    expect(nextCard(user.id, {}, new Date()).card?.front).toBe('¿Cuál es el mecanismo de acción de la penicilina?');

    expect(deleteDocument(user.id, document.id)).toEqual({ deleted: document.id, deletedCards: 0 });
    expect(getCard(user.id, result.created[0].id).document).toBeNull();
  });

  it('stores text an agent already extracted and validates document parts', async () => {
    const { user } = await createTestUser();
    const document = importDocumentText(user.id, { title: 'Resumen', text: '# Tiroides\nT4 → T3\n\n# Paratiroides\nPTH sube el calcio' });
    expect(getDocument(user.id, document.id).outline.map((p) => p.label)).toEqual(['Tiroides', 'Paratiroides']);
    expect(() => addCards(user.id, { documentId: document.id, cards: [{ front: 'Q', back: 'A' }] })).toThrow(/no deck/);
    expect(() =>
      addCards(user.id, { deck: 'Endocrino', documentId: document.id, cards: [{ front: 'Q', back: 'A', documentPart: 9 }] })
    ).toThrow(/documentPart/);
    expect(() => addCards(user.id, { deck: 'X', documentId: 'nope', cards: [{ front: 'Q', back: 'A' }] })).toThrow(AppError);
  });

  it('flags common flashcard mistakes without blocking the card', async () => {
    expect(checkCardQuality({ front: '¿Es la aorta una arteria elástica?', back: 'Sí' })).toEqual([
      expect.stringMatching(/Yes\/no/),
    ]);
    expect(checkCardQuality({ front: 'La insulina es producida por las células beta', back: 'células beta' })).toEqual([
      expect.stringMatching(/already contains the answer/),
    ]);
    expect(checkCardQuality({ front: 'Nombra los pares craneales motores', back: 'III, IV, VI, XI, XII' })).toEqual([
      expect.stringMatching(/list of 5 items/),
    ]);
    expect(checkCardQuality({ front: '¿Qué nervio inerva el diafragma?', back: 'El nervio frénico (C3-C5)' })).toEqual([]);

    const { user } = await createTestUser();
    const result = addCards(user.id, { deck: 'Anatomía', cards: [{ front: '¿Hay válvulas en la vena cava?', back: 'No' }] });
    expect(result.created).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ index: 0, cardId: result.created[0].id });
  });
});
