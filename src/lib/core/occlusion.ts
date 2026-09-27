// ============================================================================
// RecallForge — Image occlusion
// ============================================================================
// An image with regions to hide (anatomy, histology, radiology, diagrams).
// Each region number is one card: the card covers that region (and, in
// "hide all" mode, every other one too) and asks what is underneath.
// Anki-compatible: its "Image Occlusion" notes (Anki 23.10+) are read and
// written as-is:  {{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}
// Browser-safe: the web app and the chat widget draw the masks with it.
// ============================================================================

import type { Occlusion, OcclusionShape } from './types';

const SHAPES = new Set(['rect', 'ellipse', 'polygon', 'text']);
const round = (value: number) => Math.round(value * 10000) / 10000;

/** Split "rect:left=.1:top=.2:text=a\:b" into its properties (\: and \\ are escapes). */
function parseProperties(spec: string): { shape: string; props: Record<string, string> } | null {
  const colon = spec.indexOf(':');
  if (colon < 0) return null;
  const shape = spec.slice(0, colon);
  const props: Record<string, string> = {};
  let i = colon;
  while (i < spec.length && spec[i] === ':') {
    const eq = spec.indexOf('=', i + 1);
    if (eq < 0) break;
    const name = spec.slice(i + 1, eq);
    let value = '';
    let j = eq + 1;
    while (j < spec.length && spec[j] !== ':') {
      if (spec[j] === '\\' && j + 1 < spec.length) {
        value += spec[j + 1];
        j += 2;
      } else value += spec[j++];
    }
    props[name] = value;
    i = j;
  }
  return { shape, props };
}

const escapeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

/**
 * Parse Anki's Occlusion field. Coordinates are fractions of the image size;
 * very old notes stored pixels, which are converted when the image size is known.
 */
export function parseAnkiOcclusion(field: string, imageSize?: { width: number; height: number } | null): { shapes: OcclusionShape[]; hideAll: boolean } {
  const shapes: OcclusionShape[] = [];
  let hideAll = false;
  const text = field.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');
  for (const match of text.matchAll(/\{\{c(\d+)::image-occlusion:([\s\S]*?)\}\}/g)) {
    const parsed = parseProperties(match[2].trim());
    if (!parsed || !SHAPES.has(parsed.shape)) continue;
    const { props } = parsed;
    if (props.oi === '1') hideAll = true;
    const num = (key: string) => (props[key] !== undefined && props[key] !== '' ? Number(props[key]) : undefined);
    const shape: OcclusionShape = { ord: parsed.shape === 'text' ? 0 : Number(match[1]), shape: parsed.shape as OcclusionShape['shape'] };
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      const value = num(key);
      if (value !== undefined && Number.isFinite(value)) shape[key] = value;
    }
    if (props.points) {
      shape.points = props.points
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number) as [number, number])
        .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
    }
    if (props.text) shape.label = props.text;
    shapes.push(shape);
  }
  // Pixel coordinates (pre-release Anki) → fractions.
  const maxCoord = Math.max(0, ...shapes.flatMap((s) => [s.left ?? 0, s.top ?? 0, (s.left ?? 0) + (s.width ?? 0), ...(s.points ?? []).flat()]));
  if (maxCoord > 1.5 && imageSize) {
    for (const s of shapes) {
      if (s.left !== undefined) s.left = round(s.left / imageSize.width);
      if (s.width !== undefined) s.width = round(s.width / imageSize.width);
      if (s.top !== undefined) s.top = round(s.top / imageSize.height);
      if (s.height !== undefined) s.height = round(s.height / imageSize.height);
      if (s.points) s.points = s.points.map(([x, y]) => [round(x / imageSize.width), round(y / imageSize.height)]);
    }
  }
  return { shapes, hideAll };
}

/** Write regions back in Anki's Occlusion field format. */
export function toAnkiOcclusion(occlusion: Pick<Occlusion, 'shapes' | 'hideAll'>): string {
  return occlusion.shapes
    .map((s) => {
      const props: string[] = [];
      for (const key of ['left', 'top', 'width', 'height'] as const) if (s[key] !== undefined) props.push(`${key}=${round(s[key]!)}`);
      if (s.points) props.push(`points=${s.points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}`);
      if (s.shape === 'text' && s.label) props.push(`text=${escapeValue(s.label)}`);
      if (occlusion.hideAll) props.push('oi=1');
      return `{{c${Math.max(1, s.ord)}::image-occlusion:${s.shape}:${props.join(':')}}}`;
    })
    .join('<br>');
}

/** Region numbers that become cards, in order. */
export function occlusionOrdinals(occlusion: Pick<Occlusion, 'shapes'>): number[] {
  return [...new Set(occlusion.shapes.filter((s) => s.shape !== 'text' && s.ord > 0).map((s) => s.ord))].sort((a, b) => a - b);
}

/** The answer of one card: the names of its regions, when they were given. */
export function occlusionAnswer(occlusion: Pick<Occlusion, 'shapes'>, ord: number): string {
  const labels = occlusion.shapes.filter((s) => s.ord === ord && s.shape !== 'text' && s.label).map((s) => s.label!.trim());
  return [...new Set(labels)].join(' / ');
}

/** What the learner may see before answering: the asked regions lose their names. */
export function occlusionForQuestion(occlusion: Occlusion, ord: number): Occlusion & { ord: number } {
  return { ...occlusion, ord, shapes: occlusion.shapes.map((s) => (s.ord === ord && s.shape !== 'text' ? { ...s, label: undefined } : s)) };
}

/** Width and height from a PNG, GIF, JPEG or WebP header (used to convert pixel coordinates). */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const b = data;
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50) return { width: u32be(16), height: u32be(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(o + 7), height: u16be(o + 5) };
      o += 2 + u16be(o + 2);
    }
    return null;
  }
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  }
  return null;
}
