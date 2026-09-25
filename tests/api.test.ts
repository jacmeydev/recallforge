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
import * as apiKeyRoute from '@/app/api/v1/account/api-key/route';
import * as registerRoute from '@/app/api/auth/register/route';
import * as mcpRoute from '@/app/api/mcp/route';
import { createTestUser, useFreshDatabase } from './helpers';

const BASE = 'http://localhost:3030';
let apiKey: string;

type RouteHandler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: RouteHandler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string>; key?: string | null } = {}
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = init.key === undefined ? apiKey : init.key;
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

beforeEach(async () => {
  useFreshDatabase();
  apiKey = (await createTestUser()).apiKey;
});

describe('REST API v1', () => {
  it('rejects missing or wrong API keys', async () => {
    expect((await call(decksRoute.GET, '/api/v1/decks', { key: null })).status).toBe(401);
    const res = await json(await call(decksRoute.GET, '/api/v1/decks', { key: 'rf_wrong' }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('accepts the key via X-API-Key header and ?key= query', async () => {
    const noParams = { params: Promise.resolve({}) };
    const viaHeader = await decksRoute.GET(new Request(`${BASE}/api/v1/decks`, { headers: { 'x-api-key': apiKey } }), noParams);
    expect(viaHeader.status).toBe(200);
    const viaQuery = await decksRoute.GET(new Request(`${BASE}/api/v1/decks?key=${apiKey}`), noParams);
    expect(viaQuery.status).toBe(200);
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

  it('reads and validates settings, exports data, and reserves key rotation for the web app', async () => {
    const updated = await json(await call(settingsRoute.PATCH, '/api/v1/settings', { method: 'PATCH', body: { newCardsPerDay: 50 } }));
    expect(updated.body.settings.newCardsPerDay).toBe(50);
    expect((await call(settingsRoute.PATCH, '/api/v1/settings', { method: 'PATCH', body: { newCardsPerDay: -1 } })).status).toBe(400);

    const exported = await call(exportRoute.GET, '/api/v1/export');
    expect(exported.headers.get('content-disposition')).toMatch(/attachment/);
    expect((await exported.json()).format).toBe('recallforge-export');

    expect((await call(apiKeyRoute.POST, '/api/v1/account/api-key', { method: 'POST' })).status).toBe(403);
  });

  it('closes registration after the first account unless ALLOW_REGISTRATION=true', async () => {
    const register = () =>
      registerRoute.POST(
        new Request(`${BASE}/api/auth/register`, {
          method: 'POST',
          body: JSON.stringify({ email: `x${Date.now()}@example.com`, password: 'longenough', name: 'X' }),
        })
      );
    expect((await registerRoute.GET().json()).open).toBe(false);
    expect((await register()).status).toBe(403);
    process.env.ALLOW_REGISTRATION = 'true';
    try {
      expect((await register()).status).toBe(201);
    } finally {
      delete process.env.ALLOW_REGISTRATION;
    }
  });

  it('registers the first account and returns the API key once', async () => {
    useFreshDatabase();
    const res = await json(
      await registerRoute.POST(
        new Request(`${BASE}/api/auth/register`, {
          method: 'POST',
          body: JSON.stringify({ email: 'Nueva@Example.com', password: 'longenough', name: 'Nueva', timezone: 'America/Lima' }),
        })
      )
    );
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^rf_/);
    expect(res.body.user).toMatchObject({ email: 'nueva@example.com', timezone: 'America/Lima' });
  });
});

describe('MCP endpoint', () => {
  let rpcId = 0;

  async function rpc(method: string, params: Record<string, unknown> = {}, key: string | null = apiKey) {
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

  it('requires authentication', async () => {
    expect((await rpc('tools/list', {}, null)).status).toBe(401);
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
      'delete_cards',
      'delete_deck',
      'get_next_card',
      'get_stats',
      'grade_card',
      'list_decks',
      'reveal_answer',
      'search_cards',
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

  it('returns tool errors instead of crashing', async () => {
    const missing = await tool('reveal_answer', { card_id: 'does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Card not found/);

    const invalid = await rpc('tools/call', { name: 'grade_card', arguments: { card_id: 'x', rating: 'perfect' } });
    expect(invalid.body.result?.isError ?? Boolean(invalid.body.error)).toBe(true);
  });
});
