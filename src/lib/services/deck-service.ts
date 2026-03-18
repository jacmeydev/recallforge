// ============================================================================
// RecallForge — Deck Service
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import { CreateDeckSchema } from '@/lib/validation/schemas';
import type { Deck, DeckWithCounts, JSONObject } from '@/types';

export async function createDeck(
  userId: string,
  data: {
    name: string;
    description?: string;
    parentDeckId?: string | null;
    presetId?: string | null;
  }
): Promise<Deck> {
  const validated = CreateDeckSchema.parse(data);
  const deck: Deck = {
    id: generateId(),
    userId,
    name: validated.name,
    description: validated.description || '',
    parentDeckId: validated.parentDeckId || null,
    sortOrder: 0,
    archived: false,
    presetId: validated.presetId || null,
    metadata: {},
    createdAt: now(),
    updatedAt: now(),
  };

  await db.decks.add(deck);
  await queueSync('decks', deck.id, 'create', deck as unknown as JSONObject);
  await EventEmitters.deckCreated(userId, deck.id, { name: deck.name });

  return deck;
}

export async function updateDeck(
  userId: string,
  deckId: string,
  data: Partial<Pick<Deck, 'name' | 'description' | 'parentDeckId' | 'sortOrder' | 'archived' | 'presetId' | 'metadata'>>
): Promise<Deck | undefined> {
  const updates = { ...data, updatedAt: now() };
  await db.decks.update(deckId, updates);
  await queueSync('decks', deckId, 'update', updates as unknown as JSONObject);
  await EventEmitters.deckUpdated(userId, deckId, { changes: Object.keys(data) as unknown as JSONObject });

  return db.decks.get(deckId);
}

export async function deleteDeck(userId: string, deckId: string): Promise<void> {
  // Move child decks to parent
  const deck = await db.decks.get(deckId);
  if (!deck) return;

  const children = await db.decks.where('parentDeckId').equals(deckId).toArray();
  for (const child of children) {
    await db.decks.update(child.id, { parentDeckId: deck.parentDeckId });
  }

  // Delete notes and cards in this deck
  const notes = await db.notes.where('deckId').equals(deckId).toArray();
  for (const note of notes) {
    const cards = await db.cards.where('noteId').equals(note.id).toArray();
    for (const card of cards) {
      await queueSync('cards', card.id, 'delete', {});
    }
    await db.cards.where('noteId').equals(note.id).delete();
    await queueSync('notes', note.id, 'delete', {});
  }
  await db.notes.where('deckId').equals(deckId).delete();

  await db.decks.delete(deckId);
  await queueSync('decks', deckId, 'delete', {});
}

export async function getDecks(userId: string): Promise<Deck[]> {
  return db.decks.where('userId').equals(userId).toArray();
}

export async function getDeck(deckId: string): Promise<Deck | undefined> {
  return db.decks.get(deckId);
}

export async function getDecksWithCounts(userId: string): Promise<DeckWithCounts[]> {
  const decks = await getDecks(userId);
  const today = new Date();

  const decksWithCounts: DeckWithCounts[] = await Promise.all(
    decks.map(async (deck) => {
      const cards = await db.cards
        .where('[userId+deckId+state]')
        .between([userId, deck.id, ''], [userId, deck.id, '\uffff'])
        .toArray();

      const newCount = cards.filter(c => c.state === 'new' && !c.suspended).length;
      const learningCount = cards.filter(
        c => (c.state === 'learning' || c.state === 'relearning') && !c.suspended
      ).length;
      const reviewCount = cards.filter(
        c => c.state === 'review' && !c.suspended && new Date(c.dueAt) <= today
      ).length;

      return {
        ...deck,
        newCount,
        learningCount,
        reviewCount,
        totalCount: cards.length,
      };
    })
  );

  return buildDeckTree(decksWithCounts);
}

function buildDeckTree(decks: DeckWithCounts[]): DeckWithCounts[] {
  const deckMap = new Map<string, DeckWithCounts>();
  const roots: DeckWithCounts[] = [];

  for (const deck of decks) {
    deckMap.set(deck.id, { ...deck, children: [] });
  }

  for (const deck of decks) {
    const node = deckMap.get(deck.id)!;
    if (deck.parentDeckId && deckMap.has(deck.parentDeckId)) {
      deckMap.get(deck.parentDeckId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // Aggregate counts from children
  function aggregate(node: DeckWithCounts): void {
    for (const child of node.children || []) {
      aggregate(child);
      node.newCount += child.newCount;
      node.learningCount += child.learningCount;
      node.reviewCount += child.reviewCount;
      node.totalCount += child.totalCount;
    }
  }

  for (const root of roots) aggregate(root);

  return roots;
}

export async function getSubdeckIds(deckId: string): Promise<string[]> {
  const ids: string[] = [deckId];
  const children = await db.decks.where('parentDeckId').equals(deckId).toArray();
  for (const child of children) {
    ids.push(...await getSubdeckIds(child.id));
  }
  return ids;
}
