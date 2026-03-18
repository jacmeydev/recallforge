import { describe, it, expect } from 'vitest';
import {
  formatInterval,
  addMinutes,
  addDays,
  daysBetween,
  extractClozeIndices,
  processCloze,
  processClozeAnswer,
  renderTemplate,
  escapeRegex,
  chunk,
  today,
} from '@/lib/utils';

// ─── formatInterval ────────────────────────────────────────────────────────

describe('formatInterval', () => {
  it('formats minutes for sub-hour intervals', () => {
    expect(formatInterval(0.01)).toBe('14m');
  });

  it('formats hours for sub-day intervals', () => {
    expect(formatInterval(0.5)).toBe('12h');
  });

  it('formats days under 30', () => {
    expect(formatInterval(1)).toBe('1d');
    expect(formatInterval(7)).toBe('7d');
    expect(formatInterval(29)).toBe('29d');
  });

  it('formats months for 30-365 days', () => {
    expect(formatInterval(30)).toBe('1mo');
    expect(formatInterval(90)).toBe('3mo');
    expect(formatInterval(180)).toBe('6mo');
  });

  it('formats years for 365+ days', () => {
    expect(formatInterval(365)).toBe('1.0y');
    expect(formatInterval(730)).toBe('2.0y');
  });
});

// ─── Date utilities ─────────────────────────────────────────────────────────

describe('addMinutes', () => {
  it('adds positive minutes', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    const result = addMinutes(d, 30);
    expect(result.getTime() - d.getTime()).toBe(30 * 60 * 1000);
  });
});

describe('addDays', () => {
  it('adds days correctly', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    const result = addDays(d, 7);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });
});

describe('daysBetween', () => {
  it('calculates positive days', () => {
    const a = new Date('2024-01-01');
    const b = new Date('2024-01-31');
    expect(daysBetween(a, b)).toBe(30);
  });

  it('returns 0 for same day', () => {
    const d = new Date('2024-06-15');
    expect(daysBetween(d, d)).toBe(0);
  });
});

describe('today', () => {
  it('returns ISO date format YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── Cloze processing ──────────────────────────────────────────────────────

describe('extractClozeIndices', () => {
  it('extracts indices from cloze text', () => {
    const text = '{{c1::Tokyo}} is the capital of {{c2::Japan}}';
    expect(extractClozeIndices(text)).toEqual([1, 2]);
  });

  it('returns empty for non-cloze text', () => {
    expect(extractClozeIndices('plain text')).toEqual([]);
  });

  it('deduplicates indices', () => {
    const text = '{{c1::a}} and {{c1::b}}';
    expect(extractClozeIndices(text)).toEqual([1]);
  });

  it('sorts indices', () => {
    const text = '{{c3::x}} {{c1::y}} {{c2::z}}';
    expect(extractClozeIndices(text)).toEqual([1, 2, 3]);
  });
});

describe('processCloze', () => {
  it('hides active cloze with placeholder', () => {
    const text = '{{c1::Tokyo}} is the capital';
    const result = processCloze(text, 1);
    expect(result).toContain('[...]');
    expect(result).not.toContain('Tokyo');
  });

  it('shows hint when provided', () => {
    const text = '{{c1::Tokyo::city}}';
    const result = processCloze(text, 1);
    expect(result).toContain('[city]');
  });

  it('reveals non-active clozes', () => {
    const text = '{{c1::Tokyo}} {{c2::Japan}}';
    const result = processCloze(text, 1);
    expect(result).toContain('Japan'); // c2 revealed
    expect(result).not.toContain('Tokyo'); // c1 hidden
  });
});

describe('processClozeAnswer', () => {
  it('shows answer for active cloze', () => {
    const text = '{{c1::Tokyo}} is in {{c2::Japan}}';
    const result = processClozeAnswer(text, 1);
    expect(result).toContain('Tokyo');
    expect(result).toContain('cloze-answer');
  });
});

// ─── Template rendering ────────────────────────────────────────────────────

describe('renderTemplate', () => {
  it('replaces field placeholders', () => {
    const tmpl = 'What is {{Front}}?';
    const result = renderTemplate(tmpl, { Front: 'Tokyo' });
    expect(result).toBe('What is Tokyo?');
  });

  it('replaces multiple fields', () => {
    const tmpl = '{{Front}} → {{Back}}';
    const result = renderTemplate(tmpl, { Front: 'dog', Back: 'perro' });
    expect(result).toBe('dog → perro');
  });

  it('handles cloze with index', () => {
    const tmpl = '{{c1::answer}} text';
    const result = renderTemplate(tmpl, {}, { clozeIndex: 1 });
    expect(result).toContain('[...]');
  });
});

// ─── Misc utilities ─────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  it('escapes special regex chars', () => {
    expect(escapeRegex('a.b*c+d')).toBe('a\\.b\\*c\\+d');
  });
});

describe('chunk', () => {
  it('splits array into chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles empty array', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('handles chunk size >= array len', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});
