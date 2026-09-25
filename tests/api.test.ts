import { beforeEach, describe, expect, it } from 'vitest';
import * as cardsRoute from '@/app/api/v1/cards/route';
import * as cardRoute from '@/app/api/v1/cards/[id]/route';
import * as decksRoute from '@/app/api/v1/decks/route';
import * as deckRoute from '@/app/api/v1/decks/[id]/route';
import * as nextRoute from '@/app/api/v1/study/next/route';
import * as revealRoute from '@/app/api/v1/study/reveal/route';
import * as gradeRoute from '@/app/api/v1/study/grade/route';
import * as statsRoute from '@/app/api/v1/stats/route';
import * as settingsRoute from '@/app/api/v1/settings/route';
import * as exportRoute from '@/app/api/v1/export/route';
import * as mcpRoute from '@/app/api/mcp/route';
import * as documentsRoute from '@/app/api/v1/documents/route';
import * as documentReadRoute from '@/app/api/v1/documents/[id]/read/route';
import * as approveRoute from '@/app/api/v1/cards/approve/route';
import { buildPdf, buildPptx } from './fixtures';
import { useFreshDatabase } from './helpers';

const BASE = 'http://localhost:3030';
const TOKEN = 'correct-horse-battery-staple';

type RouteHandler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: RouteHandler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string>; key?: string | null } = {}
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = init.key ?? null;
  if (key) headers.authorization = `Bearer ${key}`;
  const req = new Request(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return handler(req, { params: Promise.resolve(init.params ?? {}) as Promise<never> });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  useFreshDatabase();
  delete process.env.RECALLFORGE_TOKEN;
});

describe('REST API v1', () => {
  it('needs no credentials locally', async () => {
    expect((await call(decksRoute.GET, '/api/v1/decks')).status).toBe(200);
  });

  it('requires the token everywhere when RECALLFORGE_TOKEN is set', async () => {
    process.env.RECALLFORGE_TOKEN = TOKEN;
    const noParams = { params: Promise.resolve({}) };
    const res = await json(await call(decksRoute.GET, '/api/v1/decks'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect((await call(decksRoute.GET, '/api/v1/decks', { key: 'wrong-token-of-same-size-xxx' })).status).toBe(401);
    expect((await call(decksRoute.GET, '/api/v1/decks', { key: TOKEN })).status).toBe(200);
    const viaHeader = await decksRoute.GET(new Request(`${BASE}/api/v1/decks`, { headers: { 'x-api-key': TOKEN } }), noParams);
    expect(viaHeader.status).toBe(200);
    expect((await decksRoute.GET(new Request(`${BASE}/api/v1/decks?key=${TOKEN}`), noParams)).status).toBe(200);
    const viaCookie = await decksRoute.GET(new Request(`${BASE}/api/v1/decks`, { headers: { cookie: `a=b; rf_token=${TOKEN}` } }), noParams);
    expect(viaCookie.status).toBe(200);
  });

  it('runs a full study loop: add → next → reveal → grade', async () => {
    const created = await json(
      await call(cardsRoute.POST, '/api/v1/cards', {
        method: 'POST',
        body: {
          deck: 'Fisiología',
          cards: [
            { front: '¿Dónde se produce la eritropoyetina?', back: 'Riñón (células intersticiales peritubulares)', tags: ['renal'] },
            { front: 'Valor normal de potasio sérico', back: '3.5–5.0 mEq/L' },
          ],
        },
      })
    );
    expect(created.status).toBe(201);
    expect(created.body.created).toHaveLength(2);

    const next = await json(await call(nextRoute.GET, '/api/v1/study/next?deck=fisiología'));
    expect(next.body.card.front).toBe('¿Dónde se produce la eritropoyetina?');
    expect(next.body.card.back).toBeUndefined();
    expect(next.body.remaining).toEqual({ learning: 0, review: 0, new: 2 });

    const revealed = await json(await call(revealRoute.POST, '/api/v1/study/reveal', { method: 'POST', body: { cardId: next.body.card.id } }));
    expect(revealed.body.card.back).toMatch(/Riñón/);

    const graded = await json(
      await call(gradeRoute.POST, '/api/v1/study/grade', {
        method: 'POST',
        body: { cardId: next.body.card.id, rating: 'good', answer: 'En el riñón', deck: 'Fisiología' },
      })
    );
    expect(graded.status).toBe(200);
    expect(graded.body.result).toMatchObject({ rating: 'good', previousState: 'new' });
    expect(graded.body.next.card.front).toBe('Valor normal de potasio sérico');

    const stats = await json(await call(statsRoute.GET, '/api/v1/stats'));
    expect(stats.body.today.reviews).toBe(1);
  });

  it('manages decks and cards by id or name and maps errors to HTTP statuses', async () => {
    expect((await call(decksRoute.POST, '/api/v1/decks', { method: 'POST', body: { name: 'Anatomía' } })).status).toBe(201);
    expect((await call(decksRoute.POST, '/api/v1/decks', { method: 'POST', body: { name: 'anatomía' } })).status).toBe(409);
    expect((await call(decksRoute.POST, '/api/v1/decks', { method: 'POST', body: { name: '' } })).status).toBe(400);

    const renamed = await json(
      await call(deckRoute.PATCH, '/api/v1/decks/Anatom%C3%ADa', { method: 'PATCH', body: { name: 'Anatomía I' }, params: { id: 'Anatom%C3%ADa' } })
    );
    expect(renamed.body.deck.name).toBe('Anatomía I');

    const { body } = await json(
      await call(cardsRoute.POST, '/api/v1/cards', { method: 'POST', body: { deck: 'Anatomía I', cards: [{ front: 'Q', back: 'A' }] } })
    );
    const id = body.created[0].id;
    const patched = await json(await call(cardRoute.PATCH, `/api/v1/cards/${id}`, { method: 'PATCH', body: { tags: ['x'] }, params: { id } }));
    expect(patched.body.card.tags).toEqual(['x']);
    expect((await call(cardRoute.PATCH, `/api/v1/cards/${id}`, { method: 'PATCH', body: { front: '' }, params: { id } })).status).toBe(400);

    const search = await json(await call(cardsRoute.GET, '/api/v1/cards?tag=x&limit=5'));
    expect(search.body.total).toBe(1);

    expect((await call(cardRoute.DELETE, `/api/v1/cards/${id}`, { method: 'DELETE', params: { id } })).status).toBe(200);
    expect((await call(cardRoute.GET, `/api/v1/cards/${id}`, { params: { id } })).status).toBe(404);
    expect((await call(deckRoute.DELETE, '/api/v1/decks/nope', { method: 'DELETE', params: { id: 'nope' } })).status).toBe(404);
  });

  it('reads and validates settings and exports data', async () => {
    const updated = await json(await call(settingsRoute.PATCH, '/api/v1/settings', { method: 'PATCH', body: { newCardsPerDay: 50 } }));
    expect(updated.body.settings.newCardsPerDay).toBe(50);
    expect((await call(settingsRoute.PATCH, '/api/v1/settings', { method: 'PATCH', body: { newCardsPerDay: -1 } })).status).toBe(400);

    const exported = await call(exportRoute.GET, '/api/v1/export');
    expect(exported.headers.get('content-disposition')).toMatch(/attachment/);
    expect((await exported.json()).format).toBe('recallforge-export');

  });

  it('uploads a file, reads it and approves the drafts made from it', async () => {
    const form = new FormData();
    form.append('file', new File([Buffer.from(await buildPptx([{ lines: ['Ciclo de Krebs', 'Ocurre en la mitocondria'] }]))], 'bioquimica.pptx'));
    form.append('deck', 'Medicina::Bioquímica');
    const upload = await json(
      await documentsRoute.POST(
        new Request(`${BASE}/api/v1/documents`, { method: 'POST', body: form }),
        { params: Promise.resolve({}) }
      )
    );
    expect(upload.status).toBe(201);
    expect(upload.body.document).toMatchObject({ title: 'bioquimica', parts: 1, deck: { name: 'Medicina::Bioquímica' } });
    const id = upload.body.document.id;

    const read = await json(await call(documentReadRoute.GET, `/api/v1/documents/${id}/read?fromPart=0`, { params: { id } }));
    expect(read.body.parts[0]).toMatchObject({ index: 0, label: 'diapositiva 1' });

    const created = await json(
      await call(cardsRoute.POST, '/api/v1/cards', {
        method: 'POST',
        body: { documentId: id, draft: true, cards: [{ front: '¿Dónde ocurre el ciclo de Krebs?', back: 'En la matriz mitocondrial', documentPart: 0 }] },
      })
    );
    expect(created.body.status).toBe('draft');
    const approved = await json(await call(approveRoute.POST, '/api/v1/cards/approve', { method: 'POST', body: { documentId: id } }));
    expect(approved.body).toEqual({ approved: 1 });

    const unsupported = await documentsRoute.POST(
      new Request(`${BASE}/api/v1/documents`, {
        method: 'POST',
        body: (() => {
          const f = new FormData();
          f.append('file', new File(['x'], 'foto.png'));
          return f;
        })(),
      }),
      { params: Promise.resolve({}) }
    );
    expect(unsupported.status).toBe(400);
  });
});

describe('MCP endpoint', () => {
  let rpcId = 0;

  async function rpc(method: string, params: Record<string, unknown> = {}, key: string | null = null) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await mcpRoute.POST(
      new Request(`${BASE}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
    );
    return { status: res.status, body: await res.json() };
  }

  async function tool(name: string, args: Record<string, unknown> = {}) {
    const { body } = await rpc('tools/call', { name, arguments: args });
    const text = body.result.content[0].text as string;
    return { isError: Boolean(body.result.isError), text, data: body.result.isError ? null : JSON.parse(text) };
  }

  it('requires the token only when RECALLFORGE_TOKEN is set', async () => {
    expect((await rpc('tools/list')).status).toBe(200);
    process.env.RECALLFORGE_TOKEN = TOKEN;
    expect((await rpc('tools/list')).status).toBe(401);
    expect((await rpc('tools/list', {}, TOKEN)).status).toBe(200);
    delete process.env.RECALLFORGE_TOKEN;
  });

  it('initializes with the study protocol as server instructions', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe('recallforge');
    expect(body.result.instructions).toMatch(/STUDY SESSION/);
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('lists the agent tools and prompts', async () => {
    const tools = (await rpc('tools/list')).body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(tools).toEqual([
      'add_cards',
      'add_document',
      'approve_cards',
      'delete_cards',
      'delete_deck',
      'delete_document',
      'get_next_card',
      'get_progress_map',
      'get_stats',
      'grade_card',
      'list_decks',
      'list_documents',
      'read_document',
      'reveal_answer',
      'search_cards',
      'undo_last_review',
      'update_card',
      'update_deck',
      'update_settings',
    ]);
    const prompts = (await rpc('prompts/list')).body.result.prompts.map((p: { name: string }) => p.name).sort();
    expect(prompts).toEqual(['make_cards', 'study']);
  });

  it('lets an agent create cards and run a study session end to end', async () => {
    const added = await tool('add_cards', {
      deck: 'Farmacología',
      cards: [
        { front: 'Antídoto de la intoxicación por paracetamol', back: 'N-acetilcisteína', explanation: 'Repone glutatión', tags: ['toxicología'] },
        { front: 'Antídoto de los opioides', back: 'Naloxona', tags: ['toxicología'] },
      ],
    });
    expect(added.data.created).toHaveLength(2);

    const first = await tool('get_next_card', { tag: 'toxicología' });
    expect(first.data.card.front).toBe('Antídoto de la intoxicación por paracetamol');
    expect(first.text).not.toMatch(/acetilciste/);

    const revealed = await tool('reveal_answer', { card_id: first.data.card.id });
    expect(revealed.data.card.back).toBe('N-acetilcisteína');
    expect(revealed.data.outcomes.good.interval).toBeTruthy();

    const graded = await tool('grade_card', {
      card_id: first.data.card.id,
      rating: 'again',
      user_answer: 'Flumazenil',
      feedback: 'Confundió con el antídoto de benzodiacepinas',
      tag: 'toxicología',
    });
    expect(graded.data.result.state).toBe('learning');
    expect(graded.data.next.card.front).toBe('Antídoto de los opioides');

    const again = await tool('reveal_answer', { card_id: first.data.card.id });
    expect(again.data.recentAttempts[0]).toMatchObject({ rating: 'again', answer: 'Flumazenil' });

    const stats = await tool('get_stats', {});
    expect(stats.data.today.again).toBe(1);
    expect(stats.data.weakCards[0].id).toBe(first.data.card.id);

    const settings = await tool('update_settings', { new_cards_per_day: 5 });
    expect(settings.data.settings.newCardsPerDay).toBe(5);
  });

  it('lets an agent store a document and turn it into reviewed drafts', async () => {
    const stored = await tool('add_document', {
      title: 'Clase de cardio',
      deck: 'Medicina::Cardiología',
      content_base64: Buffer.from(buildPdf(['El nodo sinusal marca el ritmo', 'La onda P es auricular'])).toString('base64'),
      filename: 'cardio.pdf',
    });
    expect(stored.data.document).toMatchObject({ parts: 2, deck: { name: 'Medicina::Cardiología' } });
    const documentId = stored.data.document.id;

    const read = await tool('read_document', { document_id: documentId, max_chars: 500 });
    expect(read.data.parts.map((p: { label: string }) => p.label)).toEqual(['p. 1', 'p. 2']);

    const added = await tool('add_cards', {
      document_id: documentId,
      draft: true,
      cards: [{ front: '¿Qué estructura marca el ritmo cardíaco normal?', back: 'El nodo sinusal', document_part: 0 }],
    });
    expect(added.data).toMatchObject({ status: 'draft', created: [{ deck: 'Medicina::Cardiología' }] });

    const outline = await tool('read_document', { document_id: documentId, outline_only: true });
    expect(outline.data.document.outline.map((p: { cards: number }) => p.cards)).toEqual([1, 0]);

    const drafts = await tool('search_cards', { state: 'draft', document_id: documentId });
    expect(drafts.data.cards[0].source).toBe('Clase de cardio, p. 1');

    expect((await tool('get_next_card')).data.card).toBeNull();
    expect((await tool('approve_cards', { card_ids: [drafts.data.cards[0].id] })).data).toEqual({ approved: 1 });
    expect((await tool('get_next_card', { deck: 'Medicina' })).data.card.front).toBe('¿Qué estructura marca el ritmo cardíaco normal?');

    const text = await tool('add_document', { title: 'Notas', text: '# Uno\nA\n# Dos\nB' });
    expect(text.data.document.parts).toBe(2);
    expect((await tool('list_documents')).data.documents).toHaveLength(2);
  });

  it('returns tool errors instead of crashing', async () => {
    const missing = await tool('reveal_answer', { card_id: 'does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Card not found/);

    const invalid = await rpc('tools/call', { name: 'grade_card', arguments: { card_id: 'x', rating: 'perfect' } });
    expect(invalid.body.result?.isError ?? Boolean(invalid.body.error)).toBe(true);
  });
});
