import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

/** GET /api/v1 — machine-readable index so an agent can discover the API from the base URL alone. */
export function GET() {
  return NextResponse.json({
    name: 'RecallForge API',
    version: 3,
    auth: 'None on the local machine. When RECALLFORGE_TOKEN is set: Authorization: Bearer <token> (X-API-Key header or ?key= also accepted).',
    protocol:
      'Active recall: GET study/next (question only) → learner answers → POST study/reveal → give feedback → POST study/grade (returns next question). ' +
      'The learner can overrule a grade with POST study/correct and undo with POST study/undo.',
    mcp: { stdio: 'recallforge mcp', http: { endpoint: '/api/mcp', transport: 'streamable-http' } },
    endpoints: [
      { method: 'GET', path: '/api/v1/study/next', query: ['deck', 'tag', 'mode=normal|exam|quick', 'format=recall|typing|multiple_choice|true_false'] },
      { method: 'POST', path: '/api/v1/study/reveal', body: { cardId: 'string' } },
      {
        method: 'POST',
        path: '/api/v1/study/grade',
        body: {
          cardId: 'string',
          rating: 'again|hard|good|easy (optional for multiple_choice/true_false)',
          answer: 'string?',
          feedback: 'string?',
          durationMs: 'number?',
          mode: 'normal|exam|quick?',
          format: 'recall|typing|multiple_choice|true_false?',
          choice: 'string? (multiple_choice)',
          statement: 'string? (true_false)',
          answerTrue: 'boolean? (true_false)',
          deck: 'string?',
          tag: 'string?',
        },
      },
      { method: 'POST', path: '/api/v1/study/correct', body: { cardId: 'string', rating: 'again|hard|good|easy', reason: 'string?' } },
      { method: 'POST', path: '/api/v1/study/undo', body: { cardId: 'string?' } },
      { method: 'GET', path: '/api/v1/stats', query: ['deck', 'tag'] },
      { method: 'GET', path: '/api/v1/progress', query: ['days'] },
      { method: 'GET', path: '/api/v1/decks' },
      { method: 'POST', path: '/api/v1/decks', body: { name: 'string', description: 'string?', examDate: 'YYYY-MM-DD?' } },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/decks/{idOrName}' },
      { method: 'GET', path: '/api/v1/cards', query: ['query', 'deck', 'tag', 'documentId', 'state', 'limit', 'offset'] },
      {
        method: 'POST',
        path: '/api/v1/cards',
        body: {
          deck: 'string? (subject path, e.g. Medicina::Farmacología)',
          documentId: 'string?',
          draft: 'boolean?',
          dryRun: 'boolean? (check duplicates, contradictions, quality and sources without saving)',
          cards: [
            {
              front: 'string',
              back: 'string',
              explanation: 'string?',
              source: 'string?',
              excerpt: 'string? (exact quote of the source)',
              tags: ['string'],
              deck: 'string?',
              documentPart: 'number?',
            },
          ],
        },
      },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/cards/{id}' },
      { method: 'GET', path: '/api/v1/cards/{id}/explain' },
      { method: 'GET', path: '/api/v1/cards/{id}/revisions' },
      { method: 'POST', path: '/api/v1/revisions/{id}/revert' },
      { method: 'POST', path: '/api/v1/cards/{id}/reset' },
      { method: 'POST', path: '/api/v1/cards/approve', body: { ids: ['string'], documentId: 'string?', deck: 'string?' } },
      { method: 'GET', path: '/api/v1/documents', query: ['deck'] },
      { method: 'POST', path: '/api/v1/documents', body: 'multipart/form-data { file, deck?, title? } or JSON { title, text, deck? }' },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/documents/{id}' },
      { method: 'GET', path: '/api/v1/documents/{id}/read', query: ['fromPart', 'maxChars'] },
      { method: 'GET|PATCH', path: '/api/v1/settings' },
      { method: 'GET', path: '/api/v1/export', query: ['format=json|tsv', 'deck (tsv)'] },
      { method: 'POST', path: '/api/v1/import', body: 'multipart { file, deck?, draft? } or raw JSON export / CSV / TSV' },
    ],
  });
}
