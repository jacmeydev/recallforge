---
name: recallforge
description: Run active-recall study sessions and create flashcards in the learner's RecallForge spaced-repetition memory (FSRS). Use when the learner wants to be quizzed, review what is due, turn notes/chapters/lectures into flashcards, check study progress, or fix existing cards.
---

# RecallForge

RecallForge is the learner's spaced-repetition memory. It stores question/answer cards and schedules each one with FSRS. You ask the questions, judge the answers and report how well the learner recalled; RecallForge decides when each card comes back.

If a `recallforge` MCP server is connected, use its tools (same names and semantics as below). Otherwise call the REST API.

## Setup (REST)

- `RECALLFORGE_URL` — server base URL, e.g. `http://localhost:3030`
- `RECALLFORGE_API_KEY` — the learner's key (`rf_...`), from the web app → *Cuenta y agentes*

```bash
rf() { curl -sS -H "Authorization: Bearer $RECALLFORGE_API_KEY" -H 'content-type: application/json' "$@"; }
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

One question per message. If the learner disputes a grade, grade the card again with their rating.

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

## Other useful calls

| Need | Call |
|---|---|
| Progress, due counts, weakest cards | `GET /api/v1/stats?deck=&tag=` |
| List decks with counts | `GET /api/v1/decks` |
| Find cards | `GET /api/v1/cards?query=&deck=&tag=&state=new\|learning\|review\|due\|leech\|suspended` |
| Fix or move a card | `PATCH /api/v1/cards/{id}` with any of `front, back, explanation, source, tags, deck, suspended` |
| Delete a card (confirm first) | `DELETE /api/v1/cards/{id}` |
| More new cards today, exam mode | `PATCH /api/v1/settings` with `newCardsPerDay`, `maxReviewsPerDay`, `desiredRetention` |

Timestamps are UTC ISO-8601; the learner's timezone is in `stats.settings.timezone`.
