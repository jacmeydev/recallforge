import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createNewFSRSCard, getDefaultPreset, scheduleReview } from '@/lib/fsrs';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { replayCardReviews } from '@/lib/server/review-replay';

vi.mock('@/lib/server/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

const TEST_USER_ID = 'replay-user';
const TEST_EMAIL = 'replay-user@test.com';
const TEST_DECK_ID = 'deck-replay';
const TEST_NOTE_TYPE_ID = 'nt-replay';
const TEST_NOTE_ID = 'note-replay';
const TEST_CARD_ID = 'card-replay';
const CARD_CREATED_AT = '2026-01-01T00:00:00.000Z';

function cleanupUserData() {
  sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM sync_operations WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM sync_cursors WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM card_commands WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(TEST_USER_ID);
  sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(TEST_USER_ID);
}

function seedBaseState() {
  sqlite.prepare(`
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES (?, ?, 'Replay User', ?, ?)
  `).run(TEST_USER_ID, TEST_EMAIL, CARD_CREATED_AT, CARD_CREATED_AT);

  sqlite.prepare(`
    INSERT INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
    VALUES (?, ?, 'basic', 'basic', ?, ?, '', ?, ?)
  `).run(
    TEST_NOTE_TYPE_ID,
    TEST_USER_ID,
    JSON.stringify([{ name: 'Front', required: true }, { name: 'Back', required: true }]),
    JSON.stringify([{ id: 'tpl-front-back', name: 'Card 1', active: true }]),
    CARD_CREATED_AT,
    CARD_CREATED_AT
  );

  sqlite.prepare(`
    INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
    VALUES (?, ?, 'Replay Deck', '', 0, 0, '{}', ?, ?)
  `).run(TEST_DECK_ID, TEST_USER_ID, CARD_CREATED_AT, CARD_CREATED_AT);

  sqlite.prepare(`
    INSERT INTO notes (
      id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, '[]', 'manual', '{}', 'hash-replay', 0, ?, ?)
  `).run(
    TEST_NOTE_ID,
    TEST_USER_ID,
    TEST_DECK_ID,
    TEST_NOTE_TYPE_ID,
    JSON.stringify({ Front: 'Q', Back: 'A' }),
    CARD_CREATED_AT,
    CARD_CREATED_AT
  );

  sqlite.prepare(`
    INSERT INTO cards (
      id, user_id, note_id, template_id, deck_id, due_at, state, queue_position, stability, difficulty,
      retrievability, elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_at,
      suspended, buried_until, custom_data, created_at, updated_at
    )
    VALUES (?, ?, ?, 'tpl-front-back', ?, ?, 'new', 0, 0, 0, NULL, 0, 0, 0, 0, 0, NULL, 0, NULL, '{}', ?, ?)
  `).run(TEST_CARD_ID, TEST_USER_ID, TEST_NOTE_ID, TEST_DECK_ID, CARD_CREATED_AT, CARD_CREATED_AT, CARD_CREATED_AT);
}

function insertReviewLog(args: {
  id: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  reviewedAt: string;
  deviceId: string;
  deviceSeq: number;
}) {
  sqlite.prepare(`
    INSERT INTO review_logs (
      id, user_id, card_id, reviewed_at, client_reviewed_at, server_received_at, effective_reviewed_at,
      offset_measured_at, time_source, rating, previous_state, next_state, previous_due_at, next_due_at,
      previous_stability, next_stability, previous_difficulty, next_difficulty, response_time_ms,
      was_manual_reschedule, was_filtered_deck, session_id, device_id, device_seq, clock_offset_ms,
      replay_ordinal, scheduler_context, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'client', ?, 'new', 'review', ?, ?, 0, 0, 0, 0, 1000, 0, 0, NULL, ?, ?, 0, NULL, '{}', ?)
  `).run(
    args.id,
    TEST_USER_ID,
    TEST_CARD_ID,
    args.reviewedAt,
    args.reviewedAt,
    args.reviewedAt,
    args.reviewedAt,
    args.reviewedAt,
    args.rating,
    CARD_CREATED_AT,
    CARD_CREATED_AT,
    args.deviceId,
    args.deviceSeq,
    args.reviewedAt
  );
}

function insertCardCommand(args: {
  id: string;
  command: 'bury' | 'unbury' | 'suspend' | 'unsuspend' | 'manual_reschedule' | 'reset';
  effectiveAt: string;
  payload?: Record<string, unknown>;
  deviceId: string;
  deviceSeq: number;
}) {
  sqlite.prepare(`
    INSERT INTO card_commands (
      id, user_id, card_id, command, payload, client_issued_at, server_received_at, effective_at,
      offset_measured_at, time_source, device_id, device_seq, clock_offset_ms, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'client', ?, ?, 0, ?)
  `).run(
    args.id,
    TEST_USER_ID,
    TEST_CARD_ID,
    args.command,
    JSON.stringify(args.payload ?? {}),
    args.effectiveAt,
    args.effectiveAt,
    args.effectiveAt,
    args.effectiveAt,
    args.deviceId,
    args.deviceSeq,
    args.effectiveAt
  );
}

function getCardRow() {
  return sqlite.prepare(`
    SELECT due_at, state, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_at, suspended, buried_until
    FROM cards
    WHERE id = ? AND user_id = ?
  `).get(TEST_CARD_ID, TEST_USER_ID) as {
    due_at: string;
    state: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
    learning_steps: number;
    last_review_at: string | null;
    suspended: number;
    buried_until: string | null;
  };
}

function buildAnchorCard() {
  const base = createNewFSRSCard();
  return {
    id: TEST_CARD_ID,
    userId: TEST_USER_ID,
    noteId: TEST_NOTE_ID,
    templateId: 'tpl-front-back',
    deckId: TEST_DECK_ID,
    dueAt: CARD_CREATED_AT,
    state: 'new' as const,
    queuePosition: 0,
    stability: base.stability ?? 0,
    difficulty: base.difficulty ?? 0,
    retrievability: undefined,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    lastReviewAt: null,
    suspended: false,
    buriedUntil: null,
    customData: {},
    createdAt: CARD_CREATED_AT,
    updatedAt: CARD_CREATED_AT,
  };
}

async function authenticateAsTestUser() {
  const { authenticateRequest } = await import('@/lib/server/api-auth');
  vi.mocked(authenticateRequest).mockResolvedValue({
    user: {
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: 'Replay User',
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
      createdAt: CARD_CREATED_AT,
      updatedAt: CARD_CREATED_AT,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runMigrations();
  cleanupUserData();
  seedBaseState();
});

describe('review replay', () => {
  it('replays out-of-order review logs deterministically', () => {
    insertReviewLog({
      id: 'log-late',
      rating: 'again',
      reviewedAt: '2026-01-01T11:00:00.000Z',
      deviceId: 'device-b',
      deviceSeq: 2,
    });
    insertReviewLog({
      id: 'log-early',
      rating: 'good',
      reviewedAt: '2026-01-01T10:00:00.000Z',
      deviceId: 'device-a',
      deviceSeq: 1,
    });

    const result = replayCardReviews(TEST_USER_ID, TEST_CARD_ID);
    expect(result.appliedLogs).toBe(2);

    const orderedLogs = sqlite.prepare(`
      SELECT id, replay_ordinal
      FROM review_logs
      WHERE user_id = ? AND card_id = ?
      ORDER BY replay_ordinal ASC
    `).all(TEST_USER_ID, TEST_CARD_ID) as Array<{ id: string; replay_ordinal: number }>;

    expect(orderedLogs.map((row) => row.id)).toEqual(['log-early', 'log-late']);

    const preset = getDefaultPreset();
    const anchor = buildAnchorCard();
    const firstReview = scheduleReview(anchor, 'good', preset, new Date('2026-01-01T10:00:00.000Z'));
    const afterFirst = { ...anchor, ...firstReview.card, updatedAt: '2026-01-01T10:00:00.000Z' };
    const secondReview = scheduleReview(afterFirst, 'again', preset, new Date('2026-01-01T11:00:00.000Z'));
    const expected = { ...afterFirst, ...secondReview.card, updatedAt: '2026-01-01T11:00:00.000Z' };

    const card = getCardRow();
    expect(card.state).toBe(expected.state);
    expect(card.due_at).toBe(expected.dueAt);
    expect(card.stability).toBe(expected.stability);
    expect(card.difficulty).toBe(expected.difficulty);
    expect(card.elapsed_days).toBe(expected.elapsedDays);
    expect(card.scheduled_days).toBe(expected.scheduledDays);
    expect(card.reps).toBe(expected.reps);
    expect(card.lapses).toBe(expected.lapses);
    expect(card.learning_steps).toBe(expected.learningSteps);
    expect(card.last_review_at).toBe(expected.lastReviewAt);
  });

  it('clock-corrects invalid client review timestamps during sync push', async () => {
    await authenticateAsTestUser();
    const route = await import('@/app/api/sync/push/route');

    const response = await route.POST(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-device-id': 'device-clock',
      },
      body: JSON.stringify({
        operations: [
          {
            operationId: 'op-clock-review',
            deviceId: 'device-clock',
            clientUpdatedAt: '2030-01-01T00:00:00.000Z',
            table: 'reviewLogs',
            operation: 'create',
            recordId: 'log-clock-review',
            data: {
              cardId: TEST_CARD_ID,
              reviewedAt: '2030-01-01T00:00:00.000Z',
              clientReviewedAt: '2030-01-01T00:00:00.000Z',
              offsetMeasuredAt: '2029-12-31T23:00:00.000Z',
              clockOffsetMs: 0,
              rating: 'good',
              previousState: 'new',
              nextState: 'review',
              previousDueAt: CARD_CREATED_AT,
              nextDueAt: CARD_CREATED_AT,
              previousStability: 0,
              nextStability: 0,
              previousDifficulty: 0,
              nextDifficulty: 0,
              responseTimeMs: 1200,
              wasManualReschedule: false,
              wasFilteredDeck: false,
              sessionId: null,
              deviceId: 'device-clock',
              deviceSeq: 1,
              schedulerContext: {},
            },
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const row = sqlite.prepare(`
      SELECT time_source, effective_reviewed_at, server_received_at
      FROM review_logs
      WHERE id = ?
    `).get('log-clock-review') as {
      time_source: string;
      effective_reviewed_at: string;
      server_received_at: string;
    };

    expect(row.time_source).toBe('clock_corrected');
    expect(row.effective_reviewed_at).toBe(row.server_received_at);
  });

  it('respects reset commands as replay cutoffs', () => {
    insertReviewLog({
      id: 'log-before-reset',
      rating: 'good',
      reviewedAt: '2026-01-01T10:00:00.000Z',
      deviceId: 'device-a',
      deviceSeq: 1,
    });
    insertCardCommand({
      id: 'cmd-reset',
      command: 'reset',
      effectiveAt: '2026-01-01T11:00:00.000Z',
      payload: { dueAt: '2026-01-01T11:00:00.000Z' },
      deviceId: 'device-a',
      deviceSeq: 2,
    });
    insertReviewLog({
      id: 'log-after-reset',
      rating: 'good',
      reviewedAt: '2026-01-01T12:00:00.000Z',
      deviceId: 'device-a',
      deviceSeq: 3,
    });

    const result = replayCardReviews(TEST_USER_ID, TEST_CARD_ID);
    expect(result.appliedLogs).toBe(1);

    const preset = getDefaultPreset();
    const resetAnchor = {
      ...buildAnchorCard(),
      dueAt: '2026-01-01T11:00:00.000Z',
      updatedAt: '2026-01-01T11:00:00.000Z',
    };
    const expectedReview = scheduleReview(resetAnchor, 'good', preset, new Date('2026-01-01T12:00:00.000Z'));
    const expected = { ...resetAnchor, ...expectedReview.card, updatedAt: '2026-01-01T12:00:00.000Z' };

    const card = getCardRow();
    expect(card.state).toBe(expected.state);
    expect(card.due_at).toBe(expected.dueAt);
    expect(card.reps).toBe(expected.reps);
    expect(card.last_review_at).toBe(expected.lastReviewAt);
  });

  it('ignores duplicate review deliveries by device sequence', async () => {
    await authenticateAsTestUser();
    const route = await import('@/app/api/sync/push/route');

    const makeRequest = (recordId: string, operationId: string) =>
      route.POST(new NextRequest('http://localhost/api/sync/push', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-device-id': 'device-dup',
        },
        body: JSON.stringify({
          operations: [
            {
              operationId,
              deviceId: 'device-dup',
              clientUpdatedAt: '2026-01-01T10:00:00.000Z',
              table: 'reviewLogs',
              operation: 'create',
              recordId,
              data: {
                cardId: TEST_CARD_ID,
                reviewedAt: '2026-01-01T10:00:00.000Z',
                clientReviewedAt: '2026-01-01T10:00:00.000Z',
                offsetMeasuredAt: '2026-01-01T09:59:00.000Z',
                clockOffsetMs: 0,
                rating: 'good',
                previousState: 'new',
                nextState: 'review',
                previousDueAt: CARD_CREATED_AT,
                nextDueAt: CARD_CREATED_AT,
                previousStability: 0,
                nextStability: 0,
                previousDifficulty: 0,
                nextDifficulty: 0,
                responseTimeMs: 1000,
                wasManualReschedule: false,
                wasFilteredDeck: false,
                sessionId: null,
                deviceId: 'device-dup',
                deviceSeq: 7,
                schedulerContext: {},
              },
            },
          ],
        }),
      }));

    const first = await makeRequest('log-dup-1', 'op-dup-1');
    const second = await makeRequest('log-dup-2', 'op-dup-2');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const count = sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM review_logs
      WHERE user_id = ? AND card_id = ?
    `).get(TEST_USER_ID, TEST_CARD_ID) as { count: number };

    expect(count.count).toBe(1);
  });

  it('does not let paired card updates overwrite replayed scheduling state', async () => {
    await authenticateAsTestUser();
    const route = await import('@/app/api/sync/push/route');
    const bogusDueAt = '2045-01-01T00:00:00.000Z';

    const response = await route.POST(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-device-id': 'device-paired',
      },
      body: JSON.stringify({
        operations: [
          {
            operationId: 'op-card-stale',
            deviceId: 'device-paired',
            clientUpdatedAt: '2026-01-01T10:00:00.000Z',
            table: 'cards',
            operation: 'update',
            recordId: TEST_CARD_ID,
            data: {
              dueAt: bogusDueAt,
              state: 'review',
              stability: 999,
              difficulty: 999,
              reps: 99,
              lapses: 99,
              learningSteps: 99,
              lastReviewAt: '2045-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T10:00:00.000Z',
            },
          },
          {
            operationId: 'op-review-real',
            deviceId: 'device-paired',
            clientUpdatedAt: '2026-01-01T10:00:00.000Z',
            table: 'reviewLogs',
            operation: 'create',
            recordId: 'log-real-review',
            data: {
              cardId: TEST_CARD_ID,
              reviewedAt: '2026-01-01T10:00:00.000Z',
              clientReviewedAt: '2026-01-01T10:00:00.000Z',
              offsetMeasuredAt: '2026-01-01T09:59:00.000Z',
              clockOffsetMs: 0,
              rating: 'good',
              previousState: 'new',
              nextState: 'review',
              previousDueAt: CARD_CREATED_AT,
              nextDueAt: CARD_CREATED_AT,
              previousStability: 0,
              nextStability: 0,
              previousDifficulty: 0,
              nextDifficulty: 0,
              responseTimeMs: 1000,
              wasManualReschedule: false,
              wasFilteredDeck: false,
              sessionId: null,
              deviceId: 'device-paired',
              deviceSeq: 10,
              schedulerContext: {},
            },
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const preset = getDefaultPreset();
    const anchor = buildAnchorCard();
    const expectedReview = scheduleReview(anchor, 'good', preset, new Date('2026-01-01T10:00:00.000Z'));
    const expected = { ...anchor, ...expectedReview.card, updatedAt: '2026-01-01T10:00:00.000Z' };

    const card = getCardRow();
    expect(card.due_at).toBe(expected.dueAt);
    expect(card.due_at).not.toBe(bogusDueAt);
    expect(card.state).toBe(expected.state);
    expect(card.stability).toBe(expected.stability);
    expect(card.difficulty).toBe(expected.difficulty);
    expect(card.reps).toBe(expected.reps);
    expect(card.lapses).toBe(expected.lapses);
    expect(card.learning_steps).toBe(expected.learningSteps);
    expect(card.last_review_at).toBe(expected.lastReviewAt);
  });

  it('sync push applies explicit card commands without generic card updates', async () => {
    await authenticateAsTestUser();
    const route = await import('@/app/api/sync/push/route');
    const buriedUntil = '2026-01-03T04:00:00.000Z';
    const manualDueAt = '2026-01-05T12:00:00.000Z';

    const response = await route.POST(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-device-id': 'device-commands',
      },
      body: JSON.stringify({
        operations: [
          {
            operationId: 'op-command-suspend',
            deviceId: 'device-commands',
            clientUpdatedAt: '2026-01-01T09:00:00.000Z',
            table: 'cardCommands',
            operation: 'create',
            recordId: 'cmd-suspend',
            data: {
              cardId: TEST_CARD_ID,
              command: 'suspend',
              payload: {},
              clientIssuedAt: '2026-01-01T09:00:00.000Z',
              offsetMeasuredAt: '2026-01-01T08:59:00.000Z',
              clockOffsetMs: 0,
              deviceId: 'device-commands',
              deviceSeq: 1,
              createdAt: '2026-01-01T09:00:00.000Z',
            },
          },
          {
            operationId: 'op-command-bury',
            deviceId: 'device-commands',
            clientUpdatedAt: '2026-01-01T09:05:00.000Z',
            table: 'cardCommands',
            operation: 'create',
            recordId: 'cmd-bury',
            data: {
              cardId: TEST_CARD_ID,
              command: 'bury',
              payload: { buriedUntil },
              clientIssuedAt: '2026-01-01T09:05:00.000Z',
              offsetMeasuredAt: '2026-01-01T09:04:00.000Z',
              clockOffsetMs: 0,
              deviceId: 'device-commands',
              deviceSeq: 2,
              createdAt: '2026-01-01T09:05:00.000Z',
            },
          },
          {
            operationId: 'op-command-reschedule',
            deviceId: 'device-commands',
            clientUpdatedAt: '2026-01-01T09:10:00.000Z',
            table: 'cardCommands',
            operation: 'create',
            recordId: 'cmd-reschedule',
            data: {
              cardId: TEST_CARD_ID,
              command: 'manual_reschedule',
              payload: { dueAt: manualDueAt },
              clientIssuedAt: '2026-01-01T09:10:00.000Z',
              offsetMeasuredAt: '2026-01-01T09:09:00.000Z',
              clockOffsetMs: 0,
              deviceId: 'device-commands',
              deviceSeq: 3,
              createdAt: '2026-01-01T09:10:00.000Z',
            },
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const card = getCardRow();
    expect(card.suspended).toBe(1);
    expect(card.buried_until).toBe(buriedUntil);
    expect(card.due_at).toBe(manualDueAt);
  });
});
