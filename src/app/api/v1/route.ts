import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

/** GET /api/v1 — machine-readable index so an agent can discover the API from the base URL alone. */
export function GET() {
  return NextResponse.json({
    name: 'RecallForge API',
    version: 2,
    auth: 'Authorization: Bearer <API key> (create one in the web app → Cuenta). X-API-Key header or ?key= also accepted.',
    protocol:
      'Active recall: GET study/next (question only) → learner answers → POST study/reveal → give feedback → POST study/grade (returns next question).',
    mcp: { endpoint: '/api/mcp', transport: 'streamable-http' },
    endpoints: [
      { method: 'GET', path: '/api/v1/study/next', query: ['deck', 'tag'] },
      { method: 'POST', path: '/api/v1/study/reveal', body: { cardId: 'string' } },
      {
        method: 'POST',
        path: '/api/v1/study/grade',
        body: { cardId: 'string', rating: 'again|hard|good|easy', answer: 'string?', feedback: 'string?', deck: 'string?', tag: 'string?' },
      },
      { method: 'GET', path: '/api/v1/stats', query: ['deck', 'tag'] },
      { method: 'GET', path: '/api/v1/decks' },
      { method: 'POST', path: '/api/v1/decks', body: { name: 'string', description: 'string?' } },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/decks/{idOrName}' },
      { method: 'GET', path: '/api/v1/cards', query: ['query', 'deck', 'tag', 'documentId', 'state', 'limit', 'offset'] },
      {
        method: 'POST',
        path: '/api/v1/cards',
        body: {
          deck: 'string? (subject path, e.g. Medicina::Farmacología)',
          documentId: 'string?',
          draft: 'boolean?',
          cards: [{ front: 'string', back: 'string', explanation: 'string?', source: 'string?', tags: ['string'], deck: 'string?', documentPart: 'number?' }],
        },
      },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/cards/{id}' },
      { method: 'POST', path: '/api/v1/cards/{id}/reset' },
      { method: 'POST', path: '/api/v1/cards/approve', body: { ids: ['string'], documentId: 'string?', deck: 'string?' } },
      { method: 'GET', path: '/api/v1/documents', query: ['deck'] },
      {
        method: 'POST',
        path: '/api/v1/documents',
        body: 'multipart/form-data { file, deck?, title? } or JSON { title, text, deck? }',
      },
      { method: 'GET|PATCH|DELETE', path: '/api/v1/documents/{id}' },
      { method: 'GET', path: '/api/v1/documents/{id}/read', query: ['fromPart', 'maxChars'] },
      { method: 'GET|PATCH', path: '/api/v1/settings' },
      { method: 'GET', path: '/api/v1/export' },
      { method: 'GET', path: '/api/v1/account' },
    ],
  });
}
