// ============================================================================
// RecallForge — Card Service
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import { getClockSyncSnapshot } from '@/lib/sync/clock';
import { getClientDeviceId, nextDeviceSequence } from '@/lib/sync/device';
import type { Card, ReviewLog, CardCommand, CardCommandType, JSONObject, Flag } from '@/types';

async function queueCardCommand(
  userId: string,
  cardId: string,
  command: CardCommandType,
  payload: JSONObject,
  issuedAt = now()
): Promise<CardCommand> {
  const deviceId = getClientDeviceId();
  const deviceSeq = nextDeviceSequence();
  const { clockOffsetMs, offsetMeasuredAt } = getClockSyncSnapshot();

  const cardCommand: CardCommand = {
    id: generateId(),
    userId,
    cardId,
    command,
    payload,
    clientIssuedAt: issuedAt,
    serverReceivedAt: null,
    effectiveAt: issuedAt,
    offsetMeasuredAt,
    timeSource: clockOffsetMs !== null && offsetMeasuredAt ? 'client' : 'server',
    deviceId,
    deviceSeq,
    clockOffsetMs,
    createdAt: issuedAt,
  };

  await db.cardCommands.add(cardCommand);
  await queueSync('cardCommands', cardCommand.id, 'create', cardCommand as unknown as JSONObject);
  return cardCommand;
}

// ─── Get cards ─────────────────────────────────────────────────────────────

export async function getCards(
  userId: string,
  options?: {
    deckId?: string;
    state?: string;
    suspended?: boolean;
    limit?: number;
  }
): Promise<Card[]> {
  let results: Card[];

  if (options?.deckId) {
    results = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, options.deckId, ''], [userId, options.deckId, '\uffff'])
      .toArray();
  } else {
    results = await db.cards.where('userId').equals(userId).toArray();
  }

  if (options?.state) {
    results = results.filter(c => c.state === options.state);
  }
  if (options?.suspended !== undefined) {
    results = results.filter(c => c.suspended === options.suspended);
  }
  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

export async function getCard(cardId: string): Promise<Card | undefined> {
  return db.cards.get(cardId);
}

// ─── Get study queue ───────────────────────────────────────────────────────

export async function getStudyQueue(
  userId: string,
  deckId: string,
  limits: { newCards: number; reviews: number }
): Promise<{ newCards: Card[]; learningCards: Card[]; reviewCards: Card[] }> {
  const today = new Date();

  // Collect cards from this deck AND all child decks
  const deckIds = [deckId];
  const allDecks = await db.decks.where('userId').equals(userId).toArray();
  const addChildren = (parentId: string) => {
    for (const d of allDecks) {
      if (d.parentDeckId === parentId) {
        deckIds.push(d.id);
        addChildren(d.id);
      }
    }
  };
  addChildren(deckId);

  let allCards: Card[] = [];
  for (const did of deckIds) {
    const cards = await db.cards
      .where('[userId+deckId+state]')
      .between([userId, did, ''], [userId, did, '\uffff'])
      .toArray();
    allCards = allCards.concat(cards);
  }

  const active = allCards.filter(c => !c.suspended && (!c.buriedUntil || new Date(c.buriedUntil) <= today));

  const newCards = active
    .filter(c => c.state === 'new')
    .slice(0, limits.newCards);

  const learningCards = active
    .filter(c =>
      (c.state === 'learning' || c.state === 'relearning') &&
      new Date(c.dueAt) <= today
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const reviewCards = active
    .filter(c => c.state === 'review' && new Date(c.dueAt) <= today)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, limits.reviews);

  return { newCards, learningCards, reviewCards };
}

// ─── Update card after review ──────────────────────────────────────────────

export async function updateCardAfterReview(
  card: Card,
  updates: Partial<Card>,
  reviewLog: Omit<ReviewLog, 'id'>
): Promise<{ card: Card; reviewLog: ReviewLog }> {
  const updatedCard = { ...card, ...updates, updatedAt: now() };
  const log: ReviewLog = {
    id: generateId(),
    ...reviewLog,
  };

  await db.transaction('rw', [db.cards, db.reviewLogs], async () => {
    await db.cards.put(updatedCard);
    await db.reviewLogs.add(log);
  });

  await queueSync('cards', card.id, 'update', updates as unknown as JSONObject);
  await queueSync('reviewLogs', log.id, 'create', log as unknown as JSONObject);

  return { card: updatedCard, reviewLog: log };
}

// ─── Suspend / Unsuspend ───────────────────────────────────────────────────

export async function suspendCard(userId: string, cardId: string): Promise<void> {
  const updatedAt = now();
  await db.cards.update(cardId, { suspended: true, updatedAt });
  await queueCardCommand(userId, cardId, 'suspend', {});
  await EventEmitters.cardSuspended(userId, cardId);
}

export async function unsuspendCard(userId: string, cardId: string): Promise<void> {
  const updatedAt = now();
  await db.cards.update(cardId, { suspended: false, updatedAt });
  await queueCardCommand(userId, cardId, 'unsuspend', {});
  await EventEmitters.cardUnsuspended(userId, cardId);
}

// ─── Bury ──────────────────────────────────────────────────────────────────

export async function buryCard(userId: string, cardId: string): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(4, 0, 0, 0);
  const buriedUntil = tomorrow.toISOString();
  const updatedAt = now();

  await db.cards.update(cardId, {
    buriedUntil,
    updatedAt,
  });
  await queueCardCommand(userId, cardId, 'bury', { buriedUntil, reason: 'manual' });
  await EventEmitters.cardBuried(userId, cardId);
}

export async function unburyCards(userId: string): Promise<number> {
  const today = new Date().toISOString();
  const buried = await db.cards
    .where('userId')
    .equals(userId)
    .filter(c => c.buriedUntil !== null && c.buriedUntil! <= today)
    .toArray();

  for (const card of buried) {
    const updatedAt = now();
    await db.cards.update(card.id, { buriedUntil: null, updatedAt });
    await queueCardCommand(userId, card.id, 'unbury', {});
  }

  return buried.length;
}

// ─── Bury siblings ─────────────────────────────────────────────────────────

export async function burySiblings(
  userId: string,
  noteId: string,
  excludeCardId: string
): Promise<void> {
  const siblings = await db.cards
    .where('noteId')
    .equals(noteId)
    .filter(c => c.id !== excludeCardId)
    .toArray();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(4, 0, 0, 0);

  for (const sibling of siblings) {
    const buriedUntil = tomorrow.toISOString();
    const updatedAt = now();
    await db.cards.update(sibling.id, {
      buriedUntil,
      updatedAt,
    });
    await queueCardCommand(userId, sibling.id, 'bury', { buriedUntil, reason: 'sibling' });
  }
}

// ─── Set due date ──────────────────────────────────────────────────────────

export async function setDueDate(cardId: string, dueAt: string): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card) return;

  const updatedAt = now();
  await db.cards.update(cardId, { dueAt, updatedAt });
  await queueCardCommand(card.userId, cardId, 'manual_reschedule', { dueAt });
}

// ─── Reset card (relearn) ──────────────────────────────────────────────────

export async function resetCard(cardId: string): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card) return;

  const dueAt = new Date().toISOString();
  const updatedAt = now();
  await db.cards.update(cardId, {
    state: 'new',
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    retrievability: 0,
    lastReviewAt: null,
    dueAt,
    updatedAt,
  });
  await queueCardCommand(card.userId, cardId, 'reset', { dueAt });
}

// ─── Flag card ─────────────────────────────────────────────────────────────

export async function flagCard(
  userId: string,
  cardId: string,
  color: Flag['color'],
  label?: string
): Promise<void> {
  const existing = await db.flags.where('cardId').equals(cardId).first();
  if (existing) {
    await db.flags.update(existing.id, { color, label });
  } else {
    await db.flags.add({
      id: generateId(),
      userId,
      cardId,
      color,
      label,
    });
  }
}

export async function unflagCard(cardId: string): Promise<void> {
  const existing = await db.flags.where('cardId').equals(cardId).first();
  if (existing) {
    await db.flags.delete(existing.id);
  }
}

// ─── Get review history ───────────────────────────────────────────────────

export async function getReviewHistory(
  cardId: string,
  limit: number = 50
): Promise<ReviewLog[]> {
  return db.reviewLogs
    .where('cardId')
    .equals(cardId)
    .reverse()
    .limit(limit)
    .toArray();
}

// ─── Bulk operations ───────────────────────────────────────────────────────

export async function bulkSuspend(cardIds: string[]): Promise<void> {
  for (const id of cardIds) {
    const card = await db.cards.get(id);
    if (!card) continue;
    await db.cards.update(id, { suspended: true, updatedAt: now() });
    await queueCardCommand(card.userId, id, 'suspend', {});
  }
}

export async function bulkUnsuspend(cardIds: string[]): Promise<void> {
  for (const id of cardIds) {
    const card = await db.cards.get(id);
    if (!card) continue;
    await db.cards.update(id, { suspended: false, updatedAt: now() });
    await queueCardCommand(card.userId, id, 'unsuspend', {});
  }
}

export async function bulkMoveDeck(cardIds: string[], deckId: string): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    for (const id of cardIds) {
      await db.cards.update(id, { deckId, updatedAt: now() });
    }
  });
}
