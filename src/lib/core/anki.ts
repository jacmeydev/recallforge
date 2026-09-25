// ============================================================================
// RecallForge — Anki packages (.apkg / .colpkg)
// ============================================================================
// Import: every Anki package format (collection.anki2, .anki21 and the current
// zstd-compressed .anki21b with its protobuf media map). Notes, cloze and
// basic note types, images, tags, subdecks, suspended cards, the scheduling
// state (FSRS memory state when Anki has it, an estimate otherwise) and the
// full review history come across. Re-importing skips cards already imported.
// Export: a classic .apkg that Anki desktop, AnkiDroid and AnkiMobile open, so
// cards made with your agent can be studied on the phone.
// ============================================================================

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import yauzl from 'yauzl';
import { normalizeTags } from './cards';
import { clozeOrdinals } from './cloze';
import { genId, getDb } from './db';
import { deckScopeSql, getOrCreateDeck, normalizeDeckPath } from './decks';
import { badRequest } from './errors';
import { getMedia, MEDIA_REF, saveMedia } from './media';
import type { ImportResult } from './import';
import type { CardRow, CardState, Rating } from './types';

// ---------------------------------------------------------------------------
// Zip access (random access, no need to load a multi-GB deck in memory)
// ---------------------------------------------------------------------------

interface ZipReader {
  names: Set<string>;
  read(name: string): Promise<Buffer>;
  close(): void;
}

function openZip(file: string): Promise<ZipReader> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) return reject(badRequest('This is not a valid Anki package (.apkg is a zip file)'));
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('error', reject);
      zip.on('end', () =>
        resolve({
          names: new Set(entries.keys()),
          read: (name) =>
            new Promise((res, rej) => {
              const entry = entries.get(name);
              if (!entry) return rej(new Error(`Missing ${name} in package`));
              zip.openReadStream(entry, (err, stream) => {
                if (err || !stream) return rej(err);
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => res(Buffer.concat(chunks)));
                stream.on('error', rej);
              });
            }),
          close: () => zip.close(),
        })
      );
      zip.readEntry();
    });
  });
}

function zstd(data: Buffer): Buffer {
  const decompress = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;
  if (!decompress) throw badRequest('This Anki package uses the new compressed format: update Node.js to 22.15 or newer, or export from Anki with "Support older Anki versions" checked');
  return decompress(data);
}

// ---------------------------------------------------------------------------
// Minimal protobuf reader (Anki 2.1.50+ stores note types and the media map as protobuf)
// ---------------------------------------------------------------------------

type ProtoFields = Map<number, Array<number | Buffer>>;

function readProto(buf: Buffer): ProtoFields {
  const fields: ProtoFields = new Map();
  let pos = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = buf[pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let value: number | Buffer;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      value = buf.subarray(pos, pos + length);
      pos += length;
    } else if (wire === 1) {
      value = 0;
      pos += 8;
    } else if (wire === 5) {
      value = 0;
      pos += 4;
    } else break;
    const list = fields.get(field) ?? [];
    list.push(value);
    fields.set(field, list);
  }
  return fields;
}

const protoString = (fields: ProtoFields, n: number) => {
  const value = fields.get(n)?.[0];
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
};
const protoNumber = (fields: ProtoFields, n: number) => {
  const value = fields.get(n)?.[0];
  return typeof value === 'number' ? value : 0;
};

// ---------------------------------------------------------------------------
// Anki HTML → RecallForge card text
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  const named: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', ndash: '–', mdash: '—', hellip: '…', rarr: '→', larr: '←', uarr: '↑', darr: '↓', deg: '°', micro: 'µ', plusmn: '±', times: '×', le: '≤', ge: '≥', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return named[code.toLowerCase()] ?? match;
  });
}

export function ankiHtmlToText(html: string, image: (filename: string) => string | null): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/\[sound:[^\]]+\]/g, '')
      .replace(/<img[^>]*?src\s*=\s*["']?([^"'>\s]+)["']?[^>]*>/gi, (_, src: string) => {
        const ref = image(decodeEntities(decodeURIComponent(src.replace(/%(?![0-9a-f]{2})/gi, '%25'))));
        return ref ? `\n${ref}\n` : '';
      })
      .replace(/<\s*(b|strong)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, (_, _t, inner: string) => (inner.trim() ? `**${inner}**` : inner))
      .replace(/<\s*(i|em)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, (_, _t, inner: string) => (inner.trim() ? `*${inner}*` : inner))
      .replace(/<\s*li\b[^>]*>/gi, '\n- ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*li\s*>/gi, '')
      .replace(/<\/\s*(div|p|h[1-6]|tr|ul|ol|table)\s*>/gi, '\n')
      .replace(/<\s*(div|p|h[1-6]|tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Anki card template → HTML for one side, with field values substituted. */
export function renderAnkiTemplate(format: string, fields: Record<string, string>): string {
  let out = format;
  // Conditional sections, innermost first.
  for (let guard = 0; guard < 20; guard++) {
    const next = out.replace(/\{\{([#^])([^}]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/g, (_, kind: string, name: string, inner: string) => {
      const filled = Boolean(ankiHtmlToText(fields[name.trim()] ?? '', () => 'img').trim());
      return (kind === '#') === filled ? inner : '';
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{([^}]+)\}\}/g, (_, tag: string) => {
    const parts = tag.split(':').map((p) => p.trim());
    const name = parts[parts.length - 1];
    const filters = parts.slice(0, -1);
    if (name === 'FrontSide' || filters.includes('type') || filters.includes('tts')) return '';
    const value = fields[name] ?? '';
    return filters.includes('text') ? value.replace(/<[^>]+>/g, '') : value;
  });
}

const answerPart = (html: string) => {
  const marker = html.search(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i);
  return marker >= 0 ? html.slice(marker).replace(/^<hr[^>]*>/i, '') : html;
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface NoteType {
  name: string;
  cloze: boolean;
  fields: string[];
  templates: Array<{ q: string; a: string }>;
}

interface AnkiImportOptions {
  /** Put every imported deck under this subject (e.g. "Medicina"). */
  deck?: string;
  draft?: boolean;
  /** Skip the review history (faster; the memory state of each card is still imported). */
  skipHistory?: boolean;
}

const DAY_MS = 86_400_000;

/** Import an Anki package from a file on disk. */
export async function importApkg(userId: string, file: string, options: AnkiImportOptions = {}): Promise<ImportResult> {
  const zip = await openZip(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recallforge-apkg-'));
  try {
    const modern = zip.names.has('collection.anki21b');
    const collectionName = modern ? 'collection.anki21b' : zip.names.has('collection.anki21') ? 'collection.anki21' : 'collection.anki2';
    if (!zip.names.has(collectionName)) throw badRequest('No Anki collection found in the package');
    const raw = await zip.read(collectionName);
    const dbFile = path.join(tmp, 'collection.db');
    fs.writeFileSync(dbFile, modern ? zstd(raw) : raw);

    // Media map: zip entry name ("0", "1"…) for each file name.
    const mediaEntry = new Map<string, string>();
    if (zip.names.has('media')) {
      const mediaRaw = await zip.read('media');
      if (modern) {
        const entries = readProto(zstd(mediaRaw)).get(1) ?? [];
        entries.forEach((entry, index) => {
          const fields = readProto(entry as Buffer);
          const legacy = fields.get(255)?.[0];
          mediaEntry.set(protoString(fields, 1), String(typeof legacy === 'number' ? legacy : index));
        });
      } else {
        const map = JSON.parse(mediaRaw.toString('utf8') || '{}') as Record<string, string>;
        for (const [entry, name] of Object.entries(map)) mediaEntry.set(name, entry);
      }
    }
    // Media files are read up front (only those referenced by notes), then the import is one transaction.
    const anki = new Database(dbFile, { readonly: true });
    try {
      return await importCollection(userId, anki, { zip, modern, mediaEntry }, options);
    } finally {
      anki.close();
    }
  } finally {
    zip.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function importCollection(
  userId: string,
  anki: Database.Database,
  media: { zip: ZipReader; modern: boolean; mediaEntry: Map<string, string> },
  options: AnkiImportOptions
): Promise<ImportResult> {
  const result: ImportResult = { format: 'anki', decks: 0, documents: 0, cards: 0, reviews: 0, revisions: 0, skipped: 0, warnings: [] };
  const hasTable = (name: string) => anki.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
  const col = anki.prepare(`SELECT crt, models, decks FROM col LIMIT 1`).get() as { crt: number; models: string; decks: string };

  // Note types and decks (schema 18 tables, or the legacy JSON in col).
  const noteTypes = new Map<number, NoteType>();
  const deckNames = new Map<number, string>();
  if (hasTable('notetypes')) {
    for (const nt of anki.prepare(`SELECT id, name, config FROM notetypes`).all() as Array<{ id: number; name: string; config: Buffer }>) {
      const config = readProto(nt.config ?? Buffer.alloc(0));
      const fields = (anki.prepare(`SELECT name FROM fields WHERE ntid = ? ORDER BY ord`).all(nt.id) as Array<{ name: string }>).map((f) => f.name);
      const templates = (anki.prepare(`SELECT config FROM templates WHERE ntid = ? ORDER BY ord`).all(nt.id) as Array<{ config: Buffer }>).map((t) => {
        const tc = readProto(t.config ?? Buffer.alloc(0));
        return { q: protoString(tc, 1), a: protoString(tc, 2) };
      });
      noteTypes.set(nt.id, { name: nt.name, cloze: protoNumber(config, 1) === 1 || templates.some((t) => /\{\{cloze:/i.test(t.q)), fields, templates });
    }
    for (const deck of anki.prepare(`SELECT id, name FROM decks`).all() as Array<{ id: number; name: string }>) {
      deckNames.set(deck.id, deck.name.split('\x1f').join('::'));
    }
  } else {
    const models = JSON.parse(col.models || '{}') as Record<string, { name: string; type: number; flds: Array<{ name: string; ord: number }>; tmpls: Array<{ qfmt: string; afmt: string; ord: number }> }>;
    for (const [id, m] of Object.entries(models)) {
      noteTypes.set(Number(id), {
        name: m.name,
        cloze: m.type === 1,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ q: t.qfmt, a: t.afmt })),
      });
    }
    for (const [id, d] of Object.entries(JSON.parse(col.decks || '{}') as Record<string, { name: string }>)) deckNames.set(Number(id), d.name);
  }

  const notes = new Map(
    (anki.prepare(`SELECT id, guid, mid, tags, flds FROM notes`).all() as Array<{ id: number; guid: string; mid: number; tags: string; flds: string }>).map(
      (n) => [n.id, n]
    )
  );
  const cards = anki
    .prepare(`SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, odue, data FROM cards ORDER BY did, due, ord`)
    .all() as Array<{
    id: number;
    nid: number;
    did: number;
    ord: number;
    type: number;
    queue: number;
    due: number;
    ivl: number;
    factor: number;
    reps: number;
    lapses: number;
    odid: number;
    odue: number;
    data: string;
  }>;
  if (cards.length === 0) throw badRequest('The Anki package has no cards');

  // Pre-load the media referenced by the notes we will import.
  const imageIds = new Map<string, string | null>();
  for (const note of notes.values()) {
    for (const match of note.flds.matchAll(/<img[^>]*?src\s*=\s*["']?([^"'>\s]+)["']?/gi)) {
      let name = match[1];
      try {
        name = decodeURIComponent(name);
      } catch {
        // keep the raw name
      }
      name = decodeEntities(name);
      if (imageIds.has(name)) continue;
      const entry = media.mediaEntry.get(name);
      if (!entry || !media.zip.names.has(entry)) {
        imageIds.set(name, null);
        continue;
      }
      try {
        const data = await media.zip.read(entry);
        imageIds.set(name, saveMedia(userId, { filename: name, data: media.modern ? zstd(data) : data }).id);
      } catch {
        imageIds.set(name, null);
      }
    }
  }
  const missingImages = [...imageIds.values()].filter((id) => id === null).length;
  if (missingImages > 0) result.warnings.push(`${missingImages} images referenced by the notes were not in the package (export from Anki with "Include media").`);
  const image = (name: string) => {
    const id = imageIds.get(name);
    return id ? `![${name.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]_-]+/g, ' ').slice(0, 60)}](media:${id})` : null;
  };
  const text = (html: string) => ankiHtmlToText(html, image);

  const db = getDb();
  const crtMs = col.crt * 1000;
  const now = new Date();
  const status = options.draft ? 'draft' : 'active';
  const lastReview = new Map<number, number>();
  for (const row of anki.prepare(`SELECT cid, MAX(id) AS last FROM revlog WHERE ease > 0 GROUP BY cid`).all() as Array<{ cid: number; last: number }>) {
    lastReview.set(row.cid, row.last);
  }
  const deckCache = new Map<number, { id: string; name: string }>();
  const deckFor = (did: number) => {
    let deck = deckCache.get(did);
    if (!deck) {
      const ankiName = normalizeDeckPath(deckNames.get(did) ?? 'Anki') || 'Anki';
      const name = options.deck ? `${normalizeDeckPath(options.deck)}::${ankiName}` : ankiName;
      const { deck: created, created: isNew } = getOrCreateDeck(userId, name);
      if (isNew) result.decks++;
      deck = { id: created.id, name: created.name };
      deckCache.set(did, deck);
    }
    return deck;
  };
  const exists = db.prepare(`SELECT id FROM cards WHERE user_id = ? AND external_id = ?`);
  const insert = db.prepare(`
    INSERT INTO cards (id, user_id, deck_id, front, back, explanation, source, excerpt, tags, state, due_at, stability, difficulty,
      elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_at, suspended, status, kind, cloze_ord, note_id, external_id,
      created_at, updated_at)
    VALUES (@id, @userId, @deckId, @front, @back, @explanation, @source, '', @tags, @state, @dueAt, @stability, @difficulty,
      0, @scheduledDays, @reps, @lapses, 0, @lastReviewAt, @suspended, @status, @kind, @clozeOrd, @noteId, @externalId, @createdAt, @createdAt)`);
  const idByAnkiCard = new Map<number, { id: string; state: CardState }>();
  let occlusions = 0;
  let empty = 0;

  db.transaction(() => {
    cards.forEach((card, position) => {
      const note = notes.get(card.nid);
      const type = note ? noteTypes.get(note.mid) : undefined;
      if (!note || !type) return;
      const externalId = `anki:${note.guid}:${card.ord}`;
      const existing = exists.get(userId, externalId) as { id: string } | undefined;
      if (existing) {
        result.skipped++;
        return;
      }
      const values = note.flds.split('\x1f');
      const fields: Record<string, string> = Object.fromEntries(type.fields.map((name, i) => [name, values[i] ?? '']));

      let front: string;
      let back: string;
      let explanation = '';
      let kind: 'basic' | 'cloze' = 'basic';
      let clozeOrd: number | null = null;
      if (type.cloze) {
        const clozeField = /\{\{(?:[^}]*:)?cloze:([^}]+)\}\}/i.exec(type.templates[0]?.q ?? '')?.[1]?.trim() ?? type.fields[0];
        const source = fields[clozeField] ?? '';
        const others = type.fields.filter((name) => name !== clozeField && ankiHtmlToText(fields[name] ?? '', () => 'img').trim());
        const extraName = others.find((name) => /extra|back|reverso|dorso|notas?/i.test(name)) ?? others[0];
        back = extraName ? text(fields[extraName]) : '';
        explanation = others
          .filter((name) => name !== extraName)
          .map((name) => `**${name}:** ${text(fields[name])}`)
          .join('\n\n')
          .slice(0, 6000);
        if (/image-occlusion:/i.test(source)) {
          // Native image occlusion: show the image and ask for the hidden region's label.
          occlusions++;
          const imageField = type.fields.find((name) => /<img/i.test(fields[name] ?? '')) ?? '';
          const label = new RegExp(`\\{\\{c${card.ord + 1}::image-occlusion:[^}]*?text=([^:}]+)`, 'i').exec(source)?.[1];
          front = `${text(fields[imageField] ?? '')}\n¿Qué estructura está oculta en la región ${card.ord + 1}?`;
          back = label ? label.trim() : back || '(ver la imagen en Anki)';
        } else {
          front = text(source);
          kind = 'cloze';
          clozeOrd = card.ord + 1;
          if (!clozeOrdinals(front).includes(clozeOrd)) {
            empty++;
            return;
          }
        }
      } else {
        const template = type.templates[card.ord] ?? type.templates[0];
        if (!template) return;
        front = text(renderAnkiTemplate(template.q, fields));
        back = text(answerPart(renderAnkiTemplate(template.a, fields)));
        if (!front) {
          empty++;
          return;
        }
        if (!back) back = '—';
      }

      // Scheduling. Card data may hold Anki's own FSRS memory state ({"s": stability, "d": difficulty}).
      let data: { s?: number; d?: number } = {};
      try {
        data = card.data ? JSON.parse(card.data) : {};
      } catch {
        data = {};
      }
      const due = card.odid ? card.odue : card.due;
      const lastMs = lastReview.get(card.id);
      let state: CardState = 'new';
      let dueAt = now;
      let stability = 0;
      let difficulty = 0;
      let lastReviewAt: string | null = null;
      if (card.type === 2 || card.type === 3 || card.type === 1) {
        state = card.type === 2 ? 'review' : card.type === 3 ? 'relearning' : 'learning';
        if (card.type === 2 || card.queue === 3) dueAt = new Date(crtMs + due * DAY_MS);
        else dueAt = new Date(due > 1e9 ? due * 1000 : crtMs + due * DAY_MS);
        const ivl = Math.max(card.ivl, 0);
        stability = data.s ?? Math.max(ivl, card.type === 2 ? 1 : 0.5);
        difficulty = data.d ?? Math.min(10, Math.max(1, 5 + (2500 - (card.factor || 2500)) / 200));
        lastReviewAt = new Date(lastMs ?? dueAt.getTime() - ivl * DAY_MS).toISOString();
      }
      const id = genId();
      insert.run({
        id,
        userId,
        deckId: deckFor(card.odid || card.did).id,
        front: front.slice(0, 8000),
        back: back.slice(0, 8000),
        explanation,
        source: '',
        tags: JSON.stringify(normalizeTags(note.tags.split(/\s+/).filter(Boolean)).slice(0, 30)),
        state,
        dueAt: dueAt.toISOString(),
        stability,
        difficulty,
        scheduledDays: state === 'review' ? Math.max(card.ivl, 1) : 0,
        reps: card.reps,
        lapses: card.lapses,
        lastReviewAt,
        suspended: card.queue === -1 ? 1 : 0,
        status,
        kind,
        clozeOrd,
        noteId: kind === 'cloze' ? `anki-${note.id}` : null,
        externalId,
        createdAt: new Date(now.getTime() - (cards.length - position)).toISOString(),
      });
      idByAnkiCard.set(card.id, { id, state });
      result.cards++;
    });

    if (!options.skipHistory && idByAnkiCard.size > 0) {
      const insertLog = db.prepare(`
        INSERT INTO review_logs (id, user_id, card_id, reviewed_at, rating, state, next_state, due_at, next_due_at, stability, next_stability,
          difficulty, next_difficulty, elapsed_days, scheduled_days, duration_ms, answer, feedback, source, mode, format)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, 'anki', 'review', 'recall')`);
      const RATING: Rating[] = ['again', 'hard', 'good', 'easy'];
      const STATES: CardState[] = ['learning', 'review', 'relearning', 'review'];
      for (const log of anki.prepare(`SELECT id, cid, ease, ivl, type, time FROM revlog WHERE ease BETWEEN 1 AND 4 AND type <= 3 ORDER BY id`).iterate() as Iterable<{
        id: number;
        cid: number;
        ease: number;
        ivl: number;
        type: number;
        time: number;
      }>) {
        const card = idByAnkiCard.get(log.cid);
        if (!card) continue;
        const nextMs = log.id + (log.ivl < 0 ? -log.ivl * 1000 : log.ivl * DAY_MS);
        insertLog.run(
          genId(),
          userId,
          card.id,
          new Date(log.id).toISOString(),
          RATING[log.ease - 1],
          STATES[log.type] ?? 'review',
          log.ivl > 0 ? 'review' : 'learning',
          new Date(nextMs).toISOString(),
          log.ivl > 0 ? log.ivl : 0,
          log.time > 0 ? Math.min(log.time, 3_600_000) : null
        );
        result.reviews++;
      }
    }
  })();

  if (occlusions) result.warnings.push(`${occlusions} image-occlusion cards were imported as "which structure is hidden?" questions with the image.`);
  if (empty) result.warnings.push(`${empty} cards had an empty question and were skipped.`);
  if (result.cards > 0 && result.reviews > 400) {
    result.warnings.push('Tip: your Anki history is large enough to personalise the scheduler — run optimize_scheduler.');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const BASIC_MODEL_ID = 1_714_000_000_001;
const CLOZE_MODEL_ID = 1_714_000_000_002;
const CSS = `.card { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 20px; text-align: center; color: black; background-color: white; }
.nightMode .card, .night_mode .card { color: #eee; background-color: #1e1e1e; }
.cloze { font-weight: bold; color: #2a78d6; }
.nightMode .cloze { color: #6da7ec; }
.extra, .source { font-size: 15px; color: #666; margin-top: 12px; }
img { max-width: 100%; }`;

function model(id: number, name: string, cloze: boolean, deckId: number) {
  const fields = cloze ? ['Text', 'Back Extra', 'Explanation', 'Source'] : ['Front', 'Back', 'Explanation', 'Source'];
  const tail = `{{#Explanation}}<div class="extra">{{Explanation}}</div>{{/Explanation}}{{#Source}}<div class="source">{{Source}}</div>{{/Source}}`;
  return {
    id: String(id),
    name,
    type: cloze ? 1 : 0,
    mod: Math.floor(Date.now() / 1000),
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: [
      cloze
        ? { name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: `{{cloze:Text}}{{#Back Extra}}<hr><div>{{Back Extra}}</div>{{/Back Extra}}${tail}`, did: null, bqfmt: '', bafmt: '', bfont: '', bsize: 0 }
        : { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: `{{FrontSide}}<hr id=answer>{{Back}}${tail}`, did: null, bqfmt: '', bafmt: '', bfont: '', bsize: 0 },
    ],
    flds: fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    css: CSS,
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: [],
  };
}

/** RecallForge text → Anki field HTML (images become <img src> of the exported files). */
function toAnkiHtml(text: string, mediaName: (id: string) => string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escape(text)
    .replace(MEDIA_REF, (_, alt: string, id: string) => `<img src="${mediaName(id)}" alt="${alt.replace(/"/g, '&quot;')}">`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/\n/g, '<br>');
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, '').trim();
const checksum = (text: string) => parseInt(crypto.createHash('sha1').update(stripHtml(text)).digest('hex').slice(0, 8), 16);
const ankiId = (seed: string) => parseInt(crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12), 16) % 2 ** 52;

export async function exportApkg(userId: string, options: { deck?: string } = {}): Promise<Buffer> {
  const db = getDb();
  const where = ['c.user_id = @userId', `c.status = 'active'`];
  const params: Record<string, unknown> = { userId };
  if (options.deck) {
    const scope = deckScopeSql(userId, options.deck);
    where.push(scope.sql);
    Object.assign(params, scope.params);
  }
  const rows = db
    .prepare(`SELECT c.*, d.name AS deck_name FROM cards c JOIN decks d ON d.id = c.deck_id WHERE ${where.join(' AND ')} ORDER BY c.created_at, c.rowid`)
    .all(params) as CardRow[];
  if (rows.length === 0) throw badRequest('There are no cards to export');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recallforge-export-'));
  try {
    const file = path.join(tmp, 'collection.anki2');
    const out = new Database(file);
    const crt = Math.floor(new Date('2020-01-01T04:00:00Z').getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const today = Math.floor((Date.now() / 1000 - crt) / 86400);

    const decks: Record<string, unknown> = {
      1: { id: 1, name: 'Default', conf: 1, desc: '', dyn: 0, collapsed: false, extendNew: 10, extendRev: 50, mod: nowSec, usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0] },
    };
    const deckIds = new Map<string, number>();
    for (const name of new Set(rows.map((r) => r.deck_name))) {
      const parts = name.split('::');
      for (let i = 1; i <= parts.length; i++) {
        const path_ = parts.slice(0, i).join('::');
        if (deckIds.has(path_)) continue;
        const id = ankiId(`deck:${path_}`);
        deckIds.set(path_, id);
        decks[id] = { id, name: path_, conf: 1, desc: '', dyn: 0, collapsed: false, extendNew: 10, extendRev: 50, mod: nowSec, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0] };
      }
    }
    const firstDeck = deckIds.values().next().value ?? 1;
    const models = { [BASIC_MODEL_ID]: model(BASIC_MODEL_ID, 'RecallForge Basic', false, firstDeck), [CLOZE_MODEL_ID]: model(CLOZE_MODEL_ID, 'RecallForge Cloze', true, firstDeck) };
    out.exec(ANKI_SCHEMA);
    out.prepare(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`).run(
      crt,
      Date.now(),
      Date.now(),
      JSON.stringify({ activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: String(BASIC_MODEL_ID), nextPos: rows.length + 1, sortType: 'noteFld', sortBackwards: false, addToCur: true }),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(DECK_CONFIG)
    );

    // Media: every referenced image, exported as "rf-<id>.<ext>".
    const mediaNames = new Map<string, string>();
    const mimeOf = db.prepare(`SELECT mime_type FROM media WHERE user_id = ? AND id = ?`);
    const mediaName = (id: string) => {
      let name = mediaNames.get(id);
      if (!name) {
        const mime = (mimeOf.get(userId, id) as { mime_type: string } | undefined)?.mime_type ?? 'image/png';
        const ext = (mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        name = `rf-${id}.${ext}`;
        mediaNames.set(id, name);
      }
      return name;
    };

    const insertNote = out.prepare(`INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`);
    const insertCard = out.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, 2500, ?, ?, 0, 0, 0, 0, ?)`);
    const notesDone = new Map<string, number>();
    let position = 0;
    out.transaction(() => {
      for (const row of rows) {
        const cloze = row.kind === 'cloze';
        const noteKey = cloze && row.note_id ? `note:${row.note_id}` : `card:${row.id}`;
        let nid = notesDone.get(noteKey);
        if (nid === undefined) {
          nid = ankiId(noteKey);
          const fields = [row.front, row.back, row.explanation, row.source].map((f) => toAnkiHtml(f ?? '', mediaName));
          const tags = (JSON.parse(row.tags) as string[]).map((t) => t.replace(/\s+/g, '_'));
          insertNote.run(nid, noteKey.slice(0, 40), cloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID, nowSec, tags.length ? ` ${tags.join(' ')} ` : '', fields.join('\x1f'), stripHtml(fields[0]), checksum(fields[0]));
          notesDone.set(noteKey, nid);
        }
        position++;
        const did = deckIds.get(row.deck_name) ?? 1;
        const ord = cloze ? Math.max(0, (row.cloze_ord ?? 1) - 1) : 0;
        const dueDays = Math.round((new Date(row.due_at).getTime() / 1000 - crt) / 86400);
        const isNew = row.state === 'new';
        const type = isNew ? 0 : 2;
        const queue = row.suspended ? -1 : isNew ? 0 : 2;
        const due = isNew ? position : Math.max(dueDays, today);
        const ivl = isNew ? 0 : Math.max(1, Math.round(row.scheduled_days || row.stability || 1));
        const data = isNew ? '' : JSON.stringify({ s: Math.round(row.stability * 1000) / 1000, d: Math.round(row.difficulty * 1000) / 1000 });
        insertCard.run(ankiId(`cardrow:${row.id}`), nid, did, ord, nowSec, type, queue, due, ivl, row.reps, row.lapses, data);
      }
    })();
    out.close();

    const zip = new JSZip();
    zip.file('collection.anki2', fs.readFileSync(file));
    const map: Record<string, string> = {};
    let index = 0;
    for (const [id, name] of mediaNames) {
      try {
        zip.file(String(index), getMedia(userId, id).data);
        map[String(index)] = name;
        index++;
      } catch {
        // missing media: the card keeps its text
      }
    }
    zip.file('media', JSON.stringify(map));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const DECK_CONFIG = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
  },
};

const ANKI_SCHEMA = `
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
  usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
  flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
  type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
  lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL,
  lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

