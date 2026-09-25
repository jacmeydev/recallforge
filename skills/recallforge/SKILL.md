---
name: recallforge
description: Run active-recall study sessions and create high-quality flashcards (basic, cloze, with images) in the learner's RecallForge spaced-repetition memory (FSRS). Use when the learner wants to be quizzed, review what is due, turn a PDF, slides, notes or any document into flashcards, import or export Anki decks (.apkg), organize subjects, check study progress, or fix existing cards.
---

# RecallForge

RecallForge is the learner's spaced-repetition memory. It stores question/answer cards and schedules each one with FSRS. You ask the questions, judge the answers and report how well the learner recalled; RecallForge decides when each card comes back.

If a `recallforge` MCP server is connected, use its tools (same names and semantics as below); it is the preferred way, and its `study` tool opens an interactive study widget right in the chat on clients that support MCP Apps. Otherwise call the REST API of the learner's local RecallForge web app.

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
   → `{ card: { id, front, deck, tags, state, suggestRephrase }, presentation, remaining: { learning, review, new } }`. The answer is not included.
2. Ask the learner `card.front` in their language. Rephrase lightly at most; never add hints, options or parts of the answer. When `suggestRephrase` is true, ask the same fact with different wording or from another angle so it is recalled, not recognised. Wait for their own attempt; "I don't know" is a failed recall.
3. Reveal:
   `rf -X POST "$RECALLFORGE_URL/api/v1/study/reveal" -d '{"cardId":"ID"}'`
   → `card.back`, `card.explanation`, `card.source`, `card.excerpt`, `card.document` (title, page), `recentAttempts`, `outcomes` (next interval per rating).
4. Grade by meaning, not wording: synonyms, equivalent names (brand/generic, eponyms, abbreviations), other word order and small typos are correct; missing or wrong key elements are not. Give short feedback: what was right, what was wrong, at most one extra detail from `explanation`, and the source (document, page) when there is one. If `recentAttempts` shows the same mistake, say so. Always say which rating you give and why.
5. Grade and get the next question in one call (pass the same deck/tag):
   `rf -X POST "$RECALLFORGE_URL/api/v1/study/grade" -d '{"cardId":"ID","rating":"good","answer":"learner words","feedback":"one-line note","deck":"Farmacología"}'`
   - `again` — wrong, blank, or only a fragment
   - `hard` — correct but with long hesitation, prompting, or a small important omission
   - `good` — correct with normal effort (default for correct answers)
   - `easy` — instant, complete, effortless
6. Continue with `next.card`. When it is `null`, relay `next.message` (it says when the next card is due, or that the daily new-card limit was reached) and summarise the session: cards reviewed and what to revisit.

One question per message. The learner has the last word on grades: if they say their answer was right, call
`rf -X POST "$RECALLFORGE_URL/api/v1/study/correct" -d '{"cardId":"ID","rating":"good","reason":"sinónimo"}'` without arguing (it reschedules as if graded that way). To remove a review entirely (wrong card), `POST /api/v1/study/undo` with `{"cardId":"ID"}`.
"Explain this": `GET /api/v1/cards/ID/explain` returns the source excerpt with its surrounding text, past attempts and related cards. Explain from that material, quote it, and say when you add something it does not contain.
If the grade result says `"leech": true`, the card keeps being forgotten: tell the learner and offer to rewrite it (split it, add a mnemonic in `explanation`, clarify the question).

## Session types

Pass the same `mode`/`format` to `study/next` and `study/grade`.

- Quick session: `mode=quick` (only what is already due, no new cards); stop after ~10 cards and summarise.
- Typing: `format=typing`; the grade result has an exact-match hint in `result.check`, but you still judge meaning and send `rating`.
- Multiple choice: `format=multiple_choice`; show `presentation.choices` lettered and grade with `{"cardId","format":"multiple_choice","choice":"<option text>"}`.
- True/false: `format=true_false`; show `presentation.statement`, ask if it is right, grade with `{"cardId","format":"true_false","statement":"...","answerTrue":true}`.
- Multiple choice and true/false are checked objectively and logged as practice: they never change the schedule.

## Exam preparation

1. Set the exam day on the subject: `rf -X PATCH "$RECALLFORGE_URL/api/v1/decks/Medicina::Microbiología" -d '{"examDate":"2026-10-20"}'`.
2. Study with `mode=exam`: `rf "$RECALLFORGE_URL/api/v1/study/next?deck=Medicina::Microbiología&mode=exam"` and pass `"mode":"exam"` in each grade. It ignores due dates and daily limits and asks first the cards least likely to be remembered on exam day.
3. Report readiness from `GET /api/v1/progress` (`subjects[].exam.predictedRecall`).

## Progress

`GET /api/v1/progress` returns every subject's mastery (estimated recall of all its cards now; unseen cards count as 0), coverage, consolidated and weak counts, exam readiness, `workload` (minutes due today at the learner's own pace), `recommendations` (what to do next, most urgent first), a daily study heatmap and document coverage. Summarize it briefly with the next action; streaks and heatmaps are information, never pressure.

## Cloze cards and images

- Cloze: put deletions in `front` with Anki syntax and leave `back` for optional extra notes: `{"front":"La {{c1::protamina}} revierte la {{c2::heparina::anticoagulante}}","back":"Se une por carga"}` creates one card per cN. The card's question hides its deletion as `[…]` (or `[hint]`); `card.back` in reveal is the hidden text and `card.revealed` the full sentence with the answer marked `==like this==`.
- Images: `POST /api/v1/media` (multipart `file`, or JSON `{filename, contentBase64}`) returns `media.markdown` (`![alt](media:ID)`) to paste into front, back or explanation.

## Anki decks

- Import: `curl -F file=@deck.apkg -F deck=Medicina "$RECALLFORGE_URL/api/v1/import"` (cloze, images, tags, suspended cards, scheduling and review history; re-importing only adds what is new). Large decks: `node dist/cli.mjs import deck.apkg`.
- Export for the phone (AnkiDroid/AnkiMobile): `GET /api/v1/export?format=apkg&deck=`.
- After ~200 reviews (or an imported history): `POST /api/v1/settings/optimize` fits FSRS to the learner's memory.

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
- Before a large batch, send it with `"dryRun": true`: the response lists duplicates, near-duplicates, possible contradictions with existing cards and quality problems without saving anything. Resolve them (ask the learner which answer is right when two cards disagree), then send it for real.
- Show the learner the proposed cards unless they asked you to add them directly.

## From a document (PDF, slides, notes)

1. Store it. If you read the file yourself, send the text; otherwise upload the file:
   `rf -X POST "$RECALLFORGE_URL/api/v1/documents" -d '{"title":"Guyton cap. 9","deck":"Medicina::Fisiología","text":"..."}'`
   `curl -sS ${RECALLFORGE_TOKEN:+-H "Authorization: Bearer $RECALLFORGE_TOKEN"} -F file=@clase3.pdf -F deck="Medicina::Fisiología" "$RECALLFORGE_URL/api/v1/documents"`
   The learner can also upload it in the web app (*Documentos*); find it with `GET /api/v1/documents`.
2. Read it part by part (pages, slides or sections, each with how many cards it already has):
   `rf "$RECALLFORGE_URL/api/v1/documents/ID/read?fromPart=0"` → follow `nextPart` until it is `null`.
3. Create the cards as drafts linked to their part (source and deck are filled from the document):
   `rf -X POST "$RECALLFORGE_URL/api/v1/cards" -d '{"documentId":"ID","draft":true,"cards":[{"front":"...","back":"...","documentPart":0,"excerpt":"exact sentence copied from that part"}]}'`
   Always include `excerpt`, copied verbatim: RecallForge checks it against the page and shows it to the learner.
   Fix anything listed in the response `warnings` with `PATCH /api/v1/cards/{id}`.
4. Summarise what you created per section and let the learner review. Never approve on your own. Approve (when they say so) with
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
| Fix or move a card (propose it first) | `PATCH /api/v1/cards/{id}` with any of `front, back, explanation, source, excerpt, tags, deck, suspended` and a `reason` |
| Edit history / undo an edit | `GET /api/v1/cards/{id}/revisions`, `POST /api/v1/revisions/{revisionId}/revert` |
| Import cards or a backup | `POST /api/v1/import` with a RecallForge JSON export, CSV or TSV (`?deck=&draft=true`) |
| Export | `GET /api/v1/export` (JSON, everything) or `?format=tsv` (Anki / spreadsheets) |
| Delete a card (confirm first) | `DELETE /api/v1/cards/{id}` |
| More new cards today, exam mode | `PATCH /api/v1/settings` with `newCardsPerDay`, `maxReviewsPerDay`, `desiredRetention` |

Timestamps are UTC ISO-8601; the learner's timezone is in `stats.settings.timezone`.
