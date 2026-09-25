import { badRequest } from '@/lib/core/errors';
import { gradeCard, nextCard } from '@/lib/core/study';
import { readJson, route } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/study/grade
 * { cardId, rating?: again|hard|good|easy|1-4, answer?, feedback?, durationMs?, deck?, tag?,
 *   mode?: normal|exam|quick, format?: recall|typing|multiple_choice|true_false, choice?, statement?, answerTrue? }
 * Recall/typing: reschedules the card. Multiple choice / true-false: checked objectively and logged as
 * practice (the schedule does not change). Returns the next question for the same filter.
 */
export const POST = route(async ({ req, user }) => {
  const { cardId, deck, tag, ...grade } = await readJson(req);
  if (typeof cardId !== 'string' || !cardId) throw badRequest('cardId is required');
  const result = gradeCard(user.id, cardId, grade, req.headers.get('x-recallforge-client') === 'web' ? 'web' : 'api');
  return { result, next: nextCard(user.id, { deck, tag, mode: grade.mode, format: grade.format }) };
});
