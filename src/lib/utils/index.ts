import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

// ─── Tailwind class merge utility ──────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── ID generation ─────────────────────────────────────────────────────────
export function generateId(): string {
  return uuidv4();
}

// ─── Date utilities ────────────────────────────────────────────────────────
export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

export function formatInterval(days: number): string {
  if (days < 1) {
    const minutes = Math.round(days * 24 * 60);
    if (minutes <= 0) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours}h ${remMin}m`;
}

// ─── Hash utility ──────────────────────────────────────────────────────────
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Template rendering ───────────────────────────────────────────────────
export function renderTemplate(
  template: string,
  fieldValues: Record<string, string>,
  options?: { clozeIndex?: number }
): string {
  let result = template;

  // Replace {{FieldName}} with values
  for (const [key, value] of Object.entries(fieldValues)) {
    const regex = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  // Handle cloze deletions
  if (options?.clozeIndex !== undefined) {
    result = processCloze(result, options.clozeIndex);
  }

  // Handle {{FrontSide}} — handled in the study component, not here

  // Clean up unreplaced {{FieldName}} placeholders (but not {{FrontSide}} or {{cloze:...}} or {{type:...}})
  result = result.replace(
    /\{\{(?!FrontSide|cloze:|type:)([^}]+)\}\}/g,
    ''
  );

  return result;
}

export function processCloze(text: string, activeIndex: number): string {
  // Match {{c1::answer::hint}} or {{c1::answer}}
  return text.replace(
    /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g,
    (match, indexStr, answer, hint) => {
      const idx = parseInt(indexStr, 10);
      if (idx === activeIndex) {
        return `<span class="cloze-active">[${hint || '...'}]</span>`;
      }
      return answer;
    }
  );
}

export function processClozeAnswer(text: string, activeIndex: number): string {
  return text.replace(
    /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g,
    (match, indexStr, answer) => {
      const idx = parseInt(indexStr, 10);
      if (idx === activeIndex) {
        return `<span class="cloze-answer">${answer}</span>`;
      }
      return answer;
    }
  );
}

export function extractClozeIndices(text: string): number[] {
  const indices = new Set<number>();
  const regex = /\{\{c(\d+)::/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    indices.add(parseInt(match[1], 10));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

// ─── HTML sanitization (DOMPurify) ─────────────────────────────────────────
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'sub', 'sup', 'span', 'div',
  'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
  'img', 'audio', 'video', 'source', 'a', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
];

const ALLOWED_ATTR = [
  'class', 'id', 'src', 'href', 'alt', 'title', 'style',
  'width', 'height', 'target', 'rel', 'controls', 'type',
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}

// ─── Image Occlusion rendering ─────────────────────────────────────────────

export function processIOFront(imageSrc: string, masksJson: string, activeMaskIndex: number): string {
  let masks: Array<{ x: number; y: number; width: number; height: number }> = [];
  try { masks = JSON.parse(masksJson); } catch { return imageSrc; }
  if (!Array.isArray(masks) || masks.length === 0) return imageSrc;

  const svgRects = masks.map((m, i) => {
    const isActive = i === activeMaskIndex;
    const fill = isActive ? 'rgba(33,150,243,0.85)' : 'rgba(255,87,34,0.65)';
    const stroke = isActive ? '#1565C0' : '#BF360C';
    return `<rect x="${(m.x * 100).toFixed(2)}%" y="${(m.y * 100).toFixed(2)}%" width="${(m.width * 100).toFixed(2)}%" height="${(m.height * 100).toFixed(2)}%" fill="${fill}" stroke="${stroke}" stroke-width="1.5" rx="3"/>`;
  }).join('');

  return `<div class="io-container" style="position:relative;display:inline-block;width:100%"><img src="${escapeAttr(imageSrc)}" alt="Image Occlusion" style="display:block;width:100%;height:auto;border-radius:8px" /><svg style="position:absolute;inset:0;width:100%;height:100%" preserveAspectRatio="none">${svgRects}</svg></div>`;
}

export function processIOBack(imageSrc: string, masksJson: string, activeMaskIndex: number): string {
  let masks: Array<{ x: number; y: number; width: number; height: number }> = [];
  try { masks = JSON.parse(masksJson); } catch { return imageSrc; }
  if (!Array.isArray(masks) || masks.length === 0) return imageSrc;

  const svgRects = masks.map((m, i) => {
    const isActive = i === activeMaskIndex;
    // Active mask: revealed (dashed green border), others: still hidden
    if (isActive) {
      return `<rect x="${(m.x * 100).toFixed(2)}%" y="${(m.y * 100).toFixed(2)}%" width="${(m.width * 100).toFixed(2)}%" height="${(m.height * 100).toFixed(2)}%" fill="none" stroke="#4CAF50" stroke-width="2" stroke-dasharray="6 3" rx="3"/>`;
    }
    return `<rect x="${(m.x * 100).toFixed(2)}%" y="${(m.y * 100).toFixed(2)}%" width="${(m.width * 100).toFixed(2)}%" height="${(m.height * 100).toFixed(2)}%" fill="rgba(255,87,34,0.65)" stroke="#BF360C" stroke-width="1.5" rx="3"/>`;
  }).join('');

  return `<div class="io-container" style="position:relative;display:inline-block;width:100%"><img src="${escapeAttr(imageSrc)}" alt="Image Occlusion" style="display:block;width:100%;height:auto;border-radius:8px" /><svg style="position:absolute;inset:0;width:100%;height:100%" preserveAspectRatio="none">${svgRects}</svg></div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Misc ──────────────────────────────────────────────────────────────────
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let last = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
