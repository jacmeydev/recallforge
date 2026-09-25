// ============================================================================
// RecallForge — MCP server (tools + study protocol for any MCP-capable agent)
// ============================================================================
// Built per request for the authenticated learner (stateless Streamable HTTP).
// Tool names and semantics mirror the REST API one-to-one.
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { addCards, deleteCards, searchCards, updateCard } from '@/lib/core/cards';
import { deleteDeck, listDecks, updateDeck } from '@/lib/core/decks';
import { AppError } from '@/lib/core/errors';
import { updateSettings } from '@/lib/core/settings';
import { getStats } from '@/lib/core/stats';
import { gradeCard, nextCard, revealCard } from '@/lib/core/study';
import type { AuthUser } from '@/lib/core/types';

export const MCP_SERVER_VERSION = '2.0.0';

export const STUDY_PROTOCOL = `RecallForge is the learner's spaced-repetition memory (FSRS scheduler). Use it to run active-recall study sessions and to turn study material into flashcards. Talk to the learner in their language.

STUDY SESSION
1. get_next_card (optionally filtered by deck or tag) returns only the question. Ask the learner the \`front\` text. You may rephrase lightly for flow, but never add hints, options or any part of the answer.
2. Wait for the learner's own attempt. Never answer for them. "I don't know" counts as a failed recall.
3. reveal_answer(card_id) returns the expected answer (\`back\`), the \`explanation\`, and \`recentAttempts\`. Judge meaning, not wording: equivalent phrasing is correct; missing a key element is not.
4. Give brief feedback: confirm what was right, correct what was wrong, add at most one useful detail from \`explanation\`. If \`recentAttempts\` shows the same mistake before, point it out.
5. grade_card with a rating:
   - again: wrong, blank, or only a fragment recalled
   - hard: correct but with long hesitation, prompting, or a small important omission
   - good: correct with normal effort (the default for correct answers)
   - easy: instant, complete and effortless
   Include user_answer (the learner's words) and a one-line feedback note; they are shown on future attempts. Pass the same deck/tag you used in get_next_card: the response contains the next question in \`next\`.
6. Continue with \`next.card\`. When it is null, relay \`next.message\` and close with a short summary (cards reviewed, what to revisit).
One question per message, keep the pace brisk. If the learner disputes your grade, re-grade with their rating (grading the same card again is fine).

CREATING CARDS
- One fact per card; the front must have a single unambiguous answer. Prefer questions that force recall (why/how/what/which) over yes/no. Split lists longer than ~4 items.
- Put the concise answer in \`back\`; context, mnemonics or clinical relevance in \`explanation\`; the reference (book, chapter, page, lecture) in \`source\`.
- Use one deck per subject (e.g. "Farmacología") and tags for topics. Tags can be hierarchical ("cardio::arritmias") and filters match by prefix.
- Search before adding many cards; a card whose front already exists in the same deck is skipped automatically.
- For large batches, show the learner the proposed cards first unless they asked you to add them directly.

PLANNING
get_stats gives due counts, today's progress, 30-day retention, streak, a 7-day forecast and the weakest cards (repeated failures). Use it to suggest what to study. Timestamps are UTC ISO-8601; the learner's timezone is in get_stats.settings.`;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(error: unknown): CallToolResult {
  const message =
    error instanceof AppError
      ? `${error.message}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`
      : 'Internal error';
  if (!(error instanceof AppError)) console.error('[recallforge] MCP tool error', error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function run(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

const deckRef = z.string().describe('Deck name (case-insensitive) or id');
const tagFilter = z.string().describe('Only cards with this tag (hierarchical prefix match: "cardio" also matches "cardio::arritmias")');
const rating = z.enum(['again', 'hard', 'good', 'easy']);

const cardShape = {
  front: z.string().describe('Question or prompt shown to the learner'),
  back: z.string().describe('Concise expected answer'),
  explanation: z.string().optional().describe('Context, reasoning, mnemonic or clinical relevance used for feedback'),
  source: z.string().optional().describe('Reference: book, chapter, page, lecture, URL'),
  tags: z.array(z.string()).optional().describe('Topic tags, e.g. ["cardio::arritmias", "farmaco"]'),
};

export function createMcpServer(user: AuthUser): McpServer {
  const server = new McpServer(
    { name: 'recallforge', title: 'RecallForge', version: MCP_SERVER_VERSION },
    { instructions: STUDY_PROTOCOL }
  );

  // ── Study ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_next_card',
    {
      title: 'Get next card',
      description:
        'Next card due for active recall. Returns only the question (front) plus remaining counts; the answer is withheld until reveal_answer. card is null when nothing is due (see message and nextDueAt).',
      inputSchema: { deck: deckRef.optional(), tag: tagFilter.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ deck, tag }) => run(() => nextCard(user.id, { deck, tag }))
  );

  server.registerTool(
    'reveal_answer',
    {
      title: 'Reveal answer',
      description:
        "Call after the learner has attempted the question. Returns the expected answer, explanation, source, the learner's recent attempts on this card, and when the card would be due again for each rating.",
      inputSchema: { card_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ card_id }) => run(() => revealCard(user.id, card_id))
  );

  server.registerTool(
    'grade_card',
    {
      title: 'Grade card',
      description:
        "Record how well the learner recalled a card and reschedule it with FSRS. Returns the new due date and the next question (for the same deck/tag filter) in `next`.",
      inputSchema: {
        card_id: z.string(),
        rating: rating.describe('again = failed, hard = recalled with difficulty, good = recalled, easy = effortless'),
        user_answer: z.string().optional().describe("The learner's answer, verbatim or summarized"),
        feedback: z.string().optional().describe('One-line note on what was right/wrong, shown on future attempts'),
        deck: deckRef.optional().describe('Filter for the next card (use the same as get_next_card)'),
        tag: tagFilter.optional(),
      },
    },
    ({ card_id, rating, user_answer, feedback, deck, tag }) =>
      run(() => ({
        result: gradeCard(user.id, card_id, { rating, answer: user_answer, feedback }, 'agent'),
        next: nextCard(user.id, { deck, tag }),
      }))
  );

  server.registerTool(
    'get_stats',
    {
      title: 'Get learning stats',
      description:
        "Learner progress: today's reviews and accuracy, due counts, card totals, 30-day retention, study streak, 7-day due forecast, weakest cards, and daily limits.",
      inputSchema: { deck: deckRef.optional(), tag: tagFilter.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ deck, tag }) => run(() => getStats(user.id, { deck, tag }))
  );

  // ── Cards ──────────────────────────────────────────────────────────────
  server.registerTool(
    'add_cards',
    {
      title: 'Add cards',
      description:
        'Create flashcards (up to 500 per call). Decks are created automatically. Cards whose front already exists in the same deck are skipped and reported.',
      inputSchema: {
        deck: z.string().optional().describe('Default deck for all cards (created if missing)'),
        cards: z
          .array(z.object({ ...cardShape, deck: z.string().optional().describe('Overrides the default deck') }))
          .min(1)
          .max(500),
      },
    },
    ({ deck, cards }) => run(() => addCards(user.id, { deck, cards }))
  );

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description:
        'Find cards (with answers) by text, deck, tag or state. Use it to check coverage before adding cards, or to find cards to edit. state "leech" = cards forgotten 4+ times.',
      inputSchema: {
        query: z.string().optional().describe('Text to look for in front, back, explanation or tags'),
        deck: deckRef.optional(),
        tag: tagFilter.optional(),
        state: z.enum(['new', 'learning', 'review', 'suspended', 'due', 'leech']).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => searchCards(user.id, args))
  );

  server.registerTool(
    'update_card',
    {
      title: 'Update card',
      description:
        'Edit a card (fix wording, improve the explanation, retag, move to another deck) or suspend/unsuspend it. Scheduling progress is kept.',
      inputSchema: {
        card_id: z.string(),
        front: cardShape.front.optional(),
        back: cardShape.back.optional(),
        explanation: cardShape.explanation,
        source: cardShape.source,
        tags: cardShape.tags.describe('Replaces all tags'),
        deck: z.string().optional().describe('Move to this deck (created if missing)'),
        suspended: z.boolean().optional().describe('Suspended cards are never asked'),
      },
    },
    ({ card_id, ...patch }) => run(() => ({ card: updateCard(user.id, card_id, patch) }))
  );

  server.registerTool(
    'delete_cards',
    {
      title: 'Delete cards',
      description: 'Permanently delete cards and their review history. Confirm with the learner first.',
      inputSchema: { card_ids: z.array(z.string()).min(1).max(500) },
      annotations: { destructiveHint: true },
    },
    ({ card_ids }) => run(() => deleteCards(user.id, card_ids))
  );

  // ── Decks & settings ───────────────────────────────────────────────────
  server.registerTool(
    'list_decks',
    {
      title: 'List decks',
      description: 'All decks with total, new, learning, review, suspended and due-today counts.',
      annotations: { readOnlyHint: true },
    },
    () => run(() => ({ decks: listDecks(user.id) }))
  );

  server.registerTool(
    'update_deck',
    {
      title: 'Rename deck',
      description: "Rename a deck or change its description.",
      inputSchema: { deck: deckRef, name: z.string().optional(), description: z.string().optional() },
    },
    ({ deck, name, description }) => run(() => ({ deck: updateDeck(user.id, deck, { name, description }) }))
  );

  server.registerTool(
    'delete_deck',
    {
      title: 'Delete deck',
      description: 'Permanently delete a deck with all its cards and history. Confirm with the learner first.',
      inputSchema: { deck: deckRef },
      annotations: { destructiveHint: true },
    },
    ({ deck }) => run(() => deleteDeck(user.id, deck))
  );

  server.registerTool(
    'update_settings',
    {
      title: 'Update study settings',
      description:
        'Change daily limits, target retention or timezone, e.g. when the learner wants more new cards today or is preparing for an exam.',
      inputSchema: {
        new_cards_per_day: z.number().int().min(0).max(9999).optional(),
        max_reviews_per_day: z.number().int().min(0).max(99999).optional(),
        desired_retention: z
          .number()
          .min(0.7)
          .max(0.99)
          .optional()
          .describe('Target recall probability (default 0.9). Higher = more frequent reviews.'),
        timezone: z.string().optional().describe('IANA timezone, e.g. "America/Bogota"'),
      },
    },
    (args) =>
      run(() => ({
        settings: updateSettings(user.id, {
          newCardsPerDay: args.new_cards_per_day,
          maxReviewsPerDay: args.max_reviews_per_day,
          desiredRetention: args.desired_retention,
          timezone: args.timezone,
        }),
      }))
  );

  // ── Prompts (slash commands in MCP clients) ────────────────────────────
  server.registerPrompt(
    'study',
    {
      title: 'Study session',
      description: 'Start an active-recall session with RecallForge',
      argsSchema: { deck: z.string().optional(), tag: z.string().optional() },
    },
    ({ deck, tag }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Start a RecallForge active-recall session${deck ? ` for deck "${deck}"` : ''}${tag ? ` on tag "${tag}"` : ''}. Follow the RecallForge study protocol: ask one question at a time, wait for my answer, then reveal, give feedback and grade.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'make_cards',
    {
      title: 'Make flashcards',
      description: 'Turn study material into RecallForge flashcards',
      argsSchema: { deck: z.string(), material: z.string() },
    },
    ({ deck, material }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create atomic active-recall flashcards for deck "${deck}" from the material below, following the RecallForge card guidelines. Show me the list, then add them with add_cards once I confirm.\n\n${material}`,
          },
        },
      ],
    })
  );

  return server;
}
