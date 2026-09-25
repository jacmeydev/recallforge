// ============================================================================
// RecallForge — Media (images in cards)
// ============================================================================
// Images live inside the database (one file to back up) and are referenced
// from card text as ![description](media:ID). Identical files are stored once.
// ============================================================================

import crypto from 'crypto';
import { genId, getDb, nowIso } from './db';
import { badRequest, notFound } from './errors';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

export const MEDIA_REF = /!\[([^\]]*)\]\(media:([A-Za-z0-9-]+)\)/g;

export interface MediaInfo {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  /** Paste this in a card's front, back or explanation to show the image. */
  markdown: string;
}

function sniff(data: Uint8Array): string | null {
  const head = Buffer.from(data.subarray(0, 12));
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function mimeFor(filename: string, data?: Uint8Array): string | null {
  const byContent = data ? sniff(data) : null;
  if (byContent) return byContent;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return TYPES[ext] ?? null;
}

export function saveMedia(userId: string, file: { filename: string; data: Uint8Array; mimeType?: string }): MediaInfo {
  if (file.data.byteLength === 0) throw badRequest('The file is empty');
  if (file.data.byteLength > MAX_MEDIA_BYTES) throw badRequest('Images must be 10 MB or smaller');
  const mimeType = file.mimeType && Object.values(TYPES).includes(file.mimeType) ? file.mimeType : mimeFor(file.filename, file.data);
  if (!mimeType) throw badRequest(`Unsupported media type: ${file.filename} (use PNG, JPEG, GIF, WebP, SVG, AVIF or MP3/OGG/WAV)`);
  const sha256 = crypto.createHash('sha256').update(file.data).digest('hex');
  const db = getDb();
  const existing = db.prepare(`SELECT id, filename, mime_type, bytes FROM media WHERE user_id = ? AND sha256 = ?`).get(userId, sha256) as
    | { id: string; filename: string; mime_type: string; bytes: number }
    | undefined;
  const id = existing?.id ?? genId();
  if (!existing) {
    db.prepare(
      `INSERT INTO media (id, user_id, filename, mime_type, bytes, sha256, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, file.filename.slice(0, 200), mimeType, file.data.byteLength, sha256, Buffer.from(file.data), nowIso());
  }
  const filename = existing?.filename ?? file.filename;
  return { id, filename, mimeType: existing?.mime_type ?? mimeType, bytes: file.data.byteLength, markdown: `![${altFrom(filename)}](media:${id})` };
}

function altFrom(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/[[\]]/g, '').slice(0, 80);
}

export function getMedia(userId: string, id: string): { filename: string; mimeType: string; data: Buffer } {
  const row = getDb().prepare(`SELECT filename, mime_type, data FROM media WHERE user_id = ? AND id = ?`).get(userId, id) as
    | { filename: string; mime_type: string; data: Buffer }
    | undefined;
  if (!row) throw notFound('Media', id);
  return { filename: row.filename, mimeType: row.mime_type, data: row.data };
}

/** Media ids referenced by a text, in order of appearance. */
export function mediaIds(...texts: string[]): string[] {
  const ids: string[] = [];
  for (const text of texts) for (const match of text.matchAll(MEDIA_REF)) if (!ids.includes(match[2])) ids.push(match[2]);
  return ids;
}

/** Images of the given texts as base64, for agents that can see images and for the chat widget. */
export function mediaPayload(userId: string, texts: string[], maxBytes = 4 * 1024 * 1024): Array<{ id: string; mimeType: string; data: string }> {
  const out: Array<{ id: string; mimeType: string; data: string }> = [];
  let total = 0;
  for (const id of mediaIds(...texts)) {
    const row = getDb().prepare(`SELECT mime_type, data, bytes FROM media WHERE user_id = ? AND id = ?`).get(userId, id) as
      | { mime_type: string; data: Buffer; bytes: number }
      | undefined;
    if (!row || !row.mime_type.startsWith('image/') || total + row.bytes > maxBytes) continue;
    total += row.bytes;
    out.push({ id, mimeType: row.mime_type, data: row.data.toString('base64') });
  }
  return out;
}
