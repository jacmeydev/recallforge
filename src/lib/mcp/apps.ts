// ============================================================================
// RecallForge — MCP Apps: study and progress inside the chat
// ============================================================================
// Hosts that support MCP Apps (Claude, ChatGPT, VS Code, Goose…) render an
// interactive study widget right in the conversation: cards with images,
// answer/grade buttons and keyboard shortcuts, as fast as a flashcard app,
// with the agent one click away ("Explícame", "Mejorar tarjeta"). The widget
// talks to the server through app-only tools (hidden from the model) and keeps
// the model informed with updateModelContext. Hosts without MCP Apps get the
// same tool as plain text and the agent runs the session in chat.
// ============================================================================

import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AppError } from '@/lib/core/errors';
import { mediaPayload } from '@/lib/core/media';
import { getProgressMap } from '@/lib/core/progress';
import { getStats } from '@/lib/core/stats';
import { correctLastReview, gradeCard, nextCard, revealCard, undoLastReview, type NextCardResult } from '@/lib/core/study';
import type { AuthUser } from '@/lib/core/types';
import { STUDY_WIDGET_HTML } from './widget.generated';

export const STUDY_WIDGET_URI = 'ui://recallforge/study.html';

const sessionMode = z.enum(['normal', 'exam', 'quick']);
const questionFormat = z.enum(['recall', 'typing', 'multiple_choice', 'true_false']);
const filterShape = {
  deck: z.string().optional().describe('Subject (deck path or id); includes subdecks'),
  tag: z.string().optional(),
  mode: sessionMode.optional().describe('normal (spaced repetition, default), quick (only what is due, ~10 cards) or exam'),
  format: questionFormat.optional().describe('recall (default), typing, multiple_choice or true_false (practice)'),
};
type Filter = { deck?: string; tag?: string; mode?: z.infer<typeof sessionMode>; format?: z.infer<typeof questionFormat> };

function images(userId: string, texts: Array<string | undefined | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const image of mediaPayload(userId, texts.filter((t): t is string => Boolean(t)))) out[image.id] = `data:${image.mimeType};base64,${image.data}`;
  return out;
}

function nextWithImages(userId: string, next: NextCardResult) {
  return { next, images: images(userId, [next.card?.front, ...(next.presentation?.choices ?? []), next.presentation?.statement]) };
}

function result(structuredContent: Record<string, unknown>, text = 'ok'): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

async function run(fn: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Internal error';
    if (!(error instanceof AppError)) console.error('[recallforge] app tool error', error);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

export function registerStudyApp(server: McpServer, user: AuthUser): void {
  const appOnly = { ui: { resourceUri: STUDY_WIDGET_URI, visibility: ['app'] as Array<'app' | 'model'> } };

  registerAppResource(
    server,
    'RecallForge study',
    STUDY_WIDGET_URI,
    { description: 'Interactive flashcard study and progress view' },
    async () => ({ contents: [{ uri: STUDY_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: STUDY_WIDGET_HTML }] })
  );

  registerAppTool(
    server,
    'study',
    {
      title: 'Study (interactive)',
      description:
        'Open an interactive study session in the chat: the learner sees each card, answers, reveals and grades with buttons or the keyboard (1-4), with images, cloze cards, sources and undo. Use it whenever the learner wants to review or practise; the widget handles the loop, so do not ask the questions yourself afterwards unless the learner prefers chat. The learner can press "Explícame" or "Mejorar tarjeta" in the widget: you then receive a message about that card (use explain_card / update_card). If no widget is visible to the learner, run the session in chat with get_next_card instead.',
      inputSchema: filterShape,
      _meta: { ui: { resourceUri: STUDY_WIDGET_URI } },
    },
    (filter: Filter) =>
      run(() => {
        const first = nextCard(user.id, filter);
        const stats = getStats(user.id, { deck: filter.deck, tag: filter.tag });
        const due = first.remaining.learning + first.remaining.review + first.remaining.new;
        const ui = getUiCapability(server.server.getClientCapabilities() as never);
        const summary = first.card
          ? `Study session ready${filter.deck ? ` for "${filter.deck}"` : ''}: ${due} cards (~${stats.workload.minutesToday} min).`
          : `Nothing to study right now${filter.deck ? ` in "${filter.deck}"` : ''}. ${first.message ?? ''}`;
        return result(
          { view: 'study', filter, ...nextWithImages(user.id, first), workload: stats.workload },
          ui
            ? `${summary} The learner is studying in the interactive widget.`
            : `${summary} If the learner cannot see an interactive card, run the session in chat: ask ${first.card ? `"${first.card.front}"` : 'the next card'} (card_id ${first.card?.id ?? '-'}) and continue with reveal_answer / grade_card.`
        );
      })
  );

  registerAppTool(
    server,
    'show_progress',
    {
      title: 'Show progress (interactive)',
      description:
        'Show the learner\'s progress map in the chat: mastery per subject, exams, time needed today and what to do next, with buttons to start studying. Use it when they ask how they are doing or what to study.',
      inputSchema: {},
      _meta: { ui: { resourceUri: STUDY_WIDGET_URI } },
      annotations: { readOnlyHint: true },
    },
    () =>
      run(() => {
        const map = getProgressMap(user.id, { days: 91 });
        return result(
          { view: 'progress', progress: map },
          `Progress: overall mastery ${Math.round(map.overall.mastery * 100)}%, ${map.workload.dueToday} due today (~${map.workload.minutesToday} min). Next steps: ${map.recommendations
            .slice(0, 3)
            .map((r) => r.message)
            .join(' ')}`
        );
      })
  );

  // ── App-only tools (called by the widget, hidden from the model) ────────
  registerAppTool(
    server,
    'widget_next',
    { description: 'Widget: next card', inputSchema: filterShape, _meta: appOnly },
    (filter: Filter) => run(() => result(nextWithImages(user.id, nextCard(user.id, filter))))
  );

  registerAppTool(
    server,
    'widget_reveal',
    { description: 'Widget: reveal the answer', inputSchema: { card_id: z.string() }, _meta: appOnly, annotations: { readOnlyHint: true } },
    ({ card_id }: { card_id: string }) =>
      run(() => {
        const reveal = revealCard(user.id, card_id);
        const c = reveal.card;
        return result({ reveal, images: images(user.id, [c.front, c.back, c.revealed, c.cloze?.extra, c.explanation]) });
      })
  );

  registerAppTool(
    server,
    'widget_grade',
    {
      description: 'Widget: grade and get the next card',
      inputSchema: {
        card_id: z.string(),
        rating: z.enum(['again', 'hard', 'good', 'easy']).optional(),
        answer: z.string().optional(),
        duration_ms: z.number().int().min(0).optional(),
        choice: z.string().optional(),
        statement: z.string().optional(),
        answer_true: z.boolean().optional(),
        ...filterShape,
      },
      _meta: appOnly,
    },
    (args: Filter & {
      card_id: string;
      rating?: 'again' | 'hard' | 'good' | 'easy';
      answer?: string;
      duration_ms?: number;
      choice?: string;
      statement?: string;
      answer_true?: boolean;
    }) =>
      run(() => {
        const graded = gradeCard(
          user.id,
          args.card_id,
          {
            rating: args.rating,
            answer: args.answer,
            durationMs: args.duration_ms,
            mode: args.mode,
            format: args.format,
            choice: args.choice,
            statement: args.statement,
            answerTrue: args.answer_true,
          },
          'web'
        );
        const filter = { deck: args.deck, tag: args.tag, mode: args.mode, format: args.format };
        return result({ result: graded, ...nextWithImages(user.id, nextCard(user.id, filter)) });
      })
  );

  registerAppTool(
    server,
    'widget_undo',
    { description: 'Widget: undo the last grade', inputSchema: { card_id: z.string().optional() }, _meta: appOnly },
    ({ card_id }: { card_id?: string }) =>
      run(() => {
        const undone = undoLastReview(user.id, card_id);
        return result({ ...undone, images: images(user.id, [undone.card.front]) });
      })
  );

  registerAppTool(
    server,
    'widget_correct',
    {
      description: 'Widget: "my answer was right"',
      inputSchema: { card_id: z.string(), rating: z.enum(['again', 'hard', 'good', 'easy']) },
      _meta: appOnly,
    },
    ({ card_id, rating }: { card_id: string; rating: 'again' | 'hard' | 'good' | 'easy' }) =>
      run(() => result({ result: correctLastReview(user.id, card_id, { rating, reason: 'The learner said the answer was right' }) }))
  );
}
