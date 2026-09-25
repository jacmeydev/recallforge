// ============================================================================
// RecallForge — Legacy (v1) data conversion
// ============================================================================
// v1 stored Anki-style notes + note types + templates and synced them from the
// browser. v2 stores plain question/answer cards on the server. When a v1
// database is detected, its tables are renamed to legacy_* (kept as an archive,
// never deleted) and cards are converted with their FSRS state and history.
// Image-occlusion cards cannot be represented as text and are skipped.
// ============================================================================

import type Database from 'better-sqlite3';
import { htmlToText } from './text';

type DB = Database.Database;

const LEGACY_TABLES = [
  'sessions',
  'decks',
  'presets',
  'note_types',
  'notes',
  'cards',
  'review_logs',
  'card_commands',
  'activity_events',
  'daily_summaries',
  'personal_summaries',
  'curriculum_programs',
  'curriculum_subjects',
  'curriculum_modules',
  'curriculum_chapters',
  'curriculum_topics',
  'curriculum_links',
  'user_gamification',
  'sync_cursors',
  'sync_operations',
  'copilot_drafts',
  'copilot_outcomes',
  'notification_preferences',
  'push_subscriptions',
];

function tableExists(db: DB, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function columnNames(db: DB, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
}

export function hasLegacySchema(db: DB): boolean {
  return tableExists(db, 'cards') && columnNames(db, 'cards').has('note_id');
}

export function archiveLegacyTables(db: DB): void {
  for (const table of LEGACY_TABLES) {
    if (tableExists(db, table) && !tableExists(db, `legacy_${table}`)) {
      db.exec(`ALTER TABLE "${table}" RENAME TO "legacy_${table}"`);
    }
  }
}

export interface LegacyConversionReport {
  decks: number;
  cards: number;
  skippedCards: number;
  reviewLogs: number;
}

export function convertLegacyData(db: DB): LegacyConversionReport {
  clearPlaintextApiKeys(db);
  const report: LegacyConversionReport = { decks: 0, cards: 0, skippedCards: 0, reviewLogs: 0 };
  const now = new Date().toISOString();

  // ── Decks: flatten the parent hierarchy into "Parent::Child" names ──────
  const deckIds = new Set<string>();
  if (tableExists(db, 'legacy_decks')) {
    const rows = db
      .prepare(
        `SELECT id, user_id, name, description, parent_deck_id, created_at, updated_at
         FROM legacy_decks WHERE deleted_at IS NULL AND user_id IN (SELECT id FROM users)`
      )
      .all() as Array<{
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      parent_deck_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const usedNames = new Map<string, Set<string>>();
    const insertDeck = db.prepare(
      `INSERT INTO decks (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      const parts = [row.name.trim() || 'Sin nombre'];
      let parent = row.parent_deck_id ? byId.get(row.parent_deck_id) : undefined;
      for (let depth = 0; parent && depth < 10; depth++) {
        parts.unshift(parent.name.trim());
        parent = parent.parent_deck_id ? byId.get(parent.parent_deck_id) : undefined;
      }
      const taken = usedNames.get(row.user_id) ?? new Set<string>();
      usedNames.set(row.user_id, taken);
      const base = parts.join('::');
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
      taken.add(name.toLowerCase());

      insertDeck.run(row.id, row.user_id, name, row.description ?? '', row.created_at, row.updated_at);
      deckIds.add(row.id);
      report.decks++;
    }
  }

  // ── Cards ───────────────────────────────────────────────────────────────
  if (tableExists(db, 'legacy_cards') && tableExists(db, 'legacy_notes')) {
    const hasNoteTypes = tableExists(db, 'legacy_note_types');
    const rows = db
      .prepare(
        `SELECT c.id, c.user_id, c.deck_id, c.template_id, c.due_at, c.state, c.stability, c.difficulty,
                c.elapsed_days, c.scheduled_days, c.reps, c.lapses, c.learning_steps, c.last_review_at,
                c.suspended, c.custom_data, c.created_at, c.updated_at,
                n.deck_id AS note_deck_id, n.field_values, n.tags AS note_tags, n.source_metadata,
                n.suspended AS note_suspended,
                ${hasNoteTypes ? 'nt.kind, nt.templates' : 'NULL AS kind, NULL AS templates'}
         FROM legacy_cards c
         JOIN legacy_notes n ON n.id = c.note_id AND n.deleted_at IS NULL
         ${hasNoteTypes ? 'LEFT JOIN legacy_note_types nt ON nt.id = n.note_type_id' : ''}
         WHERE c.deleted_at IS NULL AND c.user_id IN (SELECT id FROM users)`
      )
      .all() as LegacyCardRow[];

    const fallbackDecks = new Map<string, string>();
    const fallbackDeckFor = (userId: string): string => {
      const cached = fallbackDecks.get(userId);
      if (cached) return cached;
      const existing = db
        .prepare(`SELECT id FROM decks WHERE user_id = ? AND name = 'Importadas' COLLATE NOCASE`)
        .get(userId) as { id: string } | undefined;
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        db.prepare(
          `INSERT INTO decks (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, 'Importadas', '', ?, ?)`
        ).run(id, userId, now, now);
        report.decks++;
      }
      fallbackDecks.set(userId, id);
      return id;
    };

    const insertCard = db.prepare(`
      INSERT INTO cards (
        id, user_id, deck_id, front, back, explanation, source, tags, state, due_at, stability, difficulty,
        elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_at, suspended, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const content = legacyCardContent(row);
      if (!content) {
        report.skippedCards++;
        continue;
      }
      const deckId = deckIds.has(row.deck_id)
        ? row.deck_id
        : deckIds.has(row.note_deck_id)
          ? row.note_deck_id
          : fallbackDeckFor(row.user_id);
      const tags = parseJson<unknown[]>(row.note_tags, []).filter((tag): tag is string => typeof tag === 'string');
      const state = ['new', 'learning', 'review', 'relearning'].includes(row.state) ? row.state : 'new';

      insertCard.run(
        row.id,
        row.user_id,
        deckId,
        content.front,
        content.back,
        content.explanation,
        legacySource(row.source_metadata),
        JSON.stringify(tags),
        state,
        row.due_at,
        row.stability ?? 0,
        row.difficulty ?? 0,
        row.elapsed_days ?? 0,
        row.scheduled_days ?? 0,
        row.reps ?? 0,
        row.lapses ?? 0,
        row.learning_steps ?? 0,
        row.last_review_at,
        row.suspended || row.note_suspended ? 1 : 0,
        row.created_at,
        row.updated_at
      );
      report.cards++;
    }
  }

  // ── Review history (kept for statistics and future FSRS optimisation) ───
  if (tableExists(db, 'legacy_review_logs')) {
    const columns = columnNames(db, 'legacy_review_logs');
    const reviewedAt = columns.has('effective_reviewed_at') ? 'COALESCE(effective_reviewed_at, reviewed_at)' : 'reviewed_at';
    const result = db
      .prepare(
        `INSERT INTO review_logs (
           id, user_id, card_id, reviewed_at, rating, state, next_state, due_at, next_due_at,
           stability, next_stability, difficulty, next_difficulty, duration_ms, source
         )
         SELECT id, user_id, card_id, ${reviewedAt}, rating, previous_state, next_state, previous_due_at, next_due_at,
                previous_stability, next_stability, previous_difficulty, next_difficulty, response_time_ms, 'legacy'
         FROM legacy_review_logs
         WHERE card_id IN (SELECT id FROM cards)`
      )
      .run();
    report.reviewLogs = result.changes;
  }

  return report;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface LegacyCardRow {
  id: string;
  user_id: string;
  deck_id: string;
  template_id: string;
  due_at: string;
  state: string;
  stability: number | null;
  difficulty: number | null;
  elapsed_days: number | null;
  scheduled_days: number | null;
  reps: number | null;
  lapses: number | null;
  learning_steps: number | null;
  last_review_at: string | null;
  suspended: number;
  custom_data: string | null;
  created_at: string;
  updated_at: string;
  note_deck_id: string;
  field_values: string | null;
  note_tags: string | null;
  source_metadata: string | null;
  note_suspended: number;
  kind: string | null;
  templates: string | null;
}

/** v1 could store agent API keys in plain text; there are no API keys any more, so drop them. */
function clearPlaintextApiKeys(db: DB): void {
  if (columnNames(db, 'users').has('api_key')) db.exec(`UPDATE users SET api_key = NULL`);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function renderTemplate(template: string, fields: Record<string, string>): string {
  const filled = (name: string) => Boolean(fields[name.trim()]?.trim());
  return template
    .replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name: string, inner: string) => (filled(name) ? inner : ''))
    .replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name: string, inner: string) => (filled(name) ? '' : inner))
    .replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
      const token = raw.trim();
      if (token === 'FrontSide') return '';
      const colon = token.indexOf(':');
      const modifier = colon >= 0 ? token.slice(0, colon) : '';
      const name = colon >= 0 ? token.slice(colon + 1) : token;
      if (modifier === 'type') return '';
      return fields[name] ?? '';
    });
}

const CLOZE_PATTERN = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

function legacyCardContent(row: LegacyCardRow): { front: string; back: string; explanation: string } | null {
  const kind = row.kind ?? 'basic';
  if (kind === 'image_occlusion' || kind === 'image-occlusion') return null;

  const fields = parseJson<Record<string, string>>(row.field_values, {});
  const extra = htmlToText(fields.Extra ?? '');

  if (kind === 'cloze') {
    const index = Number(parseJson<Record<string, unknown>>(row.custom_data, {}).clozeIndex ?? 1);
    const text = fields.Text ?? Object.values(fields)[0] ?? '';
    const answers: string[] = [];
    const front = text.replace(CLOZE_PATTERN, (_, n: string, answer: string, hint?: string) => {
      if (Number(n) !== index) return answer;
      answers.push(answer);
      return `[${hint || '...'}]`;
    });
    const revealed = text.replace(CLOZE_PATTERN, (_, __, answer: string) => answer);
    if (answers.length === 0) return null;
    return {
      front: htmlToText(front),
      back: htmlToText(answers.join(' / ')),
      explanation: [htmlToText(revealed), extra].filter(Boolean).join('\n\n'),
    };
  }

  const templates = parseJson<Array<{ id?: string; frontTemplate?: string; backTemplate?: string }>>(row.templates, []);
  const template = templates.find((t) => t.id === row.template_id) ?? templates[0];
  let frontTemplate = template?.frontTemplate ?? '{{Front}}';
  let backTemplate = template?.backTemplate ?? '{{Back}}';
  if (!template && fields.Question !== undefined) {
    frontTemplate = '{{Question}}';
    backTemplate = '{{Answer}}';
  }
  if (extra) backTemplate = backTemplate.replace(/\{\{\s*Extra\s*\}\}/g, '');

  const front = htmlToText(renderTemplate(frontTemplate, fields));
  const back = htmlToText(renderTemplate(backTemplate, fields));
  if (!front || !back) return null;
  return { front, back, explanation: extra };
}

function legacySource(raw: string | null): string {
  const metadata = parseJson<{ academic?: { book?: string; sourcePage?: string } }>(raw, {});
  const book = metadata.academic?.book?.trim();
  const page = metadata.academic?.sourcePage?.trim();
  return [book, page ? `p. ${page}` : ''].filter(Boolean).join(', ');
}
