// ============================================================================
// RecallForge — Browser Search Parser
// ============================================================================
// Parses Anki-style search queries into structured filters.
// Supports: deck:, tag:, note:, is:, prop:, flagged:, AND, OR, NOT, parens
// ============================================================================

import { db } from '@/lib/db';
import type { Card, Note } from '@/types';

export interface SearchToken {
  type: 'deck' | 'tag' | 'note' | 'is' | 'prop' | 'flagged' | 'text' | 'and' | 'or' | 'not' | 'lparen' | 'rparen';
  value: string;
  operator?: string;
  propValue?: number;
}

// ─── Tokenize search query ──────────────────────────────────────────────

export function tokenize(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const regex = /(\(|\)|AND|OR|NOT|-)|deck:"([^"]+)"|deck:(\S+)|tag:"([^"]+)"|tag:(\S+)|note:"([^"]+)"|note:(\S+)|is:(\w+)|prop:(\w+)(>=|<=|>|<|=)(\d+(?:\.\d+)?)|flagged:(\w+)|"([^"]+)"|(\S+)/gi;

  let match;
  while ((match = regex.exec(query)) !== null) {
    const [, boolOp, deckQuoted, deck, tagQuoted, tag, noteQuoted, note, isVal, propField, propOp, propVal, flagVal, quotedText, word] = match;

    if (boolOp) {
      if (boolOp === '(' ) tokens.push({ type: 'lparen', value: '(' });
      else if (boolOp === ')') tokens.push({ type: 'rparen', value: ')' });
      else if (boolOp.toUpperCase() === 'AND') tokens.push({ type: 'and', value: 'AND' });
      else if (boolOp.toUpperCase() === 'OR') tokens.push({ type: 'or', value: 'OR' });
      else if (boolOp === '-' || boolOp.toUpperCase() === 'NOT') tokens.push({ type: 'not', value: 'NOT' });
    } else if (deckQuoted || deck) {
      tokens.push({ type: 'deck', value: deckQuoted || deck });
    } else if (tagQuoted || tag) {
      tokens.push({ type: 'tag', value: tagQuoted || tag });
    } else if (noteQuoted || note) {
      tokens.push({ type: 'note', value: noteQuoted || note });
    } else if (isVal) {
      tokens.push({ type: 'is', value: isVal.toLowerCase() });
    } else if (propField && propOp && propVal) {
      tokens.push({ type: 'prop', value: propField, operator: propOp, propValue: parseFloat(propVal) });
    } else if (flagVal) {
      tokens.push({ type: 'flagged', value: flagVal });
    } else if (quotedText) {
      tokens.push({ type: 'text', value: quotedText });
    } else if (word) {
      tokens.push({ type: 'text', value: word });
    }
  }

  return tokens;
}

// ─── Execute search ─────────────────────────────────────────────────────

export async function searchCards(
  userId: string,
  query: string
): Promise<Card[]> {
  if (!query.trim()) {
    return db.cards.where('userId').equals(userId).toArray();
  }

  const tokens = tokenize(query);
  let cards = await db.cards.where('userId').equals(userId).toArray();

  // Apply filters
  for (const token of tokens) {
    switch (token.type) {
      case 'deck': {
        const deckName = token.value.toLowerCase();
        const decks = await db.decks.where('userId').equals(userId).toArray();
        const matchingDeckIds = decks
          .filter(d => d.name.toLowerCase().includes(deckName))
          .map(d => d.id);
        cards = cards.filter(c => matchingDeckIds.includes(c.deckId));
        break;
      }

      case 'tag': {
        const tagName = token.value.toLowerCase();
        const noteIds = new Set(
          (await db.notes.where('userId').equals(userId)
            .filter(n => n.tags.some(t => t.toLowerCase().includes(tagName)))
            .toArray()
          ).map(n => n.id)
        );
        cards = cards.filter(c => noteIds.has(c.noteId));
        break;
      }

      case 'note': {
        const noteTypeName = token.value.toLowerCase();
        const noteTypes = await db.noteTypes.where('userId').equals(userId).toArray();
        const matchingTypeIds = noteTypes
          .filter(nt => nt.name.toLowerCase().includes(noteTypeName))
          .map(nt => nt.id);
        const noteIds = new Set(
          (await db.notes.where('userId').equals(userId)
            .filter(n => matchingTypeIds.includes(n.noteTypeId))
            .toArray()
          ).map(n => n.id)
        );
        cards = cards.filter(c => noteIds.has(c.noteId));
        break;
      }

      case 'is': {
        switch (token.value) {
          case 'due':
            cards = cards.filter(c => new Date(c.dueAt) <= new Date() && !c.suspended);
            break;
          case 'new':
            cards = cards.filter(c => c.state === 'new');
            break;
          case 'review':
            cards = cards.filter(c => c.state === 'review');
            break;
          case 'learning':
            cards = cards.filter(c => c.state === 'learning' || c.state === 'relearning');
            break;
          case 'suspended':
            cards = cards.filter(c => c.suspended);
            break;
          case 'buried':
            cards = cards.filter(c => c.buriedUntil !== null);
            break;
          case 'leech':
            cards = cards.filter(c => c.lapses >= 8);
            break;
        }
        break;
      }

      case 'prop': {
        const val = token.propValue!;
        const op = token.operator!;
        cards = cards.filter(c => {
          let cardVal: number;
          switch (token.value) {
            case 'lapses': cardVal = c.lapses; break;
            case 'reps': cardVal = c.reps; break;
            case 'ivl': cardVal = c.scheduledDays; break;
            case 'stability': cardVal = c.stability; break;
            case 'difficulty': cardVal = c.difficulty; break;
            default: return true;
          }
          switch (op) {
            case '>': return cardVal > val;
            case '<': return cardVal < val;
            case '>=': return cardVal >= val;
            case '<=': return cardVal <= val;
            case '=': return cardVal === val;
            default: return true;
          }
        });
        break;
      }

      case 'flagged': {
        const flags = await db.flags.where('userId').equals(userId).toArray();
        if (token.value === 'any') {
          const flaggedCardIds = new Set(flags.map(f => f.cardId));
          cards = cards.filter(c => flaggedCardIds.has(c.id));
        } else {
          const flaggedCardIds = new Set(
            flags.filter(f => f.color === token.value).map(f => f.cardId)
          );
          cards = cards.filter(c => flaggedCardIds.has(c.id));
        }
        break;
      }

      case 'text': {
        const searchText = token.value.toLowerCase();
        const matchingNotes = await db.notes
          .where('userId')
          .equals(userId)
          .filter(n =>
            Object.values(n.fieldValues).some(v =>
              v.toLowerCase().includes(searchText)
            )
          )
          .toArray();
        const noteIds = new Set(matchingNotes.map(n => n.id));
        cards = cards.filter(c => noteIds.has(c.noteId));
        break;
      }
    }
  }

  return cards;
}

// ─── Search notes ──────────────────────────────────────────────────────

export async function searchNotes(
  userId: string,
  query: string
): Promise<Note[]> {
  const cards = await searchCards(userId, query);
  const noteIds = [...new Set(cards.map(c => c.noteId))];
  const notes: Note[] = [];

  for (const noteId of noteIds) {
    const note = await db.notes.get(noteId);
    if (note) notes.push(note);
  }

  return notes;
}
