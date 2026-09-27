// ============================================================================
// RecallForge — Sync with Anki (AnkiConnect)
// ============================================================================
// With Anki desktop open and the AnkiConnect add-on installed:
//   1. Reviews made in Anki (on the phone via AnkiWeb sync, or on the desktop)
//      for linked cards are replayed into RecallForge in order, so its schedule,
//      stats and progress map include them.
//   2. New or edited RecallForge cards are written to Anki (same subject path,
//      images included), ready to study in AnkiDroid/AnkiMobile after Anki syncs.
// Nothing is ever deleted on either side.
// ============================================================================

import crypto from 'crypto';
import { model, occlusionModel, toAnkiHtml } from './anki';
import { parseOcclusion } from './cards';
import { getDb, nowIso } from './db';
import { deckScopeSql } from './decks';
import { badRequest } from './errors';
import { getMedia } from './media';
import { toAnkiOcclusion } from './occlusion';
import { gradeCard } from './study';
import type { CardRow, Rating } from './types';

export const DEFAULT_ANKICONNECT_URL = 'http://127.0.0.1:8765';
const BASIC_MODEL = 'RecallForge Basic';
const CLOZE_MODEL = 'RecallForge Cloze';
const OCCLUSION_MODEL = 'Image Occlusion';
const BATCH = 100;

export interface AnkiSyncOptions {
  /** Only this subject (and its subdecks). */
  deck?: string;
  url?: string;
  /** AnkiConnect API key, if one is configured in the add-on. */
  key?: string;
  /** Only report what would change. */
  dryRun?: boolean;
}

export interface AnkiSyncResult {
  ankiConnectVersion: number;
  /** Reviews made in Anki and applied here. */
  reviewsPulled: number;
  /** Notes created in Anki. */
  notesAdded: number;
  /** Notes whose content changed here and was updated in Anki. */
  notesUpdated: number;
  mediaStored: number;
  skipped: number;
  warnings: string[];
}

class AnkiConnect {
  constructor(
    private readonly url: string,
    private readonly key?: string
  ) {}

  async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: 6, params, ...(this.key ? { key: this.key } : {}) }),
      });
    } catch {
      throw badRequest(
        `Anki is not reachable at ${this.url}. Open Anki desktop with the AnkiConnect add-on (code 2055492159) installed, then try again.`
      );
    }
    const body = (await response.json().catch(() => null)) as { result: T; error: string | null } | null;
    if (!body) throw badRequest(`Unexpected answer from AnkiConnect at ${this.url}`);
    if (body.error) throw badRequest(`AnkiConnect (${action}): ${body.error}`);
    return body.result;
  }
}

interface NoteGroup {
  key: string;
  rows: CardRow[];
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  deck: string;
  hash: string;
  media: string[];
}

function mediaFileName(userId: string, id: string): string {
  const row = getDb().prepare(`SELECT mime_type FROM media WHERE user_id = ? AND id = ?`).get(userId, id) as { mime_type: string } | undefined;
  const ext = (row?.mime_type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return `rf-${id}.${ext}`;
}

function groupNotes(userId: string, rows: CardRow[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const row of rows) {
    const occlusion = row.kind === 'occlusion' ? parseOcclusion(row.occlusion) : null;
    const key = row.kind !== 'basic' && row.note_id ? `note:${row.note_id}` : `card:${row.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const media: string[] = [];
    const name = (id: string) => {
      media.push(id);
      return mediaFileName(userId, id);
    };
    const html = (text: string) => toAnkiHtml(text ?? '', name);
    const fields: Record<string, string> = occlusion
      ? {
          Occlusion: toAnkiOcclusion(occlusion),
          Image: `<img src="${name(occlusion.image)}">`,
          Header: html(row.front),
          'Back Extra': html(row.back),
          Comments: html(row.explanation),
        }
      : row.kind === 'cloze'
        ? { Text: html(row.front), 'Back Extra': html(row.back), Explanation: html(row.explanation), Source: html(row.source) }
        : { Front: html(row.front), Back: html(row.back), Explanation: html(row.explanation), Source: html(row.source) };
    const tags = (JSON.parse(row.tags) as string[]).map((tag) => tag.replace(/\s+/g, '_'));
    groups.set(key, {
      key,
      rows: [row],
      modelName: occlusion ? OCCLUSION_MODEL : row.kind === 'cloze' ? CLOZE_MODEL : BASIC_MODEL,
      fields,
      tags,
      deck: row.deck_name,
      hash: crypto.createHash('sha1').update(JSON.stringify([fields, tags, row.deck_name])).digest('hex'),
      media,
    });
  }
  return [...groups.values()];
}

const RATING: Rating[] = ['again', 'hard', 'good', 'easy'];

export async function syncWithAnki(userId: string, options: AnkiSyncOptions = {}): Promise<AnkiSyncResult> {
  const anki = new AnkiConnect(options.url || process.env.RECALLFORGE_ANKICONNECT_URL || DEFAULT_ANKICONNECT_URL, options.key);
  const version = await anki.call<number>('version');
  if (version < 6) throw badRequest('Update AnkiConnect: version 6 or newer is needed');
  const result: AnkiSyncResult = { ankiConnectVersion: version, reviewsPulled: 0, notesAdded: 0, notesUpdated: 0, mediaStored: 0, skipped: 0, warnings: [] };
  const db = getDb();

  // Scope: active cards of the subject (or everything).
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
  const links = new Map(
    (db.prepare(`SELECT card_id, anki_note_id, anki_card_id, content_hash, last_review_id FROM anki_links WHERE user_id = ?`).all(userId) as Array<{
      card_id: string;
      anki_note_id: number;
      anki_card_id: number | null;
      content_hash: string;
      last_review_id: number;
    }>).map((link) => [link.card_id, link])
  );

  // 1. Pull: reviews made in Anki since the last sync, replayed in time order.
  const linked = rows.filter((row) => links.get(row.id)?.anki_card_id);
  for (let i = 0; i < linked.length; i += 500) {
    const chunk = linked.slice(i, i + 500);
    const reviews = await anki.call<Record<string, Array<{ id: number; ease: number; type: number; time: number }>>>('getReviewsOfCards', {
      cards: chunk.map((row) => String(links.get(row.id)!.anki_card_id)),
    });
    for (const row of chunk) {
      const link = links.get(row.id)!;
      const fresh = (reviews[String(link.anki_card_id)] ?? [])
        .filter((review) => review.id > link.last_review_id && review.ease >= 1 && review.ease <= 4 && review.type <= 3)
        .sort((a, b) => a.id - b.id);
      if (fresh.length === 0) continue;
      if (!options.dryRun) {
        db.transaction(() => {
          for (const review of fresh) {
            const at = new Date(review.id);
            const current = db.prepare(`SELECT last_review_at FROM cards WHERE id = ?`).get(row.id) as { last_review_at: string | null };
            // A review already recorded here at a later time wins; Anki's older one is only logged in the link.
            if (current.last_review_at && new Date(current.last_review_at) >= at) continue;
            gradeCard(userId, row.id, { rating: RATING[review.ease - 1], durationMs: review.time > 0 ? Math.min(review.time, 3_600_000) : undefined }, 'anki', at);
          }
          db.prepare(`UPDATE anki_links SET last_review_id = ?, synced_at = ? WHERE card_id = ?`).run(fresh[fresh.length - 1].id, nowIso(), row.id);
        })();
      }
      result.reviewsPulled += fresh.length;
    }
  }

  // 2. Push: note types, decks, media, new notes and edited notes.
  const groups = groupNotes(userId, rows);
  const toAdd = groups.filter((group) => group.rows.every((row) => !links.has(row.id)));
  // Cards that came from an Anki package are linked with an empty hash: adopt the current content
  // (their original Anki formatting is kept) and only push later edits made here.
  const adopt = db.prepare(`UPDATE anki_links SET content_hash = ? WHERE card_id = ? AND content_hash = ''`);
  for (const group of groups) {
    for (const row of group.rows) {
      const current = links.get(row.id);
      if (current && current.content_hash === '') {
        if (!options.dryRun) adopt.run(group.hash, row.id);
        current.content_hash = group.hash;
      }
    }
  }
  const toUpdate = groups.filter((group) => group.rows.some((row) => links.has(row.id) && links.get(row.id)!.content_hash !== group.hash));
  if (options.dryRun) {
    result.notesAdded = toAdd.length;
    result.notesUpdated = toUpdate.length;
    return result;
  }

  const models = new Set(await anki.call<string[]>('modelNames'));
  const ensureModel = async (name: string, cloze: boolean) => {
    if (models.has(name)) return;
    const m = model(0, name, cloze, 1);
    await anki.call('createModel', {
      modelName: name,
      inOrderFields: m.flds.map((f) => f.name),
      css: m.css,
      isCloze: cloze,
      cardTemplates: m.tmpls.map((t) => ({ Name: t.name, Front: t.qfmt, Back: t.afmt })),
    });
    models.add(name);
  };
  if (toAdd.some((g) => g.modelName === BASIC_MODEL)) await ensureModel(BASIC_MODEL, false);
  if (toAdd.some((g) => g.modelName === CLOZE_MODEL)) await ensureModel(CLOZE_MODEL, true);
  if (toAdd.some((g) => g.modelName === OCCLUSION_MODEL) && !models.has(OCCLUSION_MODEL)) {
    // Anki creates its Image Occlusion note type the first time it is used; one made by
    // AnkiConnect would not draw masks, so these cards wait until it exists.
    const skipped = toAdd.filter((g) => g.modelName === OCCLUSION_MODEL);
    result.skipped += skipped.length;
    result.warnings.push(
      `${skipped.length} image occlusion notes were not sent: in Anki, create one image occlusion note once (Add → Image Occlusion), then sync again.`
    );
    toAdd.splice(0, toAdd.length, ...toAdd.filter((g) => g.modelName !== OCCLUSION_MODEL));
  }
  void occlusionModel;

  const decks = new Set(await anki.call<string[]>('deckNames'));
  for (const deck of new Set(toAdd.map((g) => g.deck))) {
    if (!decks.has(deck)) await anki.call('createDeck', { deck });
  }

  const stored = new Set<string>();
  const storeMedia = async (ids: string[]) => {
    for (const id of ids) {
      if (stored.has(id)) continue;
      stored.add(id);
      try {
        await anki.call('storeMediaFile', { filename: mediaFileName(userId, id), data: getMedia(userId, id).data.toString('base64') });
        result.mediaStored++;
      } catch (error) {
        result.warnings.push(`Image ${id} could not be copied to Anki: ${error instanceof Error ? error.message : error}`);
      }
    }
  };

  const link = db.prepare(
    `INSERT INTO anki_links (card_id, user_id, anki_note_id, anki_card_id, content_hash, last_review_id, synced_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(card_id) DO UPDATE SET anki_note_id = excluded.anki_note_id, anki_card_id = excluded.anki_card_id,
       content_hash = excluded.content_hash, synced_at = excluded.synced_at`
  );
  for (let i = 0; i < toAdd.length; i += BATCH) {
    const batch = toAdd.slice(i, i + BATCH);
    await storeMedia(batch.flatMap((g) => g.media));
    const ids = await anki.call<Array<number | null>>('addNotes', {
      notes: batch.map((g) => ({
        deckName: g.deck,
        modelName: g.modelName,
        fields: g.fields,
        tags: g.tags,
        options: { allowDuplicate: true },
      })),
    });
    const added = batch.map((group, j) => ({ group, noteId: ids[j] })).filter((x): x is { group: NoteGroup; noteId: number } => typeof x.noteId === 'number');
    result.notesAdded += added.length;
    const failed = batch.length - added.length;
    if (failed) {
      result.skipped += failed;
      result.warnings.push(`${failed} notes were rejected by Anki (empty cloze or invalid fields).`);
    }
    // Map each RecallForge card to the Anki card of the same template/deletion.
    const cardIds = added.length ? await anki.call<number[]>('findCards', { query: added.map((x) => `nid:${x.noteId}`).join(' OR ') }) : [];
    const info = cardIds.length ? await anki.call<Array<{ cardId: number; note: number; ord: number }>>('cardsInfo', { cards: cardIds }) : [];
    const byNote = new Map<number, Map<number, number>>();
    for (const card of info) {
      const map = byNote.get(card.note) ?? new Map<number, number>();
      map.set(card.ord, card.cardId);
      byNote.set(card.note, map);
    }
    const now = nowIso();
    db.transaction(() => {
      for (const { group, noteId } of added) {
        for (const row of group.rows) {
          const ord = row.kind === 'basic' ? 0 : Math.max(0, (row.cloze_ord ?? 1) - 1);
          link.run(row.id, userId, noteId, byNote.get(noteId)?.get(ord) ?? null, group.hash, now);
        }
      }
    })();
  }

  for (const group of toUpdate) {
    const noteId = links.get(group.rows.find((row) => links.has(row.id))!.id)!.anki_note_id;
    await storeMedia(group.media);
    try {
      await anki.call('updateNoteFields', { note: { id: noteId, fields: group.fields } });
    } catch (error) {
      result.skipped++;
      result.warnings.push(`Note "${group.rows[0].front.slice(0, 60)}" could not be updated in Anki: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const now = nowIso();
    for (const row of group.rows) {
      if (links.has(row.id)) db.prepare(`UPDATE anki_links SET content_hash = ?, synced_at = ? WHERE card_id = ?`).run(group.hash, now, row.id);
    }
    result.notesUpdated++;
  }
  return result;
}
