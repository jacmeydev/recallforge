// ============================================================================
// RecallForge — Text helpers
// ============================================================================

/** Plain text from HTML: keeps line breaks, drops tags, decodes common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STOPWORDS = new Set(
  (
    'que qué cual cuál cuales cuáles como cómo cuando cuándo donde dónde por para con sin sobre entre desde hasta ' +
    'los las del una uno unos unas este esta estos estas ese esa esos esas sus son está están hay puede pueden ' +
    'the and for with what which when where how why does are is was were from that this these those into'
  ).split(' ')
);

/** Lower-cased, accent-free words of 3+ letters, without common stopwords. */
export function contentWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []
  ).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/** Jaccard similarity of two word sets (0–1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Whitespace/case/accent-insensitive "does `haystack` contain `needle`". */
export function containsLoosely(haystack: string, needle: string): boolean {
  const norm = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const n = norm(needle);
  return n.length > 0 && norm(haystack).includes(n);
}
