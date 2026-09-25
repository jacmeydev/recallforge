// ============================================================================
// RecallForge — Source documents
// ============================================================================
// A document is study material (PDF, slides, notes…) stored as ordered text
// parts. Agents read it part by part, create cards linked to the part they came
// from, and use per-part coverage to see what still has no cards.
// ============================================================================

import { z } from 'zod';
import { genId, getDb, nowIso } from './db';
import { getOrCreateDeck, resolveDeck } from './decks';
import { badRequest, notFound } from './errors';
import { extractDocument, splitText, type DocumentPartInput } from './extract';

const DEFAULT_READ_CHARS = 15_000;
const MAX_READ_CHARS = 60_000;

export const TextDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().min(1).max(3_000_000),
  deck: z.string().trim().min(1).max(300).optional(),
});

export const ReadDocumentSchema = z.object({
  fromPart: z.number().int().min(0).optional(),
  maxChars: z.number().int().min(500).max(MAX_READ_CHARS).optional(),
});

interface DocumentRow {
  id: string;
  title: string;
  filename: string | null;
  mime_type: string | null;
  deck_id: string | null;
  deck_name: string | null;
  parts: number;
  chars: number;
  created_at: string;
  updated_at: string;
  cards: number;
  drafts: number;
  covered_parts: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  filename: string | null;
  mimeType: string | null;
  deck: { id: string; name: string } | null;
  parts: number;
  chars: number;
  /** Active cards made from this document, drafts waiting for review, and parts that have at least one card. */
  cards: { active: number; drafts: number; partsCovered: number };
  createdAt: string;
}

const DOCUMENT_SELECT = `
  SELECT doc.*, d.name AS deck_name,
    (SELECT COUNT(*) FROM cards c WHERE c.document_id = doc.id AND c.status = 'active') AS cards,
    (SELECT COUNT(*) FROM cards c WHERE c.document_id = doc.id AND c.status = 'draft') AS drafts,
    (SELECT COUNT(DISTINCT c.document_part) FROM cards c WHERE c.document_id = doc.id AND c.document_part IS NOT NULL) AS covered_parts
  FROM documents doc LEFT JOIN decks d ON d.id = doc.deck_id`;

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    deck: row.deck_id && row.deck_name ? { id: row.deck_id, name: row.deck_name } : null,
    parts: row.parts,
    chars: row.chars,
    cards: { active: row.cards, drafts: row.drafts, partsCovered: row.covered_parts },
    createdAt: row.created_at,
  };
}

function getDocumentRow(userId: string, id: string): DocumentRow {
  const row = getDb().prepare(`${DOCUMENT_SELECT} WHERE doc.user_id = ? AND doc.id = ?`).get(userId, id) as DocumentRow | undefined;
  if (!row) throw notFound('Document', id);
  return row;
}

function saveDocument(
  userId: string,
  input: { title: string; filename: string | null; mimeType: string | null; deck?: string; parts: DocumentPartInput[] }
): DocumentSummary {
  const db = getDb();
  const id = genId();
  const now = nowIso();
  const chars = input.parts.reduce((sum, part) => sum + part.text.length, 0);
  db.transaction(() => {
    const deckId = input.deck ? getOrCreateDeck(userId, input.deck).deck.id : null;
    db.prepare(
      `INSERT INTO documents (id, user_id, title, filename, mime_type, deck_id, parts, chars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, input.title, input.filename, input.mimeType, deckId, input.parts.length, chars, now, now);
    const insertPart = db.prepare(`INSERT INTO document_parts (document_id, idx, label, text) VALUES (?, ?, ?, ?)`);
    input.parts.forEach((part, idx) => insertPart.run(id, idx, part.label, part.text));
  })();
  return toSummary(getDocumentRow(userId, id));
}

/** Store an uploaded file (PDF, DOCX, PPTX, TXT, MD, HTML, CSV…) after extracting its text. */
export async function importDocumentFile(
  userId: string,
  file: { filename: string; data: Uint8Array },
  options: { title?: string; deck?: string } = {}
): Promise<DocumentSummary> {
  const extracted = await extractDocument(file);
  return saveDocument(userId, {
    title: options.title?.trim() || extracted.title,
    filename: file.filename,
    mimeType: extracted.mimeType,
    deck: options.deck,
    parts: extracted.parts,
  });
}

/** Store text an agent already has (e.g. it read a file with its own skills), split into sections. */
export function importDocumentText(userId: string, input: unknown): DocumentSummary {
  const parsed = TextDocumentSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid document', parsed.error.issues);
  const parts = splitText(parsed.data.text, true);
  if (parts.length === 0) throw badRequest('The document text is empty');
  return saveDocument(userId, {
    title: parsed.data.title,
    filename: null,
    mimeType: 'text/plain',
    deck: parsed.data.deck,
    parts,
  });
}

export function listDocuments(userId: string, deck?: string): DocumentSummary[] {
  const rows = deck
    ? (getDb()
        .prepare(`${DOCUMENT_SELECT} WHERE doc.user_id = ? AND doc.deck_id = ? ORDER BY doc.created_at DESC`)
        .all(userId, resolveDeck(userId, deck).id) as DocumentRow[])
    : (getDb().prepare(`${DOCUMENT_SELECT} WHERE doc.user_id = ? ORDER BY doc.created_at DESC`).all(userId) as DocumentRow[]);
  return rows.map(toSummary);
}

export interface DocumentPartSummary {
  index: number;
  label: string;
  chars: number;
  /** Cards (active + drafts) created from this part. */
  cards: number;
}

/** Document metadata plus an outline of its parts with card coverage. */
export function getDocument(userId: string, id: string): DocumentSummary & { outline: DocumentPartSummary[] } {
  const document = toSummary(getDocumentRow(userId, id));
  const outline = getDb()
    .prepare(
      `SELECT p.idx AS "index", p.label, length(p.text) AS chars,
              (SELECT COUNT(*) FROM cards c WHERE c.document_id = p.document_id AND c.document_part = p.idx) AS cards
       FROM document_parts p WHERE p.document_id = ? ORDER BY p.idx`
    )
    .all(id) as DocumentPartSummary[];
  return { ...document, outline };
}

export interface ReadDocumentResult {
  document: { id: string; title: string; parts: number; deck: string | null };
  parts: Array<DocumentPartSummary & { text: string }>;
  /** Pass as fromPart to continue reading, or null at the end. */
  nextPart: number | null;
}

/** Read consecutive parts starting at fromPart, up to maxChars (always at least one part). */
export function readDocument(userId: string, id: string, input: unknown = {}): ReadDocumentResult {
  const parsed = ReadDocumentSchema.safeParse(input ?? {});
  if (!parsed.success) throw badRequest('Invalid read request', parsed.error.issues);
  const { fromPart = 0, maxChars = DEFAULT_READ_CHARS } = parsed.data;
  const document = getDocumentRow(userId, id);
  const rows = getDb()
    .prepare(
      `SELECT p.idx AS "index", p.label, p.text, length(p.text) AS chars,
              (SELECT COUNT(*) FROM cards c WHERE c.document_id = p.document_id AND c.document_part = p.idx) AS cards
       FROM document_parts p WHERE p.document_id = ? AND p.idx >= ? ORDER BY p.idx`
    )
    .iterate(id, fromPart) as Iterable<DocumentPartSummary & { text: string }>;

  const parts: Array<DocumentPartSummary & { text: string }> = [];
  let used = 0;
  let nextPart: number | null = null;
  for (const row of rows) {
    if (parts.length > 0 && used + row.chars > maxChars) {
      nextPart = row.index;
      break;
    }
    parts.push(row);
    used += row.chars;
  }
  return {
    document: { id: document.id, title: document.title, parts: document.parts, deck: document.deck_name },
    parts,
    nextPart,
  };
}

export function getDocumentPartLabel(documentId: string, part: number): string | null {
  const row = getDb().prepare(`SELECT label FROM document_parts WHERE document_id = ? AND idx = ?`).get(documentId, part) as
    | { label: string }
    | undefined;
  return row?.label ?? null;
}

/** Rename a document or change its default deck. */
export function updateDocument(userId: string, id: string, patch: { title?: unknown; deck?: unknown }): DocumentSummary {
  const row = getDocumentRow(userId, id);
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 300) : row.title;
  const deckId = typeof patch.deck === 'string' && patch.deck.trim() ? getOrCreateDeck(userId, patch.deck).deck.id : row.deck_id;
  getDb().prepare(`UPDATE documents SET title = ?, deck_id = ?, updated_at = ? WHERE id = ?`).run(title, deckId, nowIso(), id);
  return toSummary(getDocumentRow(userId, id));
}

/** Delete a document. Its cards are kept unless deleteCards is true. */
export function deleteDocument(userId: string, id: string, deleteCards = false): { deleted: string; deletedCards: number } {
  getDocumentRow(userId, id);
  const db = getDb();
  let deletedCards = 0;
  db.transaction(() => {
    if (deleteCards) deletedCards = db.prepare(`DELETE FROM cards WHERE user_id = ? AND document_id = ?`).run(userId, id).changes;
    db.prepare(`DELETE FROM documents WHERE user_id = ? AND id = ?`).run(userId, id);
  })();
  return { deleted: id, deletedCards };
}
