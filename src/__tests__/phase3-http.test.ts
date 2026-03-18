// ============================================================================
// RecallForge — Phase 3 HTTP Integration Tests
// ============================================================================
// Real HTTP tests against a managed Next dev server with its own temporary SQLite DB.
// The suite boots a disposable server, exercises auth/sync/agent/copilot flows,
// and shuts it down automatically at the end.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startManagedNextServer } from './helpers/managed-next-server';

let BASE = '';

let cookieJar = new Map<string, string>();
const testEmail = `httptest-${Date.now()}@recallforge.test`;
const testPassword = 'TestPass123!';
const testName = 'HTTP Test User';
let stopServer: (() => Promise<void>) | null = null;

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, init);
    lastResponse = response;
    if (response.status < 500 || attempt === attempts) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
  }

  if (!lastResponse) {
    throw new Error(`No se pudo obtener respuesta de ${url}`);
  }

  return lastResponse;
}

function readSetCookies(res: Response): string[] {
  const headerList = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  if (headerList.length > 0) return headerList;

  const singleHeader = res.headers.get('set-cookie');
  return singleHeader ? [singleHeader] : [];
}

function mergeCookies(res: Response) {
  for (const cookie of readSetCookies(res)) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value) {
      cookieJar.set(name.trim(), value.trim());
    }
  }
}

function getCookieHeader(): string {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function ensureAuthenticatedSession(): Promise<string> {
  const existing = getCookieHeader();
  if (existing) return existing;

  const registerRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword, name: testName }),
  });
  expect([201, 409]).toContain(registerRes.status);

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  expect(csrfRes.status).toBe(200);
  mergeCookies(csrfRes);
  const csrfData = await csrfRes.json();

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams({
      email: testEmail,
      password: testPassword,
      csrfToken: csrfData.csrfToken,
      callbackUrl: `${BASE}/dashboard`,
      json: 'true',
    }),
    redirect: 'manual',
  });
  mergeCookies(loginRes);
  expect([200, 302]).toContain(loginRes.status);

  const cookieHeader = getCookieHeader();
  expect(cookieHeader).toMatch(/session-token|authjs\.session-token/i);
  return cookieHeader;
}

beforeAll(async () => {
  const server = await startManagedNextServer();
  BASE = server.baseUrl;
  stopServer = server.stop;
}, 150_000);

afterAll(async () => {
  if (stopServer) {
    await stopServer();
  }
}, 30_000);

describe('Phase 3 HTTP Integration', () => {
  // ── Auth flow ────────────────────────────────────────────────────────

  describe('Auth endpoints', () => {
    it('POST /api/auth/register creates user', async () => {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword, name: testName }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.email).toBe(testEmail);
      expect(data.apiKey).toBeDefined();
    }, 15_000);

    it('POST /api/auth/register rejects duplicate email', async () => {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword, name: testName }),
      });
      expect(res.status).toBe(409);
    });

    it('POST /api/auth/callback/credentials logs in', async () => {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      expect(csrfRes.status).toBe(200);
      const csrfContentType = csrfRes.headers.get('content-type') || '';
      expect(csrfContentType).toContain('application/json');
      mergeCookies(csrfRes);
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken;

      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: getCookieHeader(),
        },
        body: new URLSearchParams({
          email: testEmail,
          password: testPassword,
          csrfToken,
          callbackUrl: `${BASE}/dashboard`,
          json: 'true',
        }),
        redirect: 'manual',
      });
      mergeCookies(res);

      expect([200, 302]).toContain(res.status);
      expect(getCookieHeader()).toMatch(/session-token|authjs\.session-token/i);
    });

    it('GET /api/auth/session returns user', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/auth/session`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(testEmail);
    });

    it('DELETE /api/auth/account/data clears server content but preserves the account', async () => {
      const cookieHeader = await ensureAuthenticatedSession();

      const deckId = `http-delete-data-deck-${Date.now()}`;
      const syncRes = await fetch(`${BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          operations: [{
            operationId: `op-${deckId}`,
            deviceId: 'http-phase3',
            clientUpdatedAt: new Date().toISOString(),
            table: 'decks',
            operation: 'create',
            recordId: deckId,
            data: {
              name: 'Delete Data Deck',
              description: 'Should disappear from server',
              archived: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }],
        }),
      });
      expect(syncRes.status).toBe(200);

      const deleteRes = await fetch(`${BASE}/api/auth/account/data`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      });
      expect(deleteRes.status).toBe(200);
      const deleteData = await deleteRes.json();
      expect(deleteData.success).toBe(true);
      expect(deleteData.preservedAccount).toBe(true);

      const accountRes = await fetch(`${BASE}/api/auth/account`, {
        headers: { Cookie: cookieHeader },
      });
      expect(accountRes.status).toBe(200);

      const pullRes = await fetch(`${BASE}/api/sync/pull?since=1970-01-01T00:00:00.000Z`, {
        headers: { Cookie: cookieHeader },
      });
      expect(pullRes.status).toBe(200);
      const pullData = await pullRes.json();
      const deckChanges = pullData.changes.decks;
      expect(deckChanges === undefined || Array.isArray(deckChanges.upserts)).toBe(true);
      expect(deckChanges?.upserts ?? []).toHaveLength(0);
      expect(deckChanges?.deletes ?? []).toHaveLength(0);
    }, 15_000);
  });

  // ── Sync endpoints ──────────────────────────────────────────────────

  describe('Sync endpoints', () => {
    it('POST /api/sync/push returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: [] }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /api/sync/push processes operations with session', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          operations: [{
            table: 'decks',
            operation: 'create',
            recordId: `http-test-deck-${Date.now()}`,
            data: {
              name: 'HTTP Test Deck',
              description: 'Created by integration test',
              userId: 'test',
              archived: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.processed).toBe(1);
      expect(data.failed).toBe(0);
    }, 15_000);

    it('GET /api/sync/pull returns changes with session', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/sync/pull?since=1970-01-01T00:00:00.000Z`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.changes).toBeDefined();
      expect(data.syncTimestamp).toBeDefined();
    }, 15_000);

    it('GET /api/sync/pull returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/api/sync/pull?since=1970-01-01T00:00:00.000Z`);
      expect(res.status).toBe(401);
    });
  });

  // ── Agent API endpoints ─────────────────────────────────────────────

  describe('Agent API endpoints', () => {
    it('GET /api/agent/events returns 401 without auth', async () => {
      const res = await fetch(`${BASE}/api/agent/events`);
      expect(res.status).toBe(401);
    });

    it('POST /api/agent/events ingests and GET returns events', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const eventId = `http-test-event-${Date.now()}`;
      const postRes = await fetch(`${BASE}/api/agent/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          events: [{
            id: eventId,
            ts: new Date().toISOString(),
            type: 'test_event',
            entityType: 'test',
            entityId: 'test-1',
            source: 'http-integration-test',
            payload: { test: true },
          }],
        }),
      });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.inserted).toBe(1);

      // Retrieve
      const getRes = await fetch(`${BASE}/api/agent/events?type=test_event`, {
        headers: { Cookie: cookieHeader },
      });
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.events.length).toBeGreaterThanOrEqual(1);
    }, 12_000);

    it('GET /api/agent/events supports ndjson format', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/events?format=ndjson`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    });

    it('GET /api/agent/summaries returns data', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/summaries`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.summaries).toBeDefined();
    });

    it('GET /api/agent/summaries supports ndjson format', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/summaries?format=ndjson`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    });

    it('GET /api/agent/progress returns data', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/progress`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
    });

    it('GET /api/agent/pending returns data', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/pending`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
    });

    it('GET /api/agent/scopes returns canonical deep academic scopes', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/scopes`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.decks)).toBe(true);
      expect(Array.isArray(data.programs)).toBe(true);
      expect(Array.isArray(data.subjects)).toBe(true);
      expect(Array.isArray(data.modules)).toBe(true);
      expect(Array.isArray(data.chapters)).toBe(true);
      expect(Array.isArray(data.topics)).toBe(true);
      expect(Array.isArray(data.noteTypes)).toBe(true);
    });

    it('GET /api/agent/academic-summary returns deep academic arrays', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/academic-summary`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.cards).toBeDefined();
      expect(Array.isArray(data.subjects)).toBe(true);
      expect(Array.isArray(data.modules)).toBe(true);
      expect(Array.isArray(data.chapters)).toBe(true);
      expect(Array.isArray(data.topics)).toBe(true);
      expect(Array.isArray(data.decks)).toBe(true);
    });

    it('GET /api/agent/coverage returns explicit coverage and risk snapshot', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/agent/coverage`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.overall.totalCards).toBe('number');
      expect(typeof data.overall.studiedCoveragePercent).toBe('number');
      expect(typeof data.overall.curriculumLinkedPercent).toBe('number');
      expect(Array.isArray(data.subjects)).toBe(true);
      expect(Array.isArray(data.atRisk.topics)).toBe(true);
    });
  });

  describe('Copilot API endpoints', () => {
    it('GET /api/copilot/brief returns actionable brief', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const res = await fetch(`${BASE}/api/copilot/brief`, {
        headers: { Cookie: cookieHeader },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(typeof data.summary).toBe('string');
      expect(Array.isArray(data.actions)).toBe(true);
      expect(data.stats).toBeDefined();
    });

    it('POST /api/copilot/drafts and review imports with traceability', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const noteTypeName = `http-basic-${Date.now()}`;

      const noteTypeRes = await fetch(`${BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          operations: [{
            operationId: `op-http-note-type-${Date.now()}`,
            deviceId: 'http-phase3',
            clientUpdatedAt: new Date().toISOString(),
            table: 'noteTypes',
            operation: 'create',
            recordId: `nt-http-${Date.now()}`,
            data: {
              name: noteTypeName,
              kind: 'basic',
              fields: [{ name: 'Front', required: true }, { name: 'Back', required: true }],
              templates: [{ id: 'tpl-http-front-back', name: 'Card 1', active: true }],
              css: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }],
        }),
      });
      expect(noteTypeRes.status).toBe(200);

      const createRes = await fetch(`${BASE}/api/copilot/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          agentId: 'http-copilot-test',
          drafts: [{
            noteType: noteTypeName,
            deck: 'Contract Deck',
            fields: { Front: `HTTP Copilot ${Date.now()}`, Back: 'A' },
            reason: 'http-test',
            sourceActionId: 'http-action-1',
          }],
        }),
      });
      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      expect(createData.created).toBe(1);
      expect(createData.drafts[0].sourceActionId).toBe('http-action-1');

      const draftId = createData.drafts[0].id as string;
      const reviewRes = await fetch(`${BASE}/api/copilot/drafts/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          reviews: [{ draftId, action: 'approve', comment: 'ship it' }],
        }),
      });
      expect(reviewRes.status).toBe(200);
      const reviewData = await reviewRes.json();
      expect(reviewData.imported).toBe(1);

      const listRes = await fetch(`${BASE}/api/copilot/drafts?status=imported`, {
        headers: { Cookie: cookieHeader },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const importedDraft = listData.drafts.find((draft: { id: string }) => draft.id === draftId);
      expect(importedDraft).toBeDefined();
      expect(importedDraft.importedNoteId).toBeTruthy();
      expect(importedDraft.sourceActionId).toBe('http-action-1');
    }, 15_000);

    it('POST /api/openclaw/drafts stages chapter-derived drafts for human review', async () => {
      const cookieHeader = await ensureAuthenticatedSession();
      const noteTypeName = `http-openclaw-${Date.now()}`;

      const noteTypeRes = await fetch(`${BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          operations: [{
            operationId: `op-http-openclaw-note-type-${Date.now()}`,
            deviceId: 'http-phase3',
            clientUpdatedAt: new Date().toISOString(),
            table: 'noteTypes',
            operation: 'create',
            recordId: `nt-http-openclaw-${Date.now()}`,
            data: {
              name: noteTypeName,
              kind: 'basic',
              fields: [{ name: 'Front', required: true }, { name: 'Back', required: true }],
              templates: [{ id: 'tpl-http-openclaw-front-back', name: 'Card 1', active: true }],
              css: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }],
        }),
      });
      expect(noteTypeRes.status).toBe(200);

      const createRes = await fetch(`${BASE}/api/openclaw/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'x-request-id': 'http-openclaw-test' },
        body: JSON.stringify({
          context: {
            subject: 'Bioquímica',
            module: 'Metabolismo',
            chapter: 'Glucólisis',
            topic: 'Hexoquinasa',
            defaultNoteType: noteTypeName,
            ingestionId: `http-openclaw-${Date.now()}`,
            sourceAssets: [
              {
                kind: 'image',
                name: 'glycolysis-page-2.png',
                pageNumber: 2,
                sourceUrl: 'https://openclaw.test/assets/glycolysis-page-2.png',
              },
            ],
          },
          drafts: [{
            fields: { Front: `¿Qué enzima fosforila glucosa? ${Date.now()}`, Back: 'Hexoquinasa' },
            tags: ['bioquimica'],
          }],
        }),
      });
      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      expect(createData.created).toBe(1);
      expect(createData.drafts[0].deck).toBe('Bioquímica::Glucólisis');
      expect(createData.drafts[0].sourceMetadata.importSource).toBe('openclaw');

      const draftId = createData.drafts[0].id as string;
      const reviewRes = await fetch(`${BASE}/api/copilot/drafts/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          reviews: [{ draftId, action: 'approve', comment: 'approve openclaw draft' }],
        }),
      });
      expect(reviewRes.status).toBe(200);
      const reviewData = await reviewRes.json();
      expect(reviewData.imported).toBe(1);

      const listRes = await fetch(`${BASE}/api/copilot/drafts?status=imported`, {
        headers: { Cookie: cookieHeader },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const importedDraft = listData.drafts.find((draft: { id: string }) => draft.id === draftId);
      expect(importedDraft).toBeDefined();
      expect(importedDraft.sourceMetadata.ingestionId).toContain('http-openclaw-');
      expect(importedDraft.sourceAssets[0].name).toBe('glycolysis-page-2.png');
    }, 15_000);

    it('POST /api/copilot/outcomes and GET /api/copilot/history persist feedback', async () => {
      const cookieHeader = await ensureAuthenticatedSession();

      const outcomeRes = await fetch(`${BASE}/api/copilot/outcomes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({
          recommendationId: 'http-rec-1',
          actionType: 'study_overdue',
          actionTaken: false,
          userDismissed: true,
          payload: { source: 'phase3-http' },
        }),
      });
      expect(outcomeRes.status).toBe(200);
      const outcomeData = await outcomeRes.json();
      expect(outcomeData.outcome.userDismissed).toBe(true);

      const historyRes = await fetch(`${BASE}/api/copilot/history?limit=20`, {
        headers: { Cookie: cookieHeader },
      });
      expect(historyRes.status).toBe(200);
      const historyData = await historyRes.json();
      expect(Array.isArray(historyData.events)).toBe(true);
      expect(historyData.events.some((event: { type: string }) => event.type === 'copilot_outcome_recorded')).toBe(true);
    }, 12_000);
  });

  describe('Protected app pages', () => {
    const protectedPages = [
      { path: '/settings', marker: 'Ajustes' },
      { path: '/copilot', marker: 'Study Copilot' },
      { path: '/optimizer', marker: 'Cargando optimizador...' },
      { path: '/agent-console', marker: 'Consola de Agente' },
    ];

    for (const page of protectedPages) {
      it(`GET ${page.path} renders for an authenticated session`, async () => {
        const cookieHeader = await ensureAuthenticatedSession();
        const res = await fetchWithRetry(`${BASE}${page.path}`, {
          headers: { Cookie: cookieHeader },
          redirect: 'manual',
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const html = await res.text();
        expect(html).toContain(page.marker);
      }, 10_000);
    }
  });

  // ── Middleware check ────────────────────────────────────────────────

  describe('Middleware protection', () => {
    it('unauthenticated /api/sync/push returns 401', async () => {
      const res = await fetch(`${BASE}/api/sync/push`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('unauthenticated /api/agent/events returns 401', async () => {
      const res = await fetch(`${BASE}/api/agent/events`);
      expect(res.status).toBe(401);
    });

    it('GET /api/health is not protected', async () => {
      const res = await fetchWithRetry(`${BASE}/api/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.observability).toBeDefined();
      expect(typeof data.observability.totals.totalRequests).toBe('number');
    });
  });
});
