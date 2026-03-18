import { calculateRetrievability, createNewFSRSCard, getDefaultPreset, scheduleReview } from '@/lib/fsrs';
import { logger } from '@/lib/server/logger';
import type { Card, CardCommandType, JSONObject, SchedulingPreset } from '@/types';
import { sqlite } from '@/lib/server/db';

const OFFSET_FRESHNESS_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const MAX_DEVICE_SEQ = Number.MAX_SAFE_INTEGER;

interface ServerCardRow {
  id: string;
  user_id: string;
  note_id: string;
  template_id: string;
  deck_id: string;
  due_at: string;
  state: Card['state'];
  queue_position: number;
  stability: number;
  difficulty: number;
  retrievability: number | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  last_review_at: string | null;
  suspended: number;
  buried_until: string | null;
  custom_data: string;
  created_at: string;
  updated_at: string;
  deck_preset_id: string | null;
}

interface ServerPresetRow {
  id: string;
  user_id: string;
  name: string;
  desired_retention: number;
  learning_steps: string;
  relearning_steps: string;
  maximum_interval: number;
  enable_fuzz: number;
  bury_new_siblings: number;
  bury_review_siblings: number;
  new_card_order: SchedulingPreset['newCardOrder'];
  review_order: SchedulingPreset['reviewOrder'];
  daily_limits: string;
  fsrs_parameters: string;
  optimizer_metadata: string;
  created_at: string;
  updated_at: string;
}

interface ServerReviewLogRow {
  id: string;
  user_id: string;
  card_id: string;
  reviewed_at: string;
  client_reviewed_at: string | null;
  server_received_at: string | null;
  effective_reviewed_at: string | null;
  offset_measured_at: string | null;
  time_source: string | null;
  rating: 'again' | 'hard' | 'good' | 'easy';
  previous_state: Card['state'];
  next_state: Card['state'];
  previous_due_at: string;
  next_due_at: string;
  previous_stability: number;
  next_stability: number;
  previous_difficulty: number;
  next_difficulty: number;
  response_time_ms: number;
  was_manual_reschedule: number;
  was_filtered_deck: number;
  session_id: string | null;
  device_id: string | null;
  device_seq: number | null;
  clock_offset_ms: number | null;
  replay_ordinal: number | null;
  scheduler_context: string | null;
  created_at: string;
}

interface ServerCardCommandRow {
  id: string;
  user_id: string;
  card_id: string;
  command: CardCommandType;
  payload: string;
  client_issued_at: string | null;
  server_received_at: string | null;
  effective_at: string | null;
  offset_measured_at: string | null;
  time_source: string | null;
  device_id: string | null;
  device_seq: number | null;
  clock_offset_ms: number | null;
  created_at: string;
}

interface TimelineKey {
  effectiveAt: string;
  deviceId: string | null;
  deviceSeq: number | null;
  id: string;
}

export interface NormalizedReviewTiming {
  clientReviewedAt: string | null;
  serverReceivedAt: string;
  effectiveReviewedAt: string;
  reviewedAt: string;
  timeSource: 'client' | 'server' | 'clock_corrected';
  clockCorrected: boolean;
}

function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArrayNumber(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
}

function parseJsonArrayNumberString(value: string | null): number[] {
  if (!value) return [];
  try {
    return parseJsonArrayNumber(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function toBoolean(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1;
}

function laterIso(left: string | null | undefined, right: string | null | undefined): string {
  const a = typeof left === 'string' && left.length > 0 ? left : null;
  const b = typeof right === 'string' && right.length > 0 ? right : null;

  if (!a && !b) return new Date().toISOString();
  if (!a) return b!;
  if (!b) return a;
  return a >= b ? a : b;
}

function toCard(row: ServerCardRow): Card {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    templateId: row.template_id,
    deckId: row.deck_id,
    dueAt: row.due_at,
    state: row.state,
    queuePosition: row.queue_position,
    stability: row.stability,
    difficulty: row.difficulty,
    retrievability: row.retrievability ?? undefined,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learning_steps,
    lastReviewAt: row.last_review_at,
    suspended: toBoolean(row.suspended),
    buriedUntil: row.buried_until,
    customData: parseJsonObject(row.custom_data) as JSONObject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPreset(row: ServerPresetRow | undefined, userId: string): SchedulingPreset {
  if (!row) {
    return { ...getDefaultPreset(), userId };
  }

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    desiredRetention: row.desired_retention,
    learningSteps: parseJsonArrayNumberString(row.learning_steps),
    relearningSteps: parseJsonArrayNumberString(row.relearning_steps),
    maximumInterval: row.maximum_interval,
    enableFuzz: toBoolean(row.enable_fuzz),
    buryNewSiblings: toBoolean(row.bury_new_siblings),
    buryReviewSiblings: toBoolean(row.bury_review_siblings),
    newCardOrder: row.new_card_order,
    reviewOrder: row.review_order,
    dailyLimits: parseJsonObject(row.daily_limits) as SchedulingPreset['dailyLimits'],
    fsrsParameters: parseJsonArrayNumberString(row.fsrs_parameters),
    optimizerMetadata: parseJsonObject(row.optimizer_metadata) as JSONObject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildReplayAnchor(row: ServerCardRow): Card {
  const defaults = createNewFSRSCard();
  return {
    ...toCard(row),
    dueAt: row.created_at || defaults.dueAt || row.due_at,
    state: 'new',
    stability: 0,
    difficulty: 0,
    retrievability: undefined,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    lastReviewAt: null,
    updatedAt: row.updated_at,
  };
}

function getReviewLogTimelineKey(reviewLog: ServerReviewLogRow): TimelineKey {
  return {
    effectiveAt:
      reviewLog.effective_reviewed_at ??
      reviewLog.server_received_at ??
      reviewLog.client_reviewed_at ??
      reviewLog.reviewed_at ??
      reviewLog.created_at,
    deviceId: reviewLog.device_id,
    deviceSeq: reviewLog.device_seq,
    id: reviewLog.id,
  };
}

function getCardCommandTimelineKey(command: ServerCardCommandRow): TimelineKey {
  return {
    effectiveAt:
      command.effective_at ??
      command.server_received_at ??
      command.client_issued_at ??
      command.created_at,
    deviceId: command.device_id,
    deviceSeq: command.device_seq,
    id: command.id,
  };
}

function compareTimelineKeys(left: TimelineKey, right: TimelineKey): number {
  const leftTime = left.effectiveAt;
  const rightTime = right.effectiveAt;
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  const deviceCompare = (left.deviceId ?? '').localeCompare(right.deviceId ?? '');
  if (deviceCompare !== 0) {
    return deviceCompare;
  }

  const leftSeq = left.deviceSeq ?? MAX_DEVICE_SEQ;
  const rightSeq = right.deviceSeq ?? MAX_DEVICE_SEQ;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return left.id.localeCompare(right.id);
}

function applyResetCommand(baseCard: Card, command: ServerCardCommandRow): Card {
  const payload = parseJsonObject(command.payload);
  const key = getCardCommandTimelineKey(command);
  const dueAt = typeof payload.dueAt === 'string' && payload.dueAt.length > 0
    ? payload.dueAt
    : key.effectiveAt;

  return {
    ...baseCard,
    dueAt,
    state: 'new',
    stability: 0,
    difficulty: 0,
    retrievability: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    lastReviewAt: null,
    updatedAt: laterIso(baseCard.updatedAt, key.effectiveAt),
  };
}

function applyManualRescheduleCommand(card: Card, command: ServerCardCommandRow): Card {
  const payload = parseJsonObject(command.payload);
  const key = getCardCommandTimelineKey(command);
  const dueAt = typeof payload.dueAt === 'string' && payload.dueAt.length > 0
    ? payload.dueAt
    : card.dueAt;

  return {
    ...card,
    dueAt,
    updatedAt: laterIso(card.updatedAt, key.effectiveAt),
  };
}

function applySuspendCommand(card: Card, command: ServerCardCommandRow): Card {
  const key = getCardCommandTimelineKey(command);
  return {
    ...card,
    suspended: command.command === 'suspend',
    updatedAt: laterIso(card.updatedAt, key.effectiveAt),
  };
}

function applyBurialCommand(card: Card, command: ServerCardCommandRow): Card {
  const payload = parseJsonObject(command.payload);
  const key = getCardCommandTimelineKey(command);
  return {
    ...card,
    buriedUntil:
      command.command === 'bury' && typeof payload.buriedUntil === 'string' && payload.buriedUntil.length > 0
        ? payload.buriedUntil
        : null,
    updatedAt: laterIso(card.updatedAt, key.effectiveAt),
  };
}

function resolvePresetFromSnapshot(
  userId: string,
  deckPresetId: string | null,
  schedulerContext: Record<string, unknown>,
  presetCache: Map<string, SchedulingPreset>
): SchedulingPreset {
  const requestedPresetId =
    typeof schedulerContext.presetId === 'string' && schedulerContext.presetId.length > 0
      ? schedulerContext.presetId
      : deckPresetId;

  if (requestedPresetId && presetCache.has(requestedPresetId)) {
    return mergePresetSnapshot(presetCache.get(requestedPresetId)!, schedulerContext, userId);
  }

  if (requestedPresetId) {
    const presetRow = sqlite.prepare(`
      SELECT *
      FROM presets
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(requestedPresetId, userId) as ServerPresetRow | undefined;
    const hydrated = toPreset(presetRow, userId);
    presetCache.set(requestedPresetId, hydrated);
    return mergePresetSnapshot(hydrated, schedulerContext, userId);
  }

  return mergePresetSnapshot({ ...getDefaultPreset(), userId }, schedulerContext, userId);
}

function mergePresetSnapshot(
  basePreset: SchedulingPreset,
  schedulerContext: Record<string, unknown>,
  userId: string
): SchedulingPreset {
  return {
    ...basePreset,
    userId,
    id: typeof schedulerContext.presetId === 'string' ? schedulerContext.presetId : basePreset.id,
    desiredRetention:
      typeof schedulerContext.desiredRetention === 'number'
        ? schedulerContext.desiredRetention
        : basePreset.desiredRetention,
    maximumInterval:
      typeof schedulerContext.maximumInterval === 'number'
        ? schedulerContext.maximumInterval
        : basePreset.maximumInterval,
    enableFuzz:
      typeof schedulerContext.enableFuzz === 'boolean'
        ? schedulerContext.enableFuzz
        : basePreset.enableFuzz,
    fsrsParameters: Array.isArray(schedulerContext.fsrsParameters)
      ? parseJsonArrayNumber(schedulerContext.fsrsParameters)
      : basePreset.fsrsParameters,
    learningSteps: Array.isArray(schedulerContext.learningSteps)
      ? parseJsonArrayNumber(schedulerContext.learningSteps)
      : basePreset.learningSteps,
    relearningSteps: Array.isArray(schedulerContext.relearningSteps)
      ? parseJsonArrayNumber(schedulerContext.relearningSteps)
      : basePreset.relearningSteps,
  };
}

export function computeEffectiveReviewTiming(input: {
  clientReviewedAt?: string | null;
  clockOffsetMs?: number | null;
  offsetMeasuredAt?: string | null;
  serverReceivedAt?: string;
}): NormalizedReviewTiming {
  const serverReceivedAt = input.serverReceivedAt ?? new Date().toISOString();
  const serverTime = parseIso(serverReceivedAt) ?? new Date();
  const clientReviewedAt = parseIso(input.clientReviewedAt);
  const offsetMeasuredAt = parseIso(input.offsetMeasuredAt);
  const clockOffsetMs = typeof input.clockOffsetMs === 'number' && Number.isFinite(input.clockOffsetMs)
    ? input.clockOffsetMs
    : null;

  let effective = serverTime;
  let timeSource: NormalizedReviewTiming['timeSource'] = 'server';

  if (clientReviewedAt && clockOffsetMs !== null && offsetMeasuredAt) {
    const offsetAgeMs = clientReviewedAt.getTime() - offsetMeasuredAt.getTime();
    const normalized = new Date(clientReviewedAt.getTime() + clockOffsetMs);

    if (offsetAgeMs >= 0 && offsetAgeMs <= OFFSET_FRESHNESS_MS && normalized.getTime() <= serverTime.getTime() + MAX_FUTURE_SKEW_MS) {
      effective = normalized;
      timeSource = 'client';
    } else {
      timeSource = 'clock_corrected';
    }
  } else if (clientReviewedAt) {
    timeSource = 'clock_corrected';
  }

  return {
    clientReviewedAt: clientReviewedAt?.toISOString() ?? null,
    serverReceivedAt: serverTime.toISOString(),
    effectiveReviewedAt: effective.toISOString(),
    reviewedAt: effective.toISOString(),
    timeSource,
    clockCorrected: timeSource === 'clock_corrected',
  };
}

function getOrderedReviewLogs(userId: string, cardId: string): ServerReviewLogRow[] {
  return sqlite.prepare(`
    SELECT *
    FROM review_logs
    WHERE user_id = ? AND card_id = ?
    ORDER BY
      COALESCE(effective_reviewed_at, server_received_at, client_reviewed_at, reviewed_at, created_at) ASC,
      COALESCE(device_id, '') ASC,
      COALESCE(device_seq, ${MAX_DEVICE_SEQ}) ASC,
      id ASC
  `).all(userId, cardId) as ServerReviewLogRow[];
}

function getOrderedCardCommands(userId: string, cardId: string): ServerCardCommandRow[] {
  return sqlite.prepare(`
    SELECT *
    FROM card_commands
    WHERE user_id = ? AND card_id = ?
    ORDER BY
      COALESCE(effective_at, server_received_at, client_issued_at, created_at) ASC,
      COALESCE(device_id, '') ASC,
      COALESCE(device_seq, ${MAX_DEVICE_SEQ}) ASC,
      id ASC
  `).all(userId, cardId) as ServerCardCommandRow[];
}

export function replayCardReviews(userId: string, cardId: string): { appliedLogs: number; finalCard: Card | null } {
  const log = logger.withContext({ userId, cardId, component: 'review-replay' });
  const cardRow = sqlite.prepare(`
    SELECT c.*, d.preset_id AS deck_preset_id
    FROM cards c
    LEFT JOIN decks d ON d.id = c.deck_id AND d.user_id = c.user_id
    WHERE c.user_id = ? AND c.id = ? AND c.deleted_at IS NULL
    LIMIT 1
  `).get(userId, cardId) as ServerCardRow | undefined;

  if (!cardRow) {
    return { appliedLogs: 0, finalCard: null };
  }

  const logs = getOrderedReviewLogs(userId, cardId);
  const commands = getOrderedCardCommands(userId, cardId);
  if (logs.length === 0 && commands.length === 0) {
    return { appliedLogs: 0, finalCard: toCard(cardRow) };
  }

  const updateLog = sqlite.prepare(`
    UPDATE review_logs
    SET reviewed_at = ?,
        effective_reviewed_at = ?,
        previous_state = ?,
        next_state = ?,
        previous_due_at = ?,
        next_due_at = ?,
        previous_stability = ?,
        next_stability = ?,
        previous_difficulty = ?,
        next_difficulty = ?,
        replay_ordinal = ?,
        scheduler_context = ?
    WHERE id = ?
  `);

  const baseAnchor = buildReplayAnchor(cardRow);
  let workingCard = baseAnchor;
  const presetCache = new Map<string, SchedulingPreset>();
  const latestReset = [...commands].reverse().find((command) => command.command === 'reset');
  const anchorKey = latestReset
    ? getCardCommandTimelineKey(latestReset)
    : {
        effectiveAt: cardRow.created_at,
        deviceId: null,
        deviceSeq: null,
        id: cardId,
      };

  if (latestReset) {
    workingCard = applyResetCommand(baseAnchor, latestReset);
  }

  const logsToApply = logs.filter((reviewLog) => compareTimelineKeys(getReviewLogTimelineKey(reviewLog), anchorKey) > 0);
  let ordinal = 0;
  let orderChanged = false;
  let lastSchedulingKey = anchorKey;

  for (const reviewLog of logsToApply) {
    ordinal += 1;
    const schedulerContext = parseJsonObject(reviewLog.scheduler_context);
    const logKey = getReviewLogTimelineKey(reviewLog);
    const effectiveDate = parseIso(logKey.effectiveAt) ?? new Date(reviewLog.created_at);
    const preset = resolvePresetFromSnapshot(userId, cardRow.deck_preset_id, schedulerContext, presetCache);
    const replayResult = scheduleReview(workingCard, reviewLog.rating, preset, effectiveDate);

    const nextCard: Card = {
      ...workingCard,
      ...replayResult.card,
      updatedAt: effectiveDate.toISOString(),
    };

    updateLog.run(
      effectiveDate.toISOString(),
      effectiveDate.toISOString(),
      replayResult.log.previousState,
      replayResult.log.nextState,
      replayResult.log.previousDueAt,
      replayResult.log.nextDueAt,
      replayResult.log.previousStability,
      replayResult.log.nextStability,
      replayResult.log.previousDifficulty,
      replayResult.log.nextDifficulty,
      ordinal,
      JSON.stringify({
        ...schedulerContext,
        presetId: preset.id,
        desiredRetention: preset.desiredRetention,
        maximumInterval: preset.maximumInterval,
        enableFuzz: preset.enableFuzz,
        fsrsParameters: preset.fsrsParameters,
        learningSteps: preset.learningSteps,
        relearningSteps: preset.relearningSteps,
      }),
      reviewLog.id
    );

    if (reviewLog.replay_ordinal !== null && reviewLog.replay_ordinal !== ordinal) {
      orderChanged = true;
    }

    workingCard = nextCard;
    lastSchedulingKey = logKey;
  }

  const latestManualReschedule = [...commands].reverse().find((command) =>
    command.command === 'manual_reschedule' &&
    compareTimelineKeys(getCardCommandTimelineKey(command), lastSchedulingKey) > 0
  );

  if (latestManualReschedule) {
    workingCard = applyManualRescheduleCommand(workingCard, latestManualReschedule);
  }

  const latestSuspension = [...commands].reverse().find((command) =>
    command.command === 'suspend' || command.command === 'unsuspend'
  );

  if (latestSuspension) {
    workingCard = applySuspendCommand(workingCard, latestSuspension);
  }

  const latestBurial = [...commands].reverse().find((command) =>
    command.command === 'bury' || command.command === 'unbury'
  );

  if (latestBurial) {
    workingCard = applyBurialCommand(workingCard, latestBurial);
  }

  sqlite.prepare(`
    UPDATE cards
    SET due_at = ?,
        state = ?,
        stability = ?,
        difficulty = ?,
        retrievability = ?,
        elapsed_days = ?,
        scheduled_days = ?,
        reps = ?,
        lapses = ?,
        learning_steps = ?,
        last_review_at = ?,
        suspended = ?,
        buried_until = ?,
        updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    workingCard.dueAt,
    workingCard.state,
    workingCard.stability,
    workingCard.difficulty,
    calculateRetrievability(workingCard, new Date()),
    workingCard.elapsedDays,
    workingCard.scheduledDays,
    workingCard.reps,
    workingCard.lapses,
    workingCard.learningSteps,
    workingCard.lastReviewAt,
    workingCard.suspended ? 1 : 0,
    workingCard.buriedUntil,
    workingCard.updatedAt,
    cardId,
    userId
  );

  if (orderChanged) {
    log.warn('Review log replay order changed', { appliedLogs: logsToApply.length });
  }

  return { appliedLogs: logsToApply.length, finalCard: workingCard };
}

export function replayCardsForUser(userId: string, cardIds: Iterable<string>) {
  const uniqueCardIds = [...new Set(cardIds)].filter((cardId) => cardId.length > 0);
  let replayedCards = 0;
  let replayedLogs = 0;

  for (const cardId of uniqueCardIds) {
    const result = replayCardReviews(userId, cardId);
    if (result.finalCard) {
      replayedCards += 1;
      replayedLogs += result.appliedLogs;
    }
  }

  if (replayedCards > 0) {
    logger.metric('review_replay_cards', replayedCards, { userId, replayedLogs });
  }

  return {
    replayedCards,
    replayedLogs,
  };
}
