import { beforeEach, describe, expect, it } from 'vitest';
import * as explainRoute from '@/app/api/v1/cards/[id]/explain/route';
import * as revisionsRoute from '@/app/api/v1/cards/[id]/revisions/route';
import * as cardRoute from '@/app/api/v1/cards/[id]/route';
import * as exportRoute from '@/app/api/v1/export/route';
import * as importRoute from '@/app/api/v1/import/route';
import * as revertRoute from '@/app/api/v1/revisions/[id]/revert/route';
import * as correctRoute from '@/app/api/v1/study/correct/route';
import * as gradeRoute from '@/app/api/v1/study/grade/route';
import * as nextRoute from '@/app/api/v1/study/next/route';
import { addCards, getCard, listRevisions, revertRevision, updateCard } from '@/lib/core/cards';
import { getDb } from '@/lib/core/db';
import { importDocumentText } from '@/lib/core/documents';
import { explainCard } from '@/lib/core/explain';
import { exportCardsTsv, exportUserData } from '@/lib/core/export';
import { importData, parseDelimited } from '@/lib/core/import';
import { updateDeck } from '@/lib/core/decks';
import { getProgressMap } from '@/lib/core/progress';
import { getStats } from '@/lib/core/stats';
import { correctLastReview, gradeCard, nextCard } from '@/lib/core/study';
import { getLocalUser } from '@/lib/core/users';
import { createTestUser, DAY, useFreshDatabase } from './helpers';

const T0 = new Date('2026-03-02T15:00:00.000Z');

beforeEach(() => {
  useFreshDatabase();
  delete process.env.RECALLFORGE_TOKEN;
});

const PHARMA = [
  { front: 'Antídoto de la heparina', back: 'Protamina' },
  { front: 'Antídoto de los opioides', back: 'Naloxona' },
  { front: 'Antídoto del paracetamol', back: 'N-acetilcisteína' },
  { front: 'Antídoto de las benzodiacepinas', back: 'Flumazenil' },
  { front: 'Antídoto de la warfarina', back: 'Vitamina K' },
];

async function pharmacology() {
  const { user } = await createTestUser();
  const { created } = addCards(user.id, { deck: 'Medicina::Farmacología', cards: PHARMA });
  return { userId: user.id, ids: created.map((card) => card.id) };
}

function request(path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const hasBody = init.body !== undefined || init.raw !== undefined;
  return new Request(`http://localhost:3030${path}`, {
    method: init.method ?? (hasBody ? 'POST' : 'GET'),
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
async function call(handler: Handler, path: string, init: Parameters<typeof request>[1] & { params?: Record<string, string> } = {}) {
  const res = await handler(request(path, init), { params: Promise.resolve(init.params ?? {}) as Promise<never> });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // TSV and other text bodies
  }
  return { status: res.status, headers: res.headers, body: body as Record<string, any> };
}

describe('sources and "explain this"', () => {
  it('verifies excerpts against the document page and returns the context around them', async () => {
    const { user } = await createTestUser();
    const doc = importDocumentText(user.id, {
      title: 'Farmacología clínica',
      deck: 'Medicina::Farmacología',
      text: '# Anticoagulantes\n\nLa heparina se neutraliza con sulfato de protamina, que forma un complejo estable.\n\n# Opioides\n\nLa naloxona revierte la depresión respiratoria.',
    });
    const result = addCards(user.id, {
      documentId: doc.id,
      draft: true,
      cards: [
        { front: '¿Qué neutraliza la heparina?', back: 'Protamina', excerpt: 'La heparina se neutraliza con sulfato de protamina', documentPart: 0 },
        { front: '¿Qué revierte la naloxona?', back: 'La depresión respiratoria por opioides', excerpt: 'texto inventado que no está', documentPart: 1 },
        { front: '¿Qué antagoniza la naloxona?', back: 'Los receptores opioides μ', documentPart: 1 },
      ],
    });
    expect(result.warnings.find((w) => w.index === 0)).toBeUndefined();
    expect(result.warnings.find((w) => w.index === 1)?.issues.join()).toMatch(/excerpt was not found/);
    expect(result.warnings.find((w) => w.index === 2)?.issues.join()).toMatch(/Add the exact excerpt/);

    const card = getCard(user.id, result.created[0].id);
    expect(card).toMatchObject({ excerpt: 'La heparina se neutraliza con sulfato de protamina', document: { title: 'Farmacología clínica', part: 0 } });

    const explanation = explainCard(user.id, card.id);
    expect(explanation.source).toMatchObject({ documentTitle: 'Farmacología clínica', excerptFound: true, part: 0 });
    expect(explanation.source!.context).toContain('complejo estable');
    expect(explanation.guidance).toMatch(/source/);

    const viaApi = await call(explainRoute.GET as Handler, `/api/v1/cards/${card.id}/explain`, { params: { id: card.id } });
    expect(viaApi.status).toBe(200);
    expect(viaApi.body.source.label).toBeTruthy();
  });
});

describe('duplicates and contradictions before saving', () => {
  it('flags near-duplicates and conflicting answers, and dry runs save nothing', async () => {
    const { userId } = await pharmacology();
    const check = addCards(userId, {
      deck: 'Medicina::Toxicología',
      dryRun: true,
      cards: [
        { front: '¿Cuál es el antídoto de la heparina?', back: 'Protamina' },
        { front: 'Antídoto de los opioides (intoxicación)', back: 'Atropina' },
        { front: 'Mecanismo de la aspirina', back: 'Inhibe la COX de forma irreversible' },
      ],
    });
    expect(check.dryRun).toBe(true);
    expect(check.created.every((card) => card.id === '')).toBe(true);
    expect(check.warnings.find((w) => w.index === 0)?.issues.join()).toMatch(/Near-duplicate/);
    expect(check.warnings.find((w) => w.index === 1)?.issues.join()).toMatch(/contradiction.*Naloxona/);
    expect(check.warnings.find((w) => w.index === 2)).toBeUndefined();
    const count = getDb().prepare(`SELECT COUNT(*) AS n FROM cards WHERE user_id = ?`).get(userId) as { n: number };
    expect(count.n).toBe(PHARMA.length);
  });
});

describe('edit history', () => {
  it('records who changed what and why, and reverts it', async () => {
    const { userId, ids } = await pharmacology();
    updateCard(userId, ids[0], { back: 'Sulfato de protamina' }, 'agent', 'Nombre completo del fármaco');
    updateCard(userId, ids[0], { suspended: true }, 'web');
    const revisions = listRevisions(userId, ids[0]);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      source: 'agent',
      reason: 'Nombre completo del fármaco',
      changes: [{ field: 'back', before: 'Protamina', after: 'Sulfato de protamina' }],
    });

    expect(revertRevision(userId, revisions[0].id).back).toBe('Protamina');
    expect(listRevisions(userId, ids[0])[0]).toMatchObject({ source: 'revert' });
  });

  it('exposes history and revert over REST, marking web edits', async () => {
    const user = getLocalUser();
    const [{ id }] = addCards(user.id, { deck: 'Anatomía', cards: [{ front: 'Nervio del deltoides', back: 'Axilar' }] }).created;
    const patched = await call(cardRoute.PATCH as Handler, `/api/v1/cards/${id}`, {
      method: 'PATCH',
      body: { back: 'Nervio axilar', reason: 'más preciso' },
      headers: { 'x-recallforge-client': 'web' },
      params: { id },
    });
    expect(patched.body.card.back).toBe('Nervio axilar');
    const history = await call(revisionsRoute.GET as Handler, `/api/v1/cards/${id}/revisions`, { params: { id } });
    expect(history.body.revisions[0]).toMatchObject({ source: 'web', reason: 'más preciso' });
    const reverted = await call(revertRoute.POST as Handler, `/api/v1/revisions/x/revert`, {
      method: 'POST',
      params: { id: history.body.revisions[0].id },
    });
    expect(reverted.body.card.back).toBe('Axilar');
  });
});

describe('question formats and session types', () => {
  it('multiple choice uses real answers of the subject and never reschedules', async () => {
    const { userId, ids } = await pharmacology();
    const next = nextCard(userId, { deck: 'Medicina', format: 'multiple_choice' }, T0);
    expect(next.presentation?.format).toBe('multiple_choice');
    const choices = next.presentation!.choices!;
    expect(choices).toHaveLength(4);
    const card = getCard(userId, next.card!.id);
    expect(choices).toContain(card.back);
    expect(choices.every((choice) => PHARMA.some((p) => p.back === choice))).toBe(true);

    const wrong = choices.find((choice) => choice !== card.back)!;
    const graded = gradeCard(userId, card.id, { format: 'multiple_choice', choice: wrong }, 'api', T0);
    expect(graded).toMatchObject({ practice: true, rating: 'again', check: { correct: false, expected: card.back } });
    expect(getCard(userId, card.id)).toMatchObject({ state: 'new', reps: 0 });

    // Practice does not count against the daily limits nor in retention.
    const stats = getStats(userId, {}, T0);
    expect(stats.today).toMatchObject({ reviews: 0, practice: 1 });
    expect(stats.due.new).toBe(ids.length);
    // The card just practiced is not asked again right away.
    expect(nextCard(userId, { deck: 'Medicina', format: 'multiple_choice' }, T0).card?.id).not.toBe(card.id);
  });

  it('true/false checks the judgement against the real answer', async () => {
    const { userId } = await pharmacology();
    const next = nextCard(userId, { format: 'true_false' }, T0);
    const card = getCard(userId, next.card!.id);
    const statement = next.presentation!.statement!;
    const isTrue = statement === card.back;
    const right = gradeCard(userId, card.id, { format: 'true_false', statement, answerTrue: isTrue }, 'api', T0);
    expect(right).toMatchObject({ practice: true, rating: 'good', check: { correct: true } });
    const wrong = gradeCard(userId, card.id, { format: 'true_false', statement, answerTrue: !isTrue }, 'api', T0);
    expect(wrong.check?.correct).toBe(false);
  });

  it('typing reports an exact-match hint but the rating decides the schedule', async () => {
    const { userId, ids } = await pharmacology();
    const result = gradeCard(userId, ids[2], { format: 'typing', answer: 'n acetilcisteina', rating: 'good' }, 'api', T0);
    expect(result).toMatchObject({ practice: false, rating: 'good', check: { correct: true } });
    expect(getCard(userId, ids[2]).reps).toBe(1);
    expect(() => gradeCard(userId, ids[3], { format: 'typing', answer: 'x' }, 'api', T0)).toThrow(/rating is required/);
  });

  it('quick sessions serve only what is already due', async () => {
    const { userId, ids } = await pharmacology();
    expect(nextCard(userId, { mode: 'quick' }, T0).card).toBeNull();
    gradeCard(userId, ids[0], { rating: 'again' }, 'api', T0);
    const quick = nextCard(userId, { mode: 'quick' }, new Date(T0.getTime() + 15 * 60_000));
    expect(quick.card?.id).toBe(ids[0]);
    expect(quick.remaining.new).toBe(0);
  });

  it('suggests rephrasing cards the learner has seen many times', async () => {
    const { userId, ids } = await pharmacology();
    let now = T0;
    for (let i = 0; i < 5; i++) {
      gradeCard(userId, ids[0], { rating: 'good' }, 'api', now);
      now = new Date(new Date(getCard(userId, ids[0]).dueAt).getTime() + 60_000);
    }
    const next = nextCard(userId, { deck: 'Medicina' }, now);
    expect(next.card).toMatchObject({ id: ids[0], suggestRephrase: true });
  });

  it('works over REST, returning the next practice question in the same format', async () => {
    const user = getLocalUser();
    addCards(user.id, { deck: 'Medicina::Farmacología', cards: PHARMA });
    const first = await call(nextRoute.GET as Handler, '/api/v1/study/next?format=multiple_choice');
    expect(first.body.presentation.choices).toHaveLength(4);
    const graded = await call(gradeRoute.POST as Handler, '/api/v1/study/grade', {
      body: { cardId: first.body.card.id, format: 'multiple_choice', choice: first.body.presentation.choices[0] },
    });
    expect(graded.status).toBe(200);
    expect(graded.body.result.practice).toBe(true);
    expect(graded.body.next.presentation.format).toBe('multiple_choice');
  });
});

describe('"my answer was right"', () => {
  it('replaces the last rating and reschedules as if graded that way', async () => {
    const { userId, ids } = await pharmacology();
    const other = await pharmacology();
    gradeCard(other.userId, other.ids[0], { rating: 'good', answer: 'sulfato de protamina' }, 'api', T0);
    const expected = getCard(other.userId, other.ids[0]);

    gradeCard(userId, ids[0], { rating: 'again', answer: 'sulfato de protamina' }, 'api', T0);
    const corrected = correctLastReview(userId, ids[0], { rating: 'good', reason: 'sinónimo' });
    expect(corrected).toMatchObject({ correctedFrom: 'again', rating: 'good' });
    const card = getCard(userId, ids[0]);
    expect(card).toMatchObject({ state: expected.state, dueAt: expected.dueAt, reps: 1, lapses: 0 });

    const logs = getDb().prepare(`SELECT rating, feedback, answer FROM review_logs WHERE card_id = ?`).all(ids[0]) as Array<Record<string, string>>;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ rating: 'good', answer: 'sulfato de protamina' });
    expect(logs[0].feedback).toMatch(/again → good \(sinónimo\)/);

    expect(() => correctLastReview(userId, ids[1], { rating: 'good' })).toThrow(/no review/);
  });

  it('is available over REST', async () => {
    const user = getLocalUser();
    const [{ id }] = addCards(user.id, { deck: 'X', cards: [{ front: 'Capital de Francia', back: 'París' }] }).created;
    gradeCard(user.id, id, { rating: 'again' });
    const res = await call(correctRoute.POST as Handler, '/api/v1/study/correct', { body: { cardId: id, rating: 'good' } });
    expect(res.status).toBe(200);
    expect(res.body.result.correctedFrom).toBe('again');
  });
});

describe('workload and recommendations', () => {
  it('estimates minutes from the learner pace and lists what to do next', async () => {
    const { userId, ids } = await pharmacology();
    updateDeck(userId, 'Medicina', { examDate: '2026-03-20' });
    for (let i = 0; i < 12; i++) {
      gradeCard(userId, ids[i % ids.length], { rating: 'again', durationMs: 30_000 }, 'api', new Date(T0.getTime() - DAY + i * 1000));
    }
    getDb().prepare(`UPDATE cards SET status = 'draft' WHERE id = ?`).run(ids[4]);

    const stats = getStats(userId, {}, T0);
    expect(stats.workload.secondsPerCard).toBe(30);
    expect(stats.workload.minutesToday).toBe(Math.ceil(((stats.due.learning + stats.due.review + stats.due.new) * 30) / 60));
    expect(stats.forecast[0]).toHaveProperty('minutes');

    const map = getProgressMap(userId, {}, T0);
    expect(map.workload.secondsPerCard).toBe(30);
    const kinds = map.recommendations.map((r) => r.kind);
    expect(kinds).toContain('exam_at_risk');
    expect(kinds).toContain('due');
    expect(kinds).toContain('drafts');
    expect(kinds.indexOf('exam_at_risk')).toBeLessThan(kinds.indexOf('drafts'));
    expect(map.recommendations.find((r) => r.kind === 'exam_at_risk')).toMatchObject({ deck: 'Medicina' });
  });
});

describe('import and export', () => {
  it('round-trips everything through the JSON export without duplicating on re-import', async () => {
    const { user: source } = await createTestUser();
    const doc = importDocumentText(source.id, { title: 'Apuntes', deck: 'Medicina', text: '# Uno\n\nLa heparina se revierte con protamina.' });
    const { created } = addCards(source.id, {
      documentId: doc.id,
      cards: [{ front: 'Reversión de la heparina', back: 'Protamina', excerpt: 'La heparina se revierte con protamina', documentPart: 0 }],
    });
    updateDeck(source.id, 'Medicina', { examDate: '2026-06-01' });
    gradeCard(source.id, created[0].id, { rating: 'good' }, 'api', T0);
    updateCard(source.id, created[0].id, { explanation: 'Carga positiva' }, 'agent', 'contexto');
    const backup = JSON.stringify(exportUserData(source.id));
    const original = getCard(source.id, created[0].id);

    // Restore into an empty collection (another database).
    useFreshDatabase();
    const { user: target } = await createTestUser();
    const result = importData(target.id, backup);
    expect(result).toMatchObject({ format: 'recallforge', cards: 1, documents: 1, reviews: 1, revisions: 1 });
    const restored = getCard(target.id, created[0].id);
    expect(restored).toMatchObject({
      front: original.front,
      state: original.state,
      dueAt: original.dueAt,
      stability: original.stability,
      excerpt: original.excerpt,
      explanation: 'Carga positiva',
      document: { id: doc.id, label: original.document!.label },
    });
    expect(listRevisions(target.id, created[0].id)).toHaveLength(1);
    expect(exportUserData(target.id).decks.find((d) => d.name === 'Medicina')?.examDate).toBe('2026-06-01');

    const again = importData(target.id, backup);
    expect(again).toMatchObject({ cards: 0, documents: 0, reviews: 0 });
    expect(again.skipped).toBeGreaterThan(0);
  });

  it('imports Anki plain-text exports and CSV with quotes, HTML and headers', async () => {
    const { user } = await createTestUser();
    const anki = [
      '#separator:tab',
      '#html:true',
      '#deck column:3',
      '#tags column:4',
      'Antídoto de la heparina\tProtamina<br>(sulfato)\tMedicina::Farmacología\tantidotos alto-rendimiento',
      'Nervio del deltoides\tAxilar\tMedicina::Anatomía\t',
      '\t\t\t',
    ].join('\n');
    const fromAnki = importData(user.id, anki);
    expect(fromAnki).toMatchObject({ format: 'delimited', cards: 2 });
    const [heparin] = (getDb().prepare(`SELECT c.back, c.tags, d.name FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.front LIKE 'Antídoto%'`).all() as Array<Record<string, string>>);
    expect(heparin.back).toMatch(/Protamina\s*\n?\s*\(sulfato\)/);
    expect(heparin.name).toBe('Medicina::Farmacología');
    expect(JSON.parse(heparin.tags).sort()).toEqual(['alto-rendimiento', 'antidotos']);

    const csv = 'pregunta,respuesta\n"Fármacos ""IECA"", ejemplo",Enalapril\n"Dos, líneas","Primera\nSegunda"\n';
    const fromCsv = importData(user.id, csv, { deck: 'Cardio', draft: true });
    expect(fromCsv.cards).toBe(2);
    const drafts = getDb().prepare(`SELECT front, back, status FROM cards WHERE status = 'draft' ORDER BY created_at`).all() as Array<Record<string, string>>;
    expect(drafts.map((d) => d.front)).toEqual(['Fármacos "IECA", ejemplo', 'Dos, líneas']);
    expect(drafts[1].back).toBe('Primera\nSegunda');

    expect(importData(user.id, anki).cards).toBe(0);
    expect(() => importData(user.id, '{"format":"otra-cosa"}')).toThrow(/Not a RecallForge export/);
    expect(parseDelimited('a;b\nc;"d;e"', ';')).toEqual([['a', 'b'], ['c', 'd;e']]);
  });

  it('exports TSV that imports back, and exposes import/export over REST', async () => {
    const user = getLocalUser();
    addCards(user.id, { deck: 'Medicina::Farmacología', cards: PHARMA.map((card) => ({ ...card, tags: ['antídotos'] })) });
    const tsv = exportCardsTsv(user.id, 'Medicina');
    expect(tsv.split('\n').filter((line) => line && !line.startsWith('#'))).toHaveLength(PHARMA.length);

    const exported = await call(exportRoute.GET as Handler, '/api/v1/export?format=tsv');
    expect(exported.headers.get('content-type')).toMatch(/tab-separated/);

    useFreshDatabase();
    const res = await call(importRoute.POST as Handler, '/api/v1/import', { raw: String(exported.body), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cards: PHARMA.length });

    const form = new FormData();
    form.set('file', new Blob(['Pregunta nueva\tRespuesta nueva\n']), 'notas.txt');
    form.set('deck', 'Varios');
    const multipart = await importRoute.POST(new Request('http://localhost:3030/api/v1/import', { method: 'POST', body: form }), {
      params: Promise.resolve({}),
    } as never);
    expect(await multipart.json()).toMatchObject({ cards: 1, decks: 1 });
  });
});

describe('large collections', () => {
  it('stays fast with 20,000 cards', async () => {
    const { user } = await createTestUser();
    const db = getDb();
    const decks = ['Medicina::Anatomía', 'Medicina::Fisiología', 'Medicina::Farmacología', 'Medicina::Patología'];
    for (const deck of decks) addCards(user.id, { deck, cards: [{ front: `Semilla ${deck}`, back: 'x' }] });
    const deckIds = (db.prepare(`SELECT id FROM decks WHERE user_id = ? AND name LIKE 'Medicina::%'`).all(user.id) as Array<{ id: string }>).map((d) => d.id);
    const insert = db.prepare(
      `INSERT INTO cards (id, user_id, deck_id, front, back, state, due_at, stability, difficulty, reps, last_review_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      for (let i = 0; i < 20_000; i++) {
        const reviewed = i % 3 !== 0;
        insert.run(
          `bulk-${i}`,
          user.id,
          deckIds[i % deckIds.length],
          `Pregunta número ${i} sobre el tema ${i % 97}`,
          `Respuesta ${i}`,
          reviewed ? 'review' : 'new',
          new Date(T0.getTime() + ((i % 30) - 5) * DAY).toISOString(),
          reviewed ? 5 + (i % 40) : 0,
          reviewed ? 5 : 0,
          reviewed ? 3 : 0,
          reviewed ? new Date(T0.getTime() - 10 * DAY).toISOString() : null,
          T0.toISOString(),
          T0.toISOString()
        );
      }
    })();

    const time = (fn: () => unknown) => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    // Answering must feel instant: next card + grade well under 100 ms each.
    let current = nextCard(user.id, {}, T0);
    const perCard: number[] = [];
    for (let i = 0; i < 20 && current.card; i++) {
      const id = current.card.id;
      perCard.push(time(() => gradeCard(user.id, id, { rating: 'good' }, 'api', T0)) + time(() => (current = nextCard(user.id, {}, T0))));
    }
    perCard.sort((a, b) => a - b);
    expect(perCard[Math.floor(perCard.length / 2)]).toBeLessThan(100);
    expect(time(() => getProgressMap(user.id, {}, T0))).toBeLessThan(2000);
    expect(time(() => getStats(user.id, {}, T0))).toBeLessThan(1000);
    expect(time(() => addCards(user.id, { deck: 'Medicina::Farmacología', dryRun: true, cards: [{ front: 'Pregunta número 5 sobre el tema 5', back: 'Otra' }] }))).toBeLessThan(2000);
  }, 60_000);
});
