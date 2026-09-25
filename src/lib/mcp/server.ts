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
import { approveCards } from '@/lib/core/cards';
import { deleteDeck, listDecks, updateDeck } from '@/lib/core/decks';
import { deleteDocument, getDocument, importDocumentFile, importDocumentText, listDocuments, readDocument } from '@/lib/core/documents';
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
Quality rules (from spaced-repetition research; the server flags violations in add_cards.warnings - fix them with update_card):
- One fact per card; the front must have exactly one correct answer and make sense on its own, months later, without the source.
- Ask for understanding, not recognition: prefer why/how/what/which, mechanisms, causes, comparisons, "what would you expect if…" over yes/no or true/false.
- No hints: the question must not contain or paraphrase the answer, and must not reveal it through grammar or word count.
- Keep \`back\` short (a word, a phrase, one sentence). Put reasoning, mnemonics, clinical relevance and examples in \`explanation\`.
- Split lists and enumerations longer than ~4 items into several cards (or one card per item with shared context).
- Add both directions only when both are useful (e.g. drug → mechanism and mechanism → drug).
- Never invent facts: every card must be supported by the material. If something is unclear in the source, leave it out.

ORGANIZATION
- Decks are subjects organized as paths: "Medicina::Farmacología::Antibióticos". Missing levels are created automatically; filtering by a deck includes its subdecks. Reuse existing decks (list_decks) before creating new ones.
- Tags are for cross-cutting topics (e.g. "alto-rendimiento", "parcial-2", "cardio::arritmias").

FROM A DOCUMENT (PDF, slides, notes, a web page…)
1. If you can read the file yourself, call add_document with its title and full text (or content_base64 + filename for PDF/DOCX/PPTX files), and a deck for the subject. Otherwise ask the learner to upload it in the RecallForge web app and use list_documents.
2. read_document part by part (follow nextPart). Each part is a page, slide or section with the number of cards already made from it; skip parts that are already covered unless asked.
3. For each part, write cards following the quality rules and send them with add_cards using document_id, document_part and draft: true. The source is filled in automatically.
4. Tell the learner how many drafts were created per section and ask them to review: they can approve in the web app, or you can show them and call approve_cards.

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
        'Create flashcards (up to 500 per call). Decks (subject paths like "Medicina::Farmacología") are created automatically. Cards whose front already exists in the same deck are skipped. Returns quality warnings to fix with update_card. Use draft: true for AI-generated cards so the learner approves them before studying.',
      inputSchema: {
        deck: z.string().optional().describe('Default deck path for all cards (created if missing). Defaults to the document deck.'),
        document_id: z.string().optional().describe('Source document the cards come from (see add_document / list_documents)'),
        draft: z.boolean().optional().describe('Create as drafts pending the learner approval (recommended for generated cards)'),
        cards: z
          .array(
            z.object({
              ...cardShape,
              deck: z.string().optional().describe('Overrides the default deck'),
              document_part: z.number().int().min(0).optional().describe('Index of the document part (page/slide/section) it comes from'),
            })
          )
          .min(1)
          .max(500),
      },
    },
    ({ deck, document_id, draft, cards }) =>
      run(() =>
        addCards(user.id, {
          deck,
          documentId: document_id,
          draft,
          cards: cards.map(({ document_part, ...card }) => ({ ...card, documentPart: document_part })),
        })
      )
  );

  server.registerTool(
    'approve_cards',
    {
      title: 'Approve draft cards',
      description:
        'Move draft cards into the study queue after the learner has reviewed them: by card ids, every draft from a document, or every draft in a deck. Reject drafts with delete_cards.',
      inputSchema: {
        card_ids: z.array(z.string()).optional(),
        document_id: z.string().optional(),
        deck: deckRef.optional(),
      },
    },
    ({ card_ids, document_id, deck }) => run(() => approveCards(user.id, { ids: card_ids, documentId: document_id, deck }))
  );

  // ── Documents ──────────────────────────────────────────────────────────
  server.registerTool(
    'add_document',
    {
      title: 'Add study document',
      description:
        'Store study material so cards can be made from it part by part and linked to their page/slide/section. Pass the text you extracted (text), or a file as content_base64 + filename (PDF, DOCX, PPTX, TXT, MD, HTML, CSV; max ~3 MB this way — larger files are uploaded in the web app). Returns the document with its number of parts.',
      inputSchema: {
        title: z.string().describe('e.g. "Guyton cap. 9 — Corazón como bomba"'),
        deck: z.string().optional().describe('Subject deck path the cards will go to, e.g. "Medicina::Fisiología::Cardio"'),
        text: z.string().optional().describe('Full text of the material (Markdown headings become sections)'),
        content_base64: z.string().optional().describe('The file itself, base64-encoded'),
        filename: z.string().optional().describe('Required with content_base64, e.g. "clase3.pdf"'),
      },
    },
    ({ title, deck, text, content_base64, filename }) =>
      run(async () => {
        if (content_base64) {
          if (!filename) throw new AppError(400, 'bad_request', 'filename is required with content_base64');
          return {
            document: await importDocumentFile(
              user.id,
              { filename, data: new Uint8Array(Buffer.from(content_base64, 'base64')) },
              { title, deck }
            ),
          };
        }
        return { document: importDocumentText(user.id, { title, text, deck }) };
      })
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description: 'Study documents with their deck, number of parts, parts already covered by cards, and pending drafts.',
      inputSchema: { deck: deckRef.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ deck }) => run(() => ({ documents: listDocuments(user.id, deck) }))
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read document',
      description:
        'Read consecutive parts (pages, slides or sections) of a document, each with its index, label and how many cards already come from it. Continue with from_part = nextPart until it is null. Use outline_only to see the structure and coverage without the text.',
      inputSchema: {
        document_id: z.string(),
        from_part: z.number().int().min(0).optional(),
        max_chars: z.number().int().min(500).max(60000).optional().describe('Default 15000'),
        outline_only: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ document_id, from_part, max_chars, outline_only }) =>
      run(() =>
        outline_only
          ? { document: getDocument(user.id, document_id) }
          : readDocument(user.id, document_id, { fromPart: from_part, maxChars: max_chars })
      )
  );

  server.registerTool(
    'delete_document',
    {
      title: 'Delete document',
      description: 'Delete a study document. Cards made from it are kept unless delete_cards is true. Confirm with the learner first.',
      inputSchema: { document_id: z.string(), delete_cards: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    ({ document_id, delete_cards }) => run(() => deleteDocument(user.id, document_id, delete_cards ?? false))
  );

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description:
        'Find cards (with answers) by text, deck (includes subdecks), tag, source document or state. Use it to check coverage before adding cards, to find cards to edit, or to list drafts pending review (state "draft"). state "leech" = cards forgotten 4+ times.',
      inputSchema: {
        query: z.string().optional().describe('Text to look for in front, back, explanation or tags'),
        deck: deckRef.optional(),
        tag: tagFilter.optional(),
        document_id: z.string().optional(),
        state: z.enum(['new', 'learning', 'review', 'suspended', 'due', 'leech', 'draft']).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ document_id, ...args }) => run(() => searchCards(user.id, { ...args, documentId: document_id }))
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
      description:
        'All subject decks in tree order (paths like "Medicina::Farmacología") with depth, parent, own counts and totals including subdecks (new, learning, review, due today, suspended, drafts).',
      annotations: { readOnlyHint: true },
    },
    () => run(() => ({ decks: listDecks(user.id) }))
  );

  server.registerTool(
    'update_deck',
    {
      title: 'Rename or move deck',
      description: 'Rename a deck, move it under another subject by giving a new path (subdecks move along), or change its description.',
      inputSchema: { deck: deckRef, name: z.string().optional(), description: z.string().optional() },
    },
    ({ deck, name, description }) => run(() => ({ deck: updateDeck(user.id, deck, { name, description }) }))
  );

  server.registerTool(
    'delete_deck',
    {
      title: 'Delete deck',
      description: 'Permanently delete a deck, its subdecks, and all their cards and history. Confirm with the learner first.',
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
      description: 'Turn study material (pasted text or a stored document) into high-quality RecallForge flashcards',
      argsSchema: {
        deck: z.string().optional().describe('Subject deck path, e.g. "Medicina::Farmacología"'),
        document_id: z.string().optional().describe('A document from list_documents'),
        material: z.string().optional().describe('Text to turn into cards'),
      },
    },
    ({ deck, document_id, material }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Create high-quality active-recall flashcards following the RecallForge quality rules and the "FROM A DOCUMENT" workflow.',
              deck ? `Deck: "${deck}".` : 'Choose the right subject deck (check list_decks first).',
              document_id
                ? `Source: document ${document_id} — read it part by part with read_document and link every card to its part.`
                : material
                  ? 'Source: the material below. Store it first with add_document so every card is linked to its section.'
                  : 'Ask me for the material (a file or text) first.',
              'Create the cards as drafts, fix any quality warnings, then show me a summary per section so I can review and approve them.',
              material ? `\n${material}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    })
  );

  return server;
}
