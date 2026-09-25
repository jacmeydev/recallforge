// ============================================================================
// RecallForge — Card quality checks
// ============================================================================
// Cheap heuristics for the most common flaws in AI-written cards (long or
// vague prompts, answers leaked in the question, yes/no questions, long lists).
// They never block a card: they come back as warnings so the agent can fix it.
// ============================================================================

export interface QualityInput {
  front: string;
  back: string;
}

const YES_NO_START = /^[¿¡]?\s*(es|son|está|están|hay|puede|pueden|debe|tiene|tienen|existe|se\s+\w+|is|are|does|do|can|should|has|have)\b/i;
const YES_NO_ANSWER = /^(sí|si|no|yes|verdadero|falso|true|false)\b[\s.,;:!]*$/i;

function words(text: string): string[] {
  return (text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').match(/\p{L}[\p{L}\p{N}-]*/gu) ?? []);
}

function listItems(text: string): number {
  const lines = text.split('\n').filter((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line));
  if (lines.length > 0) return lines.length;
  return text.split(/[,;]|\sy\s|\sand\s/).filter((item) => item.trim().length > 0).length;
}

/** Human-readable issues for one card (empty when it looks fine). */
export function checkCardQuality(card: QualityInput): string[] {
  const issues: string[] = [];
  const front = card.front.trim();
  const back = card.back.trim();

  if (front.length < 10) issues.push('Question is very short; make sure it has a single unambiguous answer.');
  if (front.length > 300) issues.push('Question is long; test one idea per card and move context to explanation.');
  if (back.length > 300) issues.push('Answer is long; keep the essential answer in back and the rest in explanation.');
  if (YES_NO_START.test(front) || YES_NO_ANSWER.test(back)) {
    issues.push('Yes/no question; ask for the concept itself (what/which/why/how) so it cannot be guessed.');
  }
  const items = listItems(back);
  if (items >= 5) issues.push(`Answer is a list of ${items} items; split it into several cards or use a mnemonic.`);

  const answerWords = words(back).filter((word) => word.length >= 5);
  const frontWords = new Set(words(front));
  if (answerWords.length > 0 && answerWords.length <= 4 && answerWords.every((word) => frontWords.has(word))) {
    issues.push('The question already contains the answer.');
  }
  return issues;
}
