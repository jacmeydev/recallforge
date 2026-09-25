---
name: recallforge
description: Run active-recall study sessions and create high-quality flashcards in the learner's RecallForge spaced-repetition memory (FSRS). Use when the learner wants to be quizzed, review what is due, turn a PDF, slides, notes or any document into flashcards, organize subjects, check study progress, or fix existing cards.
---

# RecallForge

RecallForge is the learner's spaced-repetition memory. It stores question/answer cards and schedules each one with FSRS. You ask the questions, judge the answers and report how well the learner recalled; RecallForge decides when each card comes back.

If a `recallforge` MCP server is connected, use its tools (same names and semantics as below); it is the preferred way. Otherwise call the REST API of the learner's local RecallForge web app.

## Setup (REST)

- `RECALLFORGE_URL` — usually `http://127.0.0.1:3030` (the learner starts it with `node dist/cli.mjs ui`)
- `RECALLFORGE_TOKEN` — only if the learner exposed RecallForge remotely with a token; leave empty for local use

```bash
rf() { curl -sS ${RECALLFORGE_TOKEN:+-H "Authorization: Bearer $RECALLFORGE_TOKEN"} -H 'content-type: application/json' "$@"; }
rf "$RECALLFORGE_URL/api/v1"   # endpoint index
```

Errors come back as `{"error":{"code","message","details"}}` with a 4xx status.

## Study session

1. Get the next question (optionally scoped by deck name/id or tag):
   `rf "$RECALLFORGE_URL/api/v1/study/next?deck=Farmacología"`
   → `{ card: { id, front, deck, tags, state }, remaining: { learning, review, new } }`. The answer is not included.
2. Ask the learner `card.front` in their language. Rephrase lightly at most; never add hints, options or parts of the answer. Wait for their own attempt; "I don't know" is a failed recall.
3. Reveal:
   `rf -X POST "$RECALLFORGE_URL/api/v1/study/reveal" -d '{"cardId":"ID"}'`
   → `card.back`, `card.explanation`, `card.source`, `recentAttempts`, `outcomes` (next interval per rating).
4. Compare meaning, not wording. Give short feedback: what was right, what was wrong, at most one extra detail from `explanation`. If `recentAttempts` shows the same mistake, say so.
5. Grade and get the next question in one call (pass the same deck/tag):
   `rf -X POST "$RECALLFORGE_URL/api/v1/study/grade" -d '{"cardId":"ID","rating":"good","answer":"learner words","feedback":"one-line note","deck":"Farmacología"}'`
   - `again` — wrong, blank, or only a fragment
   - `hard` — correct but with long hesitation, prompting, or a small important omission
   - `good` — correct with normal effort (default for correct answers)
   - `easy` — instant, complete, effortless
6. Continue with `next.card`. When it is `null`, relay `next.message` (it says when the next card is due, or that the daily new-card limit was reached) and summarise the session: cards reviewed and what to revisit.

One question per message. If a grade was wrong or the learner disputes it, undo it with `rf -X POST "$RECALLFORGE_URL/api/v1/study/undo" -d '{"cardId":"ID"}'` and grade again.
If the grade result says `"leech": true`, the card keeps being forgotten: tell the learner and offer to rewrite it (split it, add a mnemonic in `explanation`, clarify the question).

## Exam preparation

1. Set the exam day on the subject: `rf -X PATCH "$RECALLFORGE_URL/api/v1/decks/Medicina::Microbiología" -d '{"examDate":"2026-10-20"}'`.
2. Study with `mode=exam`: `rf "$RECALLFORGE_URL/api/v1/study/next?deck=Medicina::Microbiología&mode=exam"` and pass `"mode":"exam"` in each grade. It ignores due dates and daily limits and asks first the cards least likely to be remembered on exam day.
3. Report readiness from `GET /api/v1/progress` (`subjects[].exam.predictedRecall`).

## Progress

`GET /api/v1/progress` returns every subject's mastery (estimated recall of all its cards now; unseen cards count as 0), coverage, consolidated and weak counts, exam readiness, a daily study heatmap and document coverage. Summarize it visually (a short table or bars) and suggest what to study next.

## Creating cards

`rf -X POST "$RECALLFORGE_URL/api/v1/cards" -d @cards.json`

```json
{
  "deck": "Farmacología",
  "cards": [
    {
      "front": "¿Cuál es el antídoto de la intoxicación por paracetamol?",
      "back": "N-acetilcisteína",
      "explanation": "Repone glutatión; más eficaz en las primeras 8 h.",
      "source": "Goodman & Gilman, cap. 4",
      "tags": ["toxicología", "antídotos"]
    }
  ]
}
```

- One fact per card, with a single unambiguous answer. Prefer why/how/what/which questions over yes/no. Split lists longer than ~4 items.
- Short answer in `back`; context, mnemonics, clinical relevance in `explanation`; reference in `source`.
- One deck per subject, tags for topics. Hierarchical tags (`cardio::arritmias`) are matched by prefix when filtering.
- Up to 500 cards per request; decks are created automatically; a front that already exists in the same deck is skipped and reported in `skipped`.
- Before a large batch, show the learner the proposed cards unless they asked you to add them directly. Search first to avoid near-duplicates: `rf "$RECALLFORGE_URL/api/v1/cards?query=paracetamol"`.

## From a document (PDF, slides, notes)

1. Store it. If you read the file yourself, send the text; otherwise upload the file:
   `rf -X POST "$RECALLFORGE_URL/api/v1/documents" -d '{"title":"Guyton cap. 9","deck":"Medicina::Fisiología","text":"..."}'`
   `curl -sS ${RECALLFORGE_TOKEN:+-H "Authorization: Bearer $RECALLFORGE_TOKEN"} -F file=@clase3.pdf -F deck="Medicina::Fisiología" "$RECALLFORGE_URL/api/v1/documents"`
   The learner can also upload it in the web app (*Documentos*); find it with `GET /api/v1/documents`.
2. Read it part by part (pages, slides or sections, each with how many cards it already has):
   `rf "$RECALLFORGE_URL/api/v1/documents/ID/read?fromPart=0"` → follow `nextPart` until it is `null`.
3. Create the cards as drafts linked to their part (source and deck are filled from the document):
   `rf -X POST "$RECALLFORGE_URL/api/v1/cards" -d '{"documentId":"ID","draft":true,"cards":[{"front":"...","back":"...","documentPart":0}]}'`
   Fix anything listed in the response `warnings` with `PATCH /api/v1/cards/{id}`.
4. Summarise what you created per section and let the learner review. Approve with
   `rf -X POST "$RECALLFORGE_URL/api/v1/cards/approve" -d '{"documentId":"ID"}'` (or specific `ids`); reject with `DELETE /api/v1/cards/{id}`.

Never invent facts: every card must be supported by the material. Skip parts that are already covered unless asked.

## Organization

- Decks are subject paths: `Medicina::Farmacología::Antibióticos`. Missing levels are created automatically, and filtering by a deck includes its subdecks. Check `GET /api/v1/decks` and reuse existing subjects before creating new ones.
- Tags are for cross-cutting topics (`alto-rendimiento`, `parcial-2`).

## Other useful calls

| Need | Call |
|---|---|
| Progress, due counts, weakest cards | `GET /api/v1/stats?deck=&tag=` |
| List decks with counts | `GET /api/v1/decks` |
| Find cards | `GET /api/v1/cards?query=&deck=&tag=&documentId=&state=new\|learning\|review\|due\|leech\|suspended\|draft` |
| Fix or move a card | `PATCH /api/v1/cards/{id}` with any of `front, back, explanation, source, tags, deck, suspended` |
| Delete a card (confirm first) | `DELETE /api/v1/cards/{id}` |
| More new cards today, exam mode | `PATCH /api/v1/settings` with `newCardsPerDay`, `maxReviewsPerDay`, `desiredRetention` |

Timestamps are UTC ISO-8601; the learner's timezone is in `stats.settings.timezone`.
