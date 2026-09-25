// ============================================================================
// RecallForge — MCP server (tools + study protocol for any MCP-capable agent)
// ============================================================================
// Built per request for the authenticated learner (stateless Streamable HTTP).
// Tool names and semantics mirror the REST API one-to-one.
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { addCards, approveCards, deleteCards, listRevisions, revertRevision, searchCards, updateCard } from '@/lib/core/cards';
import { deleteDeck, listDecks, updateDeck } from '@/lib/core/decks';
import { deleteDocument, getDocument, importDocumentFile, importDocumentText, listDocuments, readDocument } from '@/lib/core/documents';
import { AppError } from '@/lib/core/errors';
import { explainCard } from '@/lib/core/explain';
import { exportApkg, importApkg } from '@/lib/core/anki';
import { exportCardsTsv, exportUserData } from '@/lib/core/export';
import { importData } from '@/lib/core/import';
import { optimizeScheduler } from '@/lib/core/optimizer';
import { mediaPayload, saveMedia } from '@/lib/core/media';
import { registerStudyApp } from './apps';
import { updateSettings } from '@/lib/core/settings';
import { getStats } from '@/lib/core/stats';
import { getProgressMap } from '@/lib/core/progress';
import { correctLastReview, gradeCard, nextCard, revealCard, undoLastReview } from '@/lib/core/study';
import type { AuthUser } from '@/lib/core/types';

export const MCP_SERVER_VERSION = '3.0.0';

export const STUDY_PROTOCOL = `RecallForge is the learner's spaced-repetition memory (FSRS scheduler). Use it to run active-recall study sessions and to turn study material into flashcards. Talk to the learner in their language.

STUDY SESSION
Preferred: call study (optionally with deck, mode, format). Hosts that support MCP Apps (Claude, ChatGPT, VS Code…) show an interactive study widget in the chat, where the learner answers and grades with buttons or keys at full speed, with images, sources and undo. Do not ask the questions in chat while the widget is open. When the learner presses "Explícame", "Mejorar tarjeta" or "Que el tutor corrija mi respuesta" in the widget, you receive a message about that card: answer it (explain_card, propose an update_card, judge the answer by meaning and, if they were right, offer correct_grade). show_progress shows the progress map in the chat.
If there is no widget (text-only clients, voice, or the learner prefers chat), run the session yourself:
1. get_next_card (optionally filtered by deck or tag) returns only the question. Ask the learner the \`front\` text. You may rephrase lightly for flow, but never add hints, options or any part of the answer. When the card has suggestRephrase: true the learner has seen it many times: ask the same fact with different wording or from another angle (reverse direction, a short clinical vignette, "why…") so it is recalled, not recognised by its pattern. Never change the card for this.
2. Wait for the learner's own attempt. Never answer for them. "I don't know" counts as a failed recall.
3. reveal_answer(card_id) returns the expected answer (\`back\`), the \`explanation\`, the source (document, page and exact excerpt) and \`recentAttempts\`. Grade semantically: synonyms, equivalent terms (brand/generic names, abbreviations, eponyms), other word order and minor spelling mistakes are correct; missing or wrong key elements are not. When unsure, say what you are judging and let the learner decide.
4. Give brief feedback: confirm what was right, correct what was wrong, add at most one useful detail from \`explanation\`, and cite the source (document and page) when there is one. If \`recentAttempts\` shows the same mistake before, point it out. Always tell the learner the rating you give and why, in one line: grading is never hidden.
5. grade_card with a rating:
   - again: wrong, blank, or only a fragment recalled
   - hard: correct but with long hesitation, prompting, or a small important omission
   - good: correct with normal effort (the default for correct answers)
   - easy: instant, complete and effortless
   Include user_answer (the learner's words) and a one-line feedback note; they are shown on future attempts. Pass the same deck/tag you used in get_next_card: the response contains the next question in \`next\`.
6. Continue with \`next.card\`. When it is null, relay \`next.message\` and close with a short summary (cards reviewed, what to revisit).
One question per message, keep the pace brisk.
The learner has the last word on grades: if they say their answer was right (or wrong), call correct_grade(card_id, rating) at once, without arguing; it reschedules the card as if graded that way. undo_last_review removes the last review entirely (e.g. graded the wrong card).
"Explain this" / "no entiendo": call explain_card(card_id). It returns the card, the exact source excerpt with the surrounding text, past attempts and related cards. Explain from that material, quote the source, and say clearly when you add something the source does not contain.
If grade_card returns leech: true, the card keeps being forgotten: tell the learner and offer to rewrite it (split it, add a mnemonic or context in explanation, fix ambiguity) with update_card.

SESSION TYPES (pass the same mode/format to get_next_card and grade_card)
- Long-term review (default): the FSRS queue with the learner's daily limits.
- Quick session (mode "quick"): only what is already due, no new cards; stop after about 10 cards or 5 minutes and summarise.
- Typing (format "typing"): the learner writes the answer; grade_card reports an exact-match check, but you still judge meaning and give the rating.
- Multiple choice (format "multiple_choice"): show the question and \`presentation.choices\` (lettered), then grade_card with choice = the option text picked. True/false (format "true_false"): show the question and \`presentation.statement\`, ask whether it is right, then grade_card with statement and answer_true. Both are checked objectively, logged as practice and never change the schedule: they are for warming up or exam drills, not for long-term memory.

EXAM PREPARATION
When the learner has an exam, set it with update_deck(exam_date) on that subject. Then study with get_next_card(deck, mode: "exam") (and pass mode "exam" to grade_card): it ignores due dates and daily limits and asks first the cards they are least likely to remember on exam day. get_progress_map shows each subject's predicted recall on exam day. Exam mode is separate from the daily queue: it does not use the daily limits, and the daily queue is unaffected by it except for the cards actually answered.

CREATING CARDS
Two kinds of cards:
- Basic: front (question) and back (short answer).
- Cloze: front is a sentence with deletions, back is optional extra notes: "La {{c1::protamina}} revierte la {{c2::heparina}}" creates one card per cN (c1 hides "protamina", c2 hides "heparina"). Hints: {{c1::protamina::antídoto}}. Use cloze for definitions, lists of features, numbers and sentences from the source; one key term per deletion; group deletions that must be recalled together under the same cN.
- Images: add_image returns ![description](media:ID) to paste into front, back or explanation (e.g. an anatomy picture with the question "¿Qué estructura señala la flecha?").
Quality rules (from spaced-repetition research; the server flags violations in add_cards.warnings - fix them with update_card):
- One fact per card; the front must have exactly one correct answer and make sense on its own, months later, without the source.
- Ask for understanding, not recognition: prefer why/how/what/which, mechanisms, causes, comparisons, "what would you expect if…" over yes/no or true/false.
- No hints: the question must not contain or paraphrase the answer, and must not reveal it through grammar or word count.
- Keep \`back\` short (a word, a phrase, one sentence). Put reasoning, mnemonics, clinical relevance and examples in \`explanation\`.
- Split lists and enumerations longer than ~4 items into several cards (or one card per item with shared context).
- Add both directions only when both are useful (e.g. drug → mechanism and mechanism → drug).
- Never invent facts: every card must be supported by the material. If something is unclear in the source, leave it out.
- From a document, always include \`excerpt\`: the exact sentence(s) of the source the card is based on (copied verbatim). The server checks it against the page and shows it to the learner.
- Before saving a batch, you can call add_cards with dry_run: true: it reports duplicates, near-duplicates, possible contradictions with existing cards, quality problems and excerpts not found in the source, without saving anything. Resolve them (skip, merge or ask the learner which answer is right), then add for real.

ORGANIZATION
- Decks are subjects organized as paths: "Medicina::Farmacología::Antibióticos". Missing levels are created automatically; filtering by a deck includes its subdecks. Reuse existing decks (list_decks) before creating new ones.
- Tags are for cross-cutting topics (e.g. "alto-rendimiento", "parcial-2", "cardio::arritmias").

FROM A DOCUMENT (PDF, slides, notes, a web page…)
1. If you can read the file yourself, call add_document with its title and full text (or content_base64 + filename for PDF/DOCX/PPTX files), and a deck for the subject. Otherwise ask the learner to upload it in the RecallForge web app and use list_documents.
2. read_document part by part (follow nextPart). Each part is a page, slide or section with the number of cards already made from it; skip parts that are already covered unless asked.
3. For each part, write cards following the quality rules and send them with add_cards using document_id, document_part and draft: true. The source is filled in automatically.
4. Tell the learner how many drafts were created per section and ask them to review: they can edit and approve in the web app ("Por revisar"), or you can show them and call approve_cards. Never approve on your own.

YOUR ROLE: SUPERVISED, NEVER OPAQUE
- Propose, never impose: new cards from material are drafts; edits to existing cards are proposed to the learner before update_card (always with a short reason). Every edit is recorded (card_history) and can be reverted (revert_revision).
- Grading is always explained and can be overruled (correct_grade).
- The learner owns the data: import_data brings in Anki decks (.apkg, e.g. AnKing or their own collection, with scheduling and history), RecallForge backups and CSV/TSV; export_data writes an .apkg for Anki/AnkiDroid/AnkiMobile (study on the phone), a full JSON backup or a TSV.

PLANNING
get_stats gives due counts, estimated minutes for today (from the learner's own pace), today's progress, 30-day retention, streak, a 7-day forecast with minutes and the weakest cards. get_progress_map gives the whole picture: every subject's mastery (estimated recall of all its cards right now), coverage, consolidated and weak cards, exam readiness, the study heatmap, document coverage and \`recommendations\` (what to do next, most urgent first). Use them to suggest what to study next, and present progress as a short summary with the next action, not decorative numbers. Streaks and heatmaps are information, never pressure. Timestamps are UTC ISO-8601; the learner's timezone is in get_stats.settings.`;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** JSON plus the card's images as image blocks, so agents that see images can use them. */
async function withImages(userId: string, fn: () => unknown, texts: (data: never) => Array<string | undefined | null>): Promise<CallToolResult> {
  const result = await run(fn);
  if (result.isError) return result;
  const data = JSON.parse((result.content[0] as { text: string }).text);
  const images = mediaPayload(userId, texts(data as never).filter((t): t is string => Boolean(t)), 3 * 1024 * 1024);
  return { content: [...result.content, ...images.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType }))] };
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
const sessionMode = z.enum(['normal', 'exam', 'quick']);
const questionFormat = z
  .enum(['recall', 'typing', 'multiple_choice', 'true_false'])
  .describe('recall/typing move the schedule; multiple_choice/true_false are practice (checked, logged, schedule unchanged)');

const cardShape = {
  front: z.string().describe('Question or prompt shown to the learner'),
  back: z.string().describe('Concise expected answer'),
  explanation: z.string().optional().describe('Context, reasoning, mnemonic or clinical relevance used for feedback'),
  source: z.string().optional().describe('Reference: book, chapter, page, lecture, URL'),
  excerpt: z.string().optional().describe('Exact sentence(s) of the source this card is based on, copied verbatim'),
  tags: z.array(z.string()).optional().describe('Topic tags, e.g. ["cardio::arritmias", "farmaco"]'),
};

export function createMcpServer(user: AuthUser): McpServer {
  const server = new McpServer(
    { name: 'recallforge', title: 'RecallForge', version: MCP_SERVER_VERSION },
    { instructions: STUDY_PROTOCOL }
  );

  // ── Interactive study in the chat (MCP Apps) ──────────────────────────
  registerStudyApp(server, user);

  // ── Study ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_next_card',
    {
      title: 'Get next card',
      description:
        'Next card to ask. Returns only the question (front) plus remaining counts and `presentation` (choices for multiple_choice, a statement for true_false); the answer is withheld until reveal_answer. card is null when nothing is left (see message and nextDueAt). suggestRephrase: true = ask it with different wording. mode "exam" (needs a deck with an exam date) asks the cards least likely to be remembered on exam day, ignoring due dates and limits; mode "quick" serves only what is already due.',
      inputSchema: {
        deck: deckRef.optional(),
        tag: tagFilter.optional(),
        mode: sessionMode.optional().describe('Default "normal"'),
        format: questionFormat.optional().describe('Default "recall"'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ deck, tag, mode, format }) =>
      withImages(user.id, () => nextCard(user.id, { deck, tag, mode, format }), (d: { card?: { front: string } | null }) => [d.card?.front])
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
    ({ card_id }) =>
      withImages(user.id, () => revealCard(user.id, card_id), (d: { card: { front: string; back: string; explanation: string; revealed?: string } }) => [
        d.card.revealed ?? d.card.front,
        d.card.back,
        d.card.explanation,
      ])
  );

  server.registerTool(
    'grade_card',
    {
      title: 'Grade card',
      description:
        "Record how well the learner recalled a card. recall/typing: reschedules it with FSRS. multiple_choice/true_false: checked objectively (result.check), logged as practice, schedule unchanged. Returns the new due date and the next question (same deck/tag/mode/format) in `next`.",
      inputSchema: {
        card_id: z.string(),
        rating: rating
          .optional()
          .describe('again = failed, hard = recalled with difficulty, good = recalled, easy = effortless. Required for recall/typing.'),
        user_answer: z.string().optional().describe("The learner's answer, verbatim or summarized"),
        feedback: z.string().optional().describe('One-line note on what was right/wrong, shown on future attempts'),
        deck: deckRef.optional().describe('Filter for the next card (use the same as get_next_card)'),
        tag: tagFilter.optional(),
        mode: sessionMode.optional(),
        format: questionFormat.optional(),
        choice: z.string().optional().describe('multiple_choice: the option text the learner picked'),
        statement: z.string().optional().describe('true_false: the statement shown (presentation.statement)'),
        answer_true: z.boolean().optional().describe('true_false: whether the learner said the statement is right'),
      },
    },
    ({ card_id, rating, user_answer, feedback, deck, tag, mode, format, choice, statement, answer_true }) =>
      run(() => ({
        result: gradeCard(
          user.id,
          card_id,
          { rating, answer: user_answer, feedback, mode, format, choice, statement, answerTrue: answer_true },
          'agent'
        ),
        next: nextCard(user.id, { deck, tag, mode, format }),
      }))
  );

  server.registerTool(
    'undo_last_review',
    {
      title: 'Undo last review',
      description:
        'Undo the most recent grade (of card_id, or of any card): the card goes back exactly as it was and the review is removed from the history. Use it when a grade was wrong, then grade again.',
      inputSchema: { card_id: z.string().optional() },
    },
    ({ card_id }) => run(() => undoLastReview(user.id, card_id))
  );

  server.registerTool(
    'correct_grade',
    {
      title: 'Correct grade ("my answer was right")',
      description:
        "The learner overrules the grade of a card's last review (e.g. their answer was a valid synonym). The card is rescheduled exactly as if it had been graded with this rating at that time; the correction is noted in the review.",
      inputSchema: {
        card_id: z.string(),
        rating: rating,
        reason: z.string().optional().describe('Why, in a few words (e.g. "sinónimo válido")'),
      },
    },
    ({ card_id, rating, reason }) => run(() => ({ result: correctLastReview(user.id, card_id, { rating, reason }) }))
  );

  server.registerTool(
    'explain_card',
    {
      title: 'Explain this card',
      description:
        'Everything needed to explain a card faithfully: the card with answer and explanation, its source document and page with the exact excerpt and the surrounding text, the learner\'s recent attempts and related cards of the same subject. Use it when the learner asks why, or does not understand.',
      inputSchema: { card_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ card_id }) => run(() => explainCard(user.id, card_id))
  );

  server.registerTool(
    'get_progress_map',
    {
      title: 'Get progress map',
      description:
        "The learner's knowledge map: every subject (tree) with mastery (estimated recall of all its cards now, unseen = 0), coverage (share of cards studied), consolidated, weak, due and draft counts, exam readiness (predicted recall on exam day), a daily study heatmap and document coverage.",
      inputSchema: { days: z.number().int().min(7).max(400).optional().describe('Heatmap length in days (default 182)') },
      annotations: { readOnlyHint: true },
    },
    ({ days }) => run(() => getProgressMap(user.id, { days }))
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
        'Create flashcards (up to 500 per call). Decks (subject paths like "Medicina::Farmacología") are created automatically. Cards whose front already exists in the same deck are skipped. Returns warnings (quality, near-duplicates, possible contradictions with existing cards, excerpts not found in the source) to fix with update_card. Use draft: true for AI-generated cards so the learner approves them before studying, and dry_run: true to check a batch without saving.',
      inputSchema: {
        deck: z.string().optional().describe('Default deck path for all cards (created if missing). Defaults to the document deck.'),
        document_id: z.string().optional().describe('Source document the cards come from (see add_document / list_documents)'),
        draft: z.boolean().optional().describe('Create as drafts pending the learner approval (recommended for generated cards)'),
        dry_run: z.boolean().optional().describe('Only report skipped cards and warnings; nothing is saved'),
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
    ({ deck, document_id, draft, dry_run, cards }) =>
      run(() =>
        addCards(user.id, {
          deck,
          documentId: document_id,
          draft,
          dryRun: dry_run,
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
        'Edit a card (fix wording, improve the explanation, retag, move to another deck) or suspend/unsuspend it. Scheduling progress is kept. Propose content changes to the learner first; every change is recorded with your reason and can be reverted (card_history, revert_revision).',
      inputSchema: {
        card_id: z.string(),
        front: cardShape.front.optional(),
        back: cardShape.back.optional(),
        explanation: cardShape.explanation,
        source: cardShape.source,
        excerpt: cardShape.excerpt,
        tags: cardShape.tags.describe('Replaces all tags'),
        deck: z.string().optional().describe('Move to this deck (created if missing)'),
        suspended: z.boolean().optional().describe('Suspended cards are never asked'),
        reason: z.string().optional().describe('Why the card changes (shown in its history)'),
      },
    },
    ({ card_id, reason, ...patch }) => run(() => ({ card: updateCard(user.id, card_id, patch, 'agent', reason) }))
  );

  server.registerTool(
    'card_history',
    {
      title: 'Card edit history',
      description: 'Every content change of a card, newest first: when, by whom (agent, web, api, revert), why, and the fields before and after.',
      inputSchema: { card_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ card_id }) => run(() => ({ revisions: listRevisions(user.id, card_id) }))
  );

  server.registerTool(
    'revert_revision',
    {
      title: 'Revert a card edit',
      description: 'Restore the card content from before a change listed by card_history. The revert is itself recorded.',
      inputSchema: { revision_id: z.string() },
    },
    ({ revision_id }) => run(() => ({ card: revertRevision(user.id, revision_id) }))
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

  server.registerTool(
    'add_image',
    {
      title: 'Add image',
      description:
        'Store an image (anatomy, histology, radiology, ECG, a diagram, a slide or a PDF page you rendered…) and get the Markdown to place in a card: ![description](media:ID). Put it in front for "what is this?" cards or in back/explanation as support. Images are shown in the widget and the web app, and sent to you with the card.',
      inputSchema: {
        content_base64: z.string().describe('The image file, base64-encoded (PNG, JPEG, GIF, WebP, SVG; max 10 MB)'),
        filename: z.string().describe('e.g. "plexo-braquial.png"'),
      },
    },
    ({ content_base64, filename }) => run(() => ({ media: saveMedia(user.id, { filename, data: new Uint8Array(Buffer.from(content_base64, 'base64')) }) }))
  );

  server.registerTool(
    'import_data',
    {
      title: 'Import an Anki deck, cards or a backup',
      description:
        'Import an Anki package (.apkg/.colpkg: shared decks like AnKing or the learner\'s own collection, with cloze, images, tags, suspended cards, scheduling and review history), a RecallForge JSON backup (merged without duplicates) or CSV/TSV with front and back columns. For files on this computer pass file_path (e.g. "~/Downloads/AnKing.apkg"); for text you already have, pass content. Re-importing the same deck only adds what is new.',
      inputSchema: {
        file_path: z.string().optional().describe('Path of a file on this computer: .apkg, .colpkg, .json, .csv, .tsv or .txt'),
        content: z.string().optional().describe('File content as text (JSON export, CSV or TSV)'),
        deck: z.string().optional().describe('Anki: parent subject for the imported decks. CSV/TSV: subject for lines without a deck column (default "Importado")'),
        draft: z.boolean().optional().describe('Create the cards as drafts to review first'),
      },
    },
    ({ file_path, content, deck, draft }) =>
      run(async () => {
        if (file_path) {
          const resolved = path.resolve(file_path.replace(/^~(?=$|[\\/])/, os.homedir()));
          if (!fs.existsSync(resolved)) throw new AppError(400, 'bad_request', `File not found: ${resolved}`);
          if (/\.(apkg|colpkg)$/i.test(resolved)) return importApkg(user.id, resolved, { deck, draft });
          return importData(user.id, fs.readFileSync(resolved, 'utf8'), { deck, draft });
        }
        if (!content) throw new AppError(400, 'bad_request', 'Pass file_path or content');
        return importData(user.id, content, { deck, draft });
      })
  );

  server.registerTool(
    'export_data',
    {
      title: 'Export (Anki, backup, spreadsheet)',
      description:
        'Write the learner\'s cards to a file on this computer: "apkg" opens in Anki, AnkiDroid and AnkiMobile (study on the phone, keeps cloze, images and scheduling); "json" is the complete backup (everything, re-importable); "tsv" opens in spreadsheets. Optionally only one subject.',
      inputSchema: {
        format: z.enum(['apkg', 'json', 'tsv']),
        file_path: z.string().describe('Where to write it, e.g. "~/Desktop/recallforge.apkg" (existing files are not overwritten)'),
        deck: z.string().optional().describe('Only this subject (apkg and tsv)'),
      },
    },
    ({ format, file_path, deck }) =>
      run(async () => {
        const resolved = path.resolve(file_path.replace(/^~(?=$|[\\/])/, os.homedir()));
        if (fs.existsSync(resolved)) throw new AppError(400, 'bad_request', `${resolved} already exists; choose another name`);
        const data =
          format === 'apkg'
            ? await exportApkg(user.id, { deck })
            : format === 'tsv'
              ? exportCardsTsv(user.id, deck)
              : JSON.stringify(exportUserData(user.id), null, 2);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, data);
        return { written: resolved, bytes: fs.statSync(resolved).size };
      })
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
      title: 'Update deck (rename, move, exam date)',
      description:
        'Rename a deck, move it under another subject by giving a new path (subdecks move along), change its description, or set its exam date (applies to its subdecks too; null clears it).',
      inputSchema: {
        deck: deckRef,
        name: z.string().optional(),
        description: z.string().optional(),
        exam_date: z.string().nullable().optional().describe('Exam day as YYYY-MM-DD, or null to clear'),
      },
    },
    ({ deck, name, description, exam_date }) =>
      run(() => ({ deck: updateDeck(user.id, deck, { name, description, examDate: exam_date }) }))
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

  server.registerTool(
    'optimize_scheduler',
    {
      title: 'Personalise the scheduler',
      description:
        "Fit the FSRS scheduler to the learner's own review history (the same optimizer Anki uses). Needs ~200+ reviews, e.g. after a few weeks of study or after importing an Anki collection with history. Applies the new parameters only if they predict the learner's memory better, and reports by how much. Suggest it once a month.",
      inputSchema: { apply: z.boolean().optional().describe('Default true; false only reports what would change') },
    },
    ({ apply }) => run(() => optimizeScheduler(user.id, { apply }))
  );

  // ── Prompts (slash commands in MCP clients) ────────────────────────────
  server.registerPrompt(
    'study',
    {
      title: 'Study session',
      description: 'Start an active-recall session with RecallForge',
      argsSchema: {
        deck: z.string().optional(),
        tag: z.string().optional(),
        mode: z.string().optional().describe('normal, exam, quick, multiple_choice, true_false or typing'),
      },
    },
    ({ deck, tag, mode }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Start a RecallForge ${mode ? `${mode} ` : ''}study session${deck ? ` for deck "${deck}"` : ''}${tag ? ` on tag "${tag}"` : ''}. Follow the RecallForge study protocol: ask one question at a time, wait for my answer, then reveal, give feedback and grade.`,
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
