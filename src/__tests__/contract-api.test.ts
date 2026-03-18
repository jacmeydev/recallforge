import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { hashApiKey } from '@/lib/server/api-keys';

vi.mock('@/lib/server/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('@/lib/server/auth', () => ({
  auth: vi.fn(),
}));

const TEST_USER_ID = 'contract-user';
const TEST_EMAIL = 'contract-user@test.com';

function cleanupUserData() {
  sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM daily_summaries WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM personal_summaries WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM user_gamification WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM notification_preferences WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM copilot_outcomes WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM copilot_drafts WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM sync_operations WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM sync_cursors WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_links WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_topics WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_chapters WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_modules WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_subjects WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM curriculum_programs WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM card_commands WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM presets WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(TEST_USER_ID);
}

beforeEach(() => {
  vi.clearAllMocks();
  runMigrations();
  cleanupUserData();

  sqlite.prepare(`
    INSERT INTO users (
      id, email, name, password_hash, api_key, api_key_hash, api_key_preview, api_key_last_rotated_at, created_at, updated_at
    )
    VALUES (?, ?, ?, 'hash', NULL, ?, 'rf_1234...abcd', datetime('now'), datetime('now'), datetime('now'))
  `).run(TEST_USER_ID, TEST_EMAIL, 'Contract User', hashApiKey('rf_contract_secret'));

  sqlite.prepare(`
    INSERT INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
    VALUES (?, ?, 'basic', 'basic', ?, ?, '', datetime('now'), datetime('now'))
  `).run(
    'nt-contract',
    TEST_USER_ID,
    JSON.stringify([{ name: 'Front', required: true }, { name: 'Back', required: true }]),
    JSON.stringify([{ id: 'tpl-front-back', name: 'Card 1', active: true }])
  );

  sqlite.prepare(`
    INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
    VALUES (?, ?, 'Contract Deck', '', 0, 0, '{}', datetime('now'), datetime('now'))
  `).run('deck-contract', TEST_USER_ID);
});

describe('API contract tests', () => {
  async function mockApiUser() {
    const { authenticateRequest } = await import('@/lib/server/api-auth');
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: {
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        name: 'Contract User',
        locale: 'es',
        timezone: 'America/Bogota',
        theme: 'system',
        studyPreferences: {
          showNextIntervals: true,
          simpleMode: false,
          autoplayAudio: true,
          doubleScrollProtection: true,
          focusModeDefault: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  it('agent import rejects unsupported duplicate strategies with 400', async () => {
    await mockApiUser();

    const route = await import('@/app/api/agent/import/route');
    const req = new NextRequest('http://localhost/api/agent/import', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ noteType: 'basic', deck: 'Contract Deck', fields: { Front: 'Q', Back: 'A' } }],
        options: { duplicateStrategy: 'explode' },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await route.POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Unsupported duplicateStrategy');
  });

  it('review-status writes canonical academic aiReviewStatus', async () => {
    await mockApiUser();

    sqlite.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', '[]', 'agent-import', ?, 'hash-1', 0, datetime('now'), datetime('now'))
    `).run(
      'note-contract-review',
      TEST_USER_ID,
      'deck-contract',
      'nt-contract',
      JSON.stringify({ academic: { aiReviewStatus: 'pending-review' } })
    );

    const route = await import('@/app/api/agent/review-status/route');
    const req = new NextRequest('http://localhost/api/agent/review-status', {
      method: 'POST',
      body: JSON.stringify({
        noteIds: ['note-contract-review'],
        status: 'reviewed',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await route.POST(req);
    expect(res.status).toBe(200);

    const row = sqlite.prepare(`SELECT source_metadata FROM notes WHERE id = ?`).get('note-contract-review') as { source_metadata: string };
    const metadata = JSON.parse(row.source_metadata) as { academic?: { aiReviewStatus?: string } };
    expect(metadata.academic?.aiReviewStatus).toBe('reviewed');
  });

  it('account endpoint returns preview only and never raw apiKey', async () => {
    const { auth } = await import('@/lib/server/auth');
    const mockedAuth = auth as unknown as { mockResolvedValue: (value: unknown) => void };
    mockedAuth.mockResolvedValue({
      user: { id: TEST_USER_ID, email: TEST_EMAIL, name: 'Contract User' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    const route = await import('@/app/api/auth/account/route');
    const res = await route.GET(new NextRequest('http://localhost/api/auth/account'));
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.apiKey).toBeUndefined();
    expect(body.hasApiKey).toBe(true);
    expect(body.apiKeyPreview).toBe('rf_1234...abcd');
  });

  it('api-key rotate stores hash only and returns the raw key once', async () => {
    const { auth } = await import('@/lib/server/auth');
    const mockedAuth = auth as unknown as { mockResolvedValue: (value: unknown) => void };
    mockedAuth.mockResolvedValue({
      user: { id: TEST_USER_ID, email: TEST_EMAIL, name: 'Contract User' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    const route = await import('@/app/api/auth/api-key/rotate/route');
    const res = await route.POST(new NextRequest('http://localhost/api/auth/api-key/rotate', { method: 'POST' }));
    const body = await res.json() as { apiKey: string; apiKeyPreview: string };

    expect(res.status).toBe(200);
    expect(body.apiKey).toMatch(/^rf_[a-f0-9]{64}$/);
    expect(body.apiKeyPreview).toContain('...');

    const row = sqlite.prepare(`
      SELECT api_key, api_key_hash, api_key_preview
      FROM users
      WHERE id = ?
    `).get(TEST_USER_ID) as {
      api_key: string | null;
      api_key_hash: string;
      api_key_preview: string;
    };

    expect(row.api_key).toBeNull();
    expect(row.api_key_hash).toBe(hashApiKey(body.apiKey));
    expect(row.api_key_preview).toBe(body.apiKeyPreview);
  });

  it('account data delete clears synced server data but preserves the account', async () => {
    const { auth } = await import('@/lib/server/auth');
    const mockedAuth = auth as unknown as { mockResolvedValue: (value: unknown) => void };
    mockedAuth.mockResolvedValue({
      user: { id: TEST_USER_ID, email: TEST_EMAIL, name: 'Contract User' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    sqlite.prepare(`
      INSERT INTO presets (id, user_id, name, created_at, updated_at)
      VALUES ('preset-contract', ?, 'Default', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    sqlite.prepare(`
      INSERT INTO notes (
        id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at
      )
      VALUES ('note-delete-data', ?, 'deck-contract', 'nt-contract', ?, '[]', 'manual', '{}', 'hash-delete-data', 0, datetime('now'), datetime('now'))
    `).run(TEST_USER_ID, JSON.stringify({ Front: 'Q', Back: 'A' }));

    sqlite.prepare(`
      INSERT INTO cards (
        id, user_id, note_id, template_id, deck_id, due_at, state, created_at, updated_at
      )
      VALUES ('card-delete-data', ?, 'note-delete-data', 'tpl-front-back', 'deck-contract', datetime('now'), 'new', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    sqlite.prepare(`
      INSERT INTO sync_operations (
        id, user_id, device_id, table_name, operation, record_id, client_updated_at, received_at
      )
      VALUES ('sync-delete-data', ?, 'device-contract', 'decks', 'create', 'deck-contract', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    const route = await import('@/app/api/auth/account/data/route');
    const res = await route.DELETE(new NextRequest('http://localhost/api/auth/account/data', { method: 'DELETE' }));
    const body = await res.json() as { success: boolean; preservedAccount: boolean; deleted: Record<string, number> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preservedAccount).toBe(true);
    expect(body.deleted.presets).toBe(1);
    expect(body.deleted.syncOperations).toBe(1);

    const remainingUser = sqlite.prepare(`SELECT id FROM users WHERE id = ?`).get(TEST_USER_ID) as { id: string } | undefined;
    const remainingDecks = sqlite.prepare(`SELECT COUNT(*) AS count FROM decks WHERE user_id = ?`).get(TEST_USER_ID) as { count: number };
    const remainingNotes = sqlite.prepare(`SELECT COUNT(*) AS count FROM notes WHERE user_id = ?`).get(TEST_USER_ID) as { count: number };
    const remainingCards = sqlite.prepare(`SELECT COUNT(*) AS count FROM cards WHERE user_id = ?`).get(TEST_USER_ID) as { count: number };
    const remainingSyncOps = sqlite.prepare(`SELECT COUNT(*) AS count FROM sync_operations WHERE user_id = ?`).get(TEST_USER_ID) as { count: number };

    expect(remainingUser?.id).toBe(TEST_USER_ID);
    expect(remainingDecks.count).toBe(0);
    expect(remainingNotes.count).toBe(0);
    expect(remainingCards.count).toBe(0);
    expect(remainingSyncOps.count).toBe(0);
  });

  it('account delete succeeds even with presets and sync operations present', async () => {
    const { auth } = await import('@/lib/server/auth');
    const mockedAuth = auth as unknown as { mockResolvedValue: (value: unknown) => void };
    mockedAuth.mockResolvedValue({
      user: { id: TEST_USER_ID, email: TEST_EMAIL, name: 'Contract User' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    sqlite.prepare(`
      INSERT INTO presets (id, user_id, name, created_at, updated_at)
      VALUES ('preset-delete-account', ?, 'Default', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    sqlite.prepare(`
      INSERT INTO sync_operations (
        id, user_id, device_id, table_name, operation, record_id, client_updated_at, received_at
      )
      VALUES ('sync-delete-account', ?, 'device-contract', 'presets', 'create', 'preset-delete-account', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    const route = await import('@/app/api/auth/account/route');
    const res = await route.DELETE(new NextRequest('http://localhost/api/auth/account', { method: 'DELETE' }));
    const body = await res.json() as { success: boolean; deleted: Record<string, number> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted.presets).toBe(1);
    expect(body.deleted.syncOperations).toBe(1);
    expect(body.deleted.users).toBe(1);

    const remainingUser = sqlite.prepare(`SELECT id FROM users WHERE id = ?`).get(TEST_USER_ID);
    expect(remainingUser).toBeUndefined();
  });

  it('sync push is idempotent by operationId', async () => {
    await mockApiUser();

    const route = await import('@/app/api/sync/push/route');
    const payload = {
      operations: [
        {
          operationId: 'op-contract-1',
          deviceId: 'device-contract',
          clientUpdatedAt: new Date().toISOString(),
          table: 'decks',
          operation: 'create',
          recordId: 'deck-sync-contract',
          data: {
            name: 'Synced Deck',
            description: '',
            parentDeckId: null,
            sortOrder: 0,
            archived: false,
            presetId: null,
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    };

    const first = await route.POST(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', 'x-device-id': 'device-contract' },
    }));
    const second = await route.POST(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', 'x-device-id': 'device-contract' },
    }));

    const firstBody = await first.json() as { processed: number };
    const secondBody = await second.json() as { results: Array<{ duplicate?: boolean }> };

    expect(first.status).toBe(200);
    expect(firstBody.processed).toBe(1);
    expect(second.status).toBe(200);
    expect(secondBody.results[0]?.duplicate).toBe(true);

    const opCount = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM sync_operations WHERE id = 'op-contract-1'
    `).get() as { count: number };
    expect(opCount.count).toBe(1);
  });

  it('copilot brief returns canonical actions and stats', async () => {
    await mockApiUser();

    const route = await import('@/app/api/copilot/brief/route');
    const res = await route.GET(new NextRequest('http://localhost/api/copilot/brief'));
    const body = await res.json() as {
      ok: boolean;
      actions: Array<{ actionType: string; urgency: string }>;
      stats: { draftsPending: number; pendingReviewCards: number };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);
    for (const action of body.actions) {
      expect(action.actionType).toBeTruthy();
      expect(['low', 'medium', 'high', 'critical']).toContain(action.urgency);
    }
    expect(typeof body.stats.draftsPending).toBe('number');
    expect(typeof body.stats.pendingReviewCards).toBe('number');
  });

  it('agent coverage returns explicit coverage and risk snapshot', async () => {
    await mockApiUser();

    const route = await import('@/app/api/agent/coverage/route');
    const res = await route.GET(new NextRequest('http://localhost/api/agent/coverage'));
    const body = await res.json() as {
      ok: boolean;
      overall: { totalCards: number; studiedCoveragePercent: number; curriculumLinkedPercent: number };
      subjects: Array<{ coveragePercent: number; overdueRatioPercent: number }>;
      atRisk: { topics: Array<unknown> };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.overall.totalCards).toBe('number');
    expect(typeof body.overall.studiedCoveragePercent).toBe('number');
    expect(typeof body.overall.curriculumLinkedPercent).toBe('number');
    expect(Array.isArray(body.subjects)).toBe(true);
    expect(Array.isArray(body.atRisk.topics)).toBe(true);
  });

  it('copilot outcomes and history routes persist traceable events', async () => {
    await mockApiUser();

    const outcomesRoute = await import('@/app/api/copilot/outcomes/route');
    const outcomeRes = await outcomesRoute.POST(new NextRequest('http://localhost/api/copilot/outcomes', {
      method: 'POST',
      body: JSON.stringify({
        recommendationId: 'contract-rec-1',
        actionType: 'study_overdue',
        actionTaken: false,
        userDismissed: true,
        payload: { sourceActionId: 'contract-action-1' },
      }),
      headers: { 'content-type': 'application/json' },
    }));
    const outcomeBody = await outcomeRes.json() as {
      outcome: { actionType: string; userDismissed: boolean; payload: { sourceActionId?: string } };
    };

    expect(outcomeRes.status).toBe(200);
    expect(outcomeBody.outcome.actionType).toBe('study_overdue');
    expect(outcomeBody.outcome.userDismissed).toBe(true);
    expect(outcomeBody.outcome.payload.sourceActionId).toBe('contract-action-1');

    const historyRoute = await import('@/app/api/copilot/history/route');
    const historyRes = await historyRoute.GET(new NextRequest('http://localhost/api/copilot/history?limit=20'));
    const historyBody = await historyRes.json() as { events: Array<{ type: string }> };

    expect(historyRes.status).toBe(200);
    expect(historyBody.events.some((event) => event.type === 'copilot_outcome_recorded')).toBe(true);
  });

  it('openclaw drafts route stores chapter context and imports through human review', async () => {
    await mockApiUser();

    const openClawRoute = await import('@/app/api/openclaw/drafts/route');
    const createRes = await openClawRoute.POST(new NextRequest('http://localhost/api/openclaw/drafts', {
      method: 'POST',
      body: JSON.stringify({
        context: {
          subject: 'Fisiologia',
          module: 'Cardiovascular',
          chapter: 'Gasto cardiaco',
          topic: 'Precarga',
          ingestionId: 'contract-openclaw-1',
          chapterTitle: 'Capítulo 4',
          sourceAssets: [
            {
              kind: 'image',
              name: 'cap4-page-1.png',
              pageNumber: 1,
              sourceUrl: 'https://openclaw.test/assets/cap4-page-1.png',
            },
          ],
        },
        drafts: [
          {
            fields: { Front: '¿Qué aumenta la precarga?', Back: 'Retorno venoso' },
            tags: ['fisio'],
            externalId: 'openclaw-contract-ext-1',
          },
        ],
      }),
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-openclaw-contract' },
    }));
    const createBody = await createRes.json() as {
      created: number;
      ingestionId: string;
      drafts: Array<{ id: string; deck: string; noteType: string; sourceMetadata: { importSource?: string; ingestionId?: string } }>;
    };

    expect(createRes.status).toBe(200);
    expect(createBody.created).toBe(1);
    expect(createBody.ingestionId).toBe('contract-openclaw-1');
    expect(createBody.drafts[0].deck).toBe('Fisiologia::Gasto cardiaco');
    expect(createBody.drafts[0].noteType).toBe('basic');
    expect(createBody.drafts[0].sourceMetadata.importSource).toBe('openclaw');
    expect(createBody.drafts[0].sourceMetadata.ingestionId).toBe('contract-openclaw-1');

    const reviewRoute = await import('@/app/api/copilot/drafts/review/route');
    const reviewRes = await reviewRoute.POST(new NextRequest('http://localhost/api/copilot/drafts/review', {
      method: 'POST',
      body: JSON.stringify({
        reviews: [{ draftId: createBody.drafts[0].id, action: 'approve', comment: 'approve openclaw import' }],
      }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(reviewRes.status).toBe(200);

    const row = sqlite.prepare(`
      SELECT imported_note_id
      FROM copilot_drafts
      WHERE id = ?
    `).get(createBody.drafts[0].id) as { imported_note_id: string };

    const note = sqlite.prepare(`
      SELECT source_metadata
      FROM notes
      WHERE id = ?
    `).get(row.imported_note_id) as { source_metadata: string };

    const metadata = JSON.parse(note.source_metadata) as {
      importSource?: string;
      ingestionId?: string;
      sourceActionId?: string;
      sourceAssets?: Array<{ name?: string }>;
      academic?: { subject?: string; module?: string; chapter?: string; topic?: string; aiReviewStatus?: string };
      externalId?: string;
    };

    expect(metadata.importSource).toBe('openclaw');
    expect(metadata.ingestionId).toBe('contract-openclaw-1');
    expect(metadata.sourceAssets?.[0]?.name).toBe('cap4-page-1.png');
    expect(metadata.academic?.subject).toBe('Fisiologia');
    expect(metadata.academic?.module).toBe('Cardiovascular');
    expect(metadata.academic?.chapter).toBe('Gasto cardiaco');
    expect(metadata.academic?.topic).toBe('Precarga');
    expect(metadata.academic?.aiReviewStatus).toBe('reviewed');
    expect(metadata.externalId).toBe('openclaw-contract-ext-1');
  });

  it('openclaw can read review candidates and stage improvements for existing notes', async () => {
    await mockApiUser();

    sqlite.prepare(`
      INSERT INTO notes (
        id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at
      )
      VALUES ('note-openclaw-improve-contract', ?, 'deck-contract', 'nt-contract', ?, '[]', 'manual', ?, 'hash-openclaw-improve-contract', 0, datetime('now'), datetime('now'))
    `).run(
      TEST_USER_ID,
      JSON.stringify({ Front: 'Define gasto cardiaco', Back: 'Volumen bombeado por minuto' }),
      JSON.stringify({ academic: { aiReviewStatus: 'pending-review' } }),
    );

    sqlite.prepare(`
      INSERT INTO cards (
        id, user_id, note_id, template_id, deck_id, due_at, state, created_at, updated_at
      )
      VALUES ('card-openclaw-improve-contract', ?, 'note-openclaw-improve-contract', 'tpl-front-back', 'deck-contract', datetime('now', '-1 day'), 'review', datetime('now'), datetime('now'))
    `).run(TEST_USER_ID);

    const candidatesRoute = await import('@/app/api/openclaw/review-candidates/route');
    const candidatesRes = await candidatesRoute.GET(new NextRequest('http://localhost/api/openclaw/review-candidates?noteId=note-openclaw-improve-contract'));
    const candidatesBody = await candidatesRes.json() as {
      ok: boolean;
      count: number;
      candidates: Array<{ noteId: string; issues: string[]; fields: { Front?: string } }>;
    };

    expect(candidatesRes.status).toBe(200);
    expect(candidatesBody.ok).toBe(true);
    expect(candidatesBody.count).toBe(1);
    expect(candidatesBody.candidates[0].noteId).toBe('note-openclaw-improve-contract');
    expect(candidatesBody.candidates[0].issues).toEqual(expect.arrayContaining([
      'missing_subject',
      'missing_module',
      'missing_chapter',
      'missing_topic',
      'pending_ai_review',
      'missing_tags',
      'missing_curriculum_link',
    ]));

    const improvementRoute = await import('@/app/api/openclaw/improvement-drafts/route');
    const improvementRes = await improvementRoute.POST(new NextRequest('http://localhost/api/openclaw/improvement-drafts', {
      method: 'POST',
      body: JSON.stringify({
        proposals: [
          {
            targetNoteId: 'note-openclaw-improve-contract',
            targetCardIds: ['card-openclaw-improve-contract'],
            deck: 'Contract Deck::Hemodinamica',
            fields: {
              Front: '¿Cómo se define el gasto cardiaco?',
              Back: 'Es el volumen de sangre que el corazón bombea en un minuto.',
            },
            tags: ['fisiologia', 'hemodinamica'],
            subject: 'Fisiologia',
            module: 'Cardiovascular',
            chapter: 'Hemodinamica',
            topic: 'Gasto cardiaco',
            confidence: 0.91,
            recommendationSummary: 'Reclasificar y hacer la pregunta más directa.',
          },
        ],
      }),
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-openclaw-improve-contract' },
    }));
    const improvementBody = await improvementRes.json() as {
      ok: boolean;
      created: number;
      drafts: Array<{ id: string; sourceMetadata: { draftMode?: string; targetNoteId?: string } }>;
      notFound: string[];
    };

    expect(improvementRes.status).toBe(200);
    expect(improvementBody.ok).toBe(true);
    expect(improvementBody.created).toBe(1);
    expect(improvementBody.notFound).toHaveLength(0);
    expect(improvementBody.drafts[0].sourceMetadata.draftMode).toBe('improve-existing');
    expect(improvementBody.drafts[0].sourceMetadata.targetNoteId).toBe('note-openclaw-improve-contract');

    const reviewRoute = await import('@/app/api/copilot/drafts/review/route');
    const reviewRes = await reviewRoute.POST(new NextRequest('http://localhost/api/copilot/drafts/review', {
      method: 'POST',
      body: JSON.stringify({
        reviews: [{ draftId: improvementBody.drafts[0].id, action: 'approve', comment: 'apply OpenClaw improvement' }],
      }),
      headers: { 'content-type': 'application/json' },
    }));
    const reviewBody = await reviewRes.json() as { ok: boolean; imported: number; updatedExisting: number };

    expect(reviewRes.status).toBe(200);
    expect(reviewBody.ok).toBe(true);
    expect(reviewBody.imported).toBe(1);
    expect(reviewBody.updatedExisting).toBe(1);

    const noteCount = sqlite.prepare(`SELECT COUNT(*) AS count FROM notes WHERE user_id = ?`).get(TEST_USER_ID) as { count: number };
    expect(noteCount.count).toBe(1);

    const updatedNote = sqlite.prepare(`
      SELECT n.id, n.field_values, n.tags, n.source_metadata, d.name as deck_name
      FROM notes n
      JOIN decks d ON d.id = n.deck_id
      WHERE n.id = 'note-openclaw-improve-contract'
    `).get() as {
      id: string;
      field_values: string;
      tags: string;
      source_metadata: string;
      deck_name: string;
    };

    const updatedMetadata = JSON.parse(updatedNote.source_metadata) as {
      academic?: { subject?: string; module?: string; chapter?: string; topic?: string; aiReviewStatus?: string };
      lastImprovement?: { draftId?: string; confidence?: number };
    };

    expect(updatedNote.deck_name).toBe('Contract Deck::Hemodinamica');
    expect(JSON.parse(updatedNote.field_values).Front).toBe('¿Cómo se define el gasto cardiaco?');
    expect(JSON.parse(updatedNote.tags)).toEqual(expect.arrayContaining(['fisiologia', 'hemodinamica']));
    expect(updatedMetadata.academic?.subject).toBe('Fisiologia');
    expect(updatedMetadata.academic?.module).toBe('Cardiovascular');
    expect(updatedMetadata.academic?.chapter).toBe('Hemodinamica');
    expect(updatedMetadata.academic?.topic).toBe('Gasto cardiaco');
    expect(updatedMetadata.academic?.aiReviewStatus).toBe('reviewed');
    expect(updatedMetadata.lastImprovement?.draftId).toBe(improvementBody.drafts[0].id);
    expect(updatedMetadata.lastImprovement?.confidence).toBe(0.91);
  });

  it('health endpoint exposes observability snapshot', async () => {
    const route = await import('@/app/api/health/route');
    const res = await route.GET();
    const body = await res.json() as {
      status: string;
      observability?: { totals?: { routesTracked?: number; totalRequests?: number } };
      schema?: { replayBacklog?: number };
    };

    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.observability?.totals?.routesTracked).toBe('number');
    expect(typeof body.observability?.totals?.totalRequests).toBe('number');
    expect(typeof body.schema?.replayBacklog).toBe('number');
  });
});
