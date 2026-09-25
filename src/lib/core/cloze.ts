// ============================================================================
// RecallForge — Cloze deletions
// ============================================================================
// Anki-compatible syntax: "La {{c1::protamina}} revierte la {{c2::heparina::fármaco}}".
// Each distinct cN becomes its own card; siblings share a note id. The card
// for c1 asks "La […] revierte la heparina" and its answer is "protamina".
// Browser-safe (no Node imports): the web and the chat widget use it too.
// ============================================================================

// Always used through matchAll/replace, which never leave lastIndex behind.
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([^{}]*?))?\}\}/g;
const HAS_CLOZE = /\{\{c\d+::[\s\S]*?\}\}/;

export function isCloze(text: string): boolean {
  return HAS_CLOZE.test(text);
}

/** Distinct deletion numbers in ascending order. */
export function clozeOrdinals(text: string): number[] {
  const ords = new Set<number>();
  for (const match of text.matchAll(CLOZE)) ords.add(Number(match[1]));
  return [...ords].filter((n) => n > 0).sort((a, b) => a - b);
}

/** Question text: this card's deletions hidden as […] or [hint]; the others shown. */
export function clozeQuestion(text: string, ord: number): string {
  return text.replace(CLOZE, (_, n: string, content: string, hint?: string) =>
    Number(n) === ord ? `[${hint?.trim() || '…'}]` : content
  );
}

/** The deleted text(s) of this card. */
export function clozeAnswer(text: string, ord: number): string {
  const parts: string[] = [];
  for (const match of text.matchAll(CLOZE)) if (Number(match[1]) === ord) parts.push(match[2].trim());
  return parts.join(' … ');
}

/** Full text with this card's deletions marked ==like this== and the rest plain. */
export function clozeRevealed(text: string, ord: number): string {
  return text.replace(CLOZE, (_, n: string, content: string) => (Number(n) === ord ? `==${content}==` : content));
}

/** Plain text of the whole note (no markup), for search and similarity. */
export function clozePlain(text: string): string {
  return text.replace(CLOZE, (_, _n: string, content: string) => content);
}
