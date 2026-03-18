import { sqlite } from '@/lib/server/db';
import crypto from 'crypto';
import type { JSONValue } from '@/types';

type DatabaseLike = {
  prepare(sql: string): any;
};

type RecoveredKind = 'basic' | 'basic_reversed' | 'cloze' | 'type_answer' | 'image_occlusion';

interface MissingNoteTypeRow {
  user_id: string;
  note_type_id: string;
}

interface ParsedFieldValues {
  keys: string[];
  samples: Array<Record<string, string>>;
}

const DEFAULT_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 1.1rem;
  text-align: center;
  color: var(--foreground);
  padding: 2rem;
  line-height: 1.6;
}
.front { font-size: 1.3rem; }
.answer { margin-top: 1rem; }
.extra { margin-top: 1rem; font-size: 0.9rem; opacity: 0.7; }
hr#answer { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
img { max-width: 100%; height: auto; border-radius: 8px; }`;

function generateId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseFieldValues(rawValues: Array<Record<string, unknown>>): ParsedFieldValues {
  const sampleObjects: Array<Record<string, string>> = [];
  const keySet = new Set<string>();

  for (const row of rawValues) {
    const raw = row.field_values;
    if (typeof raw !== 'string' || raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          normalized[key] = value;
          keySet.add(key);
        }
      }
      if (Object.keys(normalized).length > 0) {
        sampleObjects.push(normalized);
      }
    } catch {
      // Ignore malformed notes; we only need one valid sample shape to recover.
    }
  }

  return {
    keys: [...keySet],
    samples: sampleObjects,
  };
}

function inferKind(keys: string[], samples: Array<Record<string, string>>, templateIds: string[]): RecoveredKind {
  if (keys.includes('Image') && keys.includes('Masks')) {
    return 'image_occlusion';
  }

  const joined = samples
    .flatMap((sample) => Object.values(sample))
    .join(' ');
  if (keys.includes('Text') && /\{\{c\d+::/i.test(joined)) {
    return 'cloze';
  }

  if (keys.includes('Question') && keys.includes('Answer')) {
    return 'type_answer';
  }

  if (keys.includes('Front') && keys.includes('Back') && templateIds.length > 1) {
    return 'basic_reversed';
  }

  return 'basic';
}

function buildFieldDefinition(noteTypeId: string, name: string, ordinal: number, required: boolean, inputType: string) {
  return {
    id: generateId(),
    noteTypeId,
    name,
    ordinal,
    required,
    sticky: false,
    rtl: false,
    uniqueBehavior: 'none',
    inputType,
  };
}

function buildTemplates(noteTypeId: string, kind: RecoveredKind, templateIds: string[]) {
  const fallbackTemplateIds = templateIds.length > 0 ? templateIds : [`${noteTypeId}:recovered:0`];

  if (kind === 'cloze') {
    return [{
      id: fallbackTemplateIds[0],
      noteTypeId,
      name: 'Recovered Cloze',
      frontTemplate: '<div class="cloze-front">{{cloze:Text}}</div>',
      backTemplate: '<div class="cloze-back">{{cloze:Text}}<br><div class="extra">{{Extra}}</div></div>',
      ordinal: 0,
      active: true,
      generationRules: {},
    }];
  }

  if (kind === 'type_answer') {
    return [{
      id: fallbackTemplateIds[0],
      noteTypeId,
      name: 'Recovered Type Answer',
      frontTemplate: '<div class="front">{{Question}}<br><br>{{type:Answer}}</div>',
      backTemplate: '<div class="back">{{Question}}<hr id="answer"><div class="answer">{{Answer}}</div><div class="extra">{{Extra}}</div></div>',
      ordinal: 0,
      active: true,
      generationRules: {},
    }];
  }

  if (kind === 'image_occlusion') {
    return [{
      id: fallbackTemplateIds[0],
      noteTypeId,
      name: 'Recovered Image Occlusion',
      frontTemplate: '<div class="io-front">{{Header}}<div class="io-container">{{Image}}{{io-masks}}</div></div>',
      backTemplate: '<div class="io-back">{{Header}}<div class="io-container">{{Image}}{{io-masks-revealed}}</div><div class="extra">{{Extra}}</div></div>',
      ordinal: 0,
      active: true,
      generationRules: {},
    }];
  }

  const templates = [{
    id: fallbackTemplateIds[0],
    noteTypeId,
    name: 'Recovered Card 1',
    frontTemplate: '<div class="front">{{Front}}</div>',
    backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div><div class="extra">{{Extra}}</div></div>',
    ordinal: 0,
    active: true,
    generationRules: {},
  }];

  if (kind === 'basic_reversed' && fallbackTemplateIds.length > 1) {
    templates.push({
      id: fallbackTemplateIds[1],
      noteTypeId,
      name: 'Recovered Card 2 (Reversed)',
      frontTemplate: '<div class="front">{{Back}}</div>',
      backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Front}}</div></div>',
      ordinal: 1,
      active: true,
      generationRules: {},
    });
  }

  return templates;
}

function buildFields(noteTypeId: string, kind: RecoveredKind, keys: string[]) {
  if (kind === 'cloze') {
    return [
      buildFieldDefinition(noteTypeId, 'Text', 0, true, 'richtext'),
      buildFieldDefinition(noteTypeId, 'Extra', 1, false, 'richtext'),
      buildFieldDefinition(noteTypeId, 'Source', 2, false, 'text'),
    ];
  }

  if (kind === 'type_answer') {
    return [
      buildFieldDefinition(noteTypeId, 'Question', 0, true, 'richtext'),
      buildFieldDefinition(noteTypeId, 'Answer', 1, true, 'text'),
      buildFieldDefinition(noteTypeId, 'Extra', 2, false, 'richtext'),
    ];
  }

  if (kind === 'image_occlusion') {
    return [
      buildFieldDefinition(noteTypeId, 'Image', 0, true, 'image'),
      buildFieldDefinition(noteTypeId, 'Masks', 1, true, 'text'),
      buildFieldDefinition(noteTypeId, 'Header', 2, false, 'richtext'),
      buildFieldDefinition(noteTypeId, 'Extra', 3, false, 'richtext'),
    ];
  }

  const known = [
    buildFieldDefinition(noteTypeId, 'Front', 0, true, 'richtext'),
    buildFieldDefinition(noteTypeId, 'Back', 1, true, 'richtext'),
  ];

  const extras = keys
    .filter((key) => key !== 'Front' && key !== 'Back')
    .sort()
    .map((key, index) => buildFieldDefinition(noteTypeId, key, index + 2, false, 'richtext'));

  return [...known, ...extras];
}

function buildRecoveredNoteTypeRecord(params: {
  userId: string;
  noteTypeId: string;
  keys: string[];
  samples: Array<Record<string, string>>;
  templateIds: string[];
}) {
  const kind = inferKind(params.keys, params.samples, params.templateIds);
  const fields = buildFields(params.noteTypeId, kind, params.keys);
  const templates = buildTemplates(params.noteTypeId, kind, params.templateIds);
  const titleByKind: Record<RecoveredKind, string> = {
    basic: 'Recovered Basic',
    basic_reversed: 'Recovered Basic (Reversed)',
    cloze: 'Recovered Cloze',
    type_answer: 'Recovered Type Answer',
    image_occlusion: 'Recovered Image Occlusion',
  };
  const ts = nowIso();

  return {
    id: params.noteTypeId,
    user_id: params.userId,
    name: `${titleByKind[kind]} ${params.noteTypeId.slice(0, 8)}`,
    description: 'Auto-recovered note type generated from imported notes',
    kind,
    css: DEFAULT_CSS,
    js: null,
    version: 1,
    fields: JSON.stringify(fields as JSONValue[]),
    templates: JSON.stringify(templates as JSONValue[]),
    created_at: ts,
    updated_at: ts,
  };
}

export function repairMissingServerNoteTypesInDatabase(db: DatabaseLike, userId?: string): { repaired: number; noteTypeIds: string[] } {
  const missing = db.prepare(`
    SELECT DISTINCT n.user_id, n.note_type_id
    FROM notes n
    LEFT JOIN note_types nt ON nt.id = n.note_type_id
    WHERE n.deleted_at IS NULL
      AND n.note_type_id IS NOT NULL
      AND nt.id IS NULL
      ${userId ? 'AND n.user_id = ?' : ''}
  `).all(...(userId ? [userId] : [])) as unknown as MissingNoteTypeRow[];

  const repaired: string[] = [];

  for (const row of missing) {
    const fieldRows = db.prepare(`
      SELECT field_values
      FROM notes
      WHERE user_id = ? AND note_type_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 25
    `).all(row.user_id, row.note_type_id) as Array<Record<string, unknown>>;

    const { keys, samples } = parseFieldValues(fieldRows);
    if (keys.length === 0) continue;

    const templateRows = db.prepare(`
      SELECT DISTINCT c.template_id
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      WHERE n.user_id = ? AND n.note_type_id = ?
        AND n.deleted_at IS NULL
        AND c.deleted_at IS NULL
      ORDER BY c.template_id
    `).all(row.user_id, row.note_type_id) as Array<Record<string, unknown>>;

    const templateIds = templateRows
      .map((entry) => entry.template_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const recovered = buildRecoveredNoteTypeRecord({
      userId: row.user_id,
      noteTypeId: row.note_type_id,
      keys,
      samples,
      templateIds,
    });

    db.prepare(`
      INSERT OR IGNORE INTO note_types (
        id, user_id, name, description, kind, css, js, version, fields, templates, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recovered.id,
      recovered.user_id,
      recovered.name,
      recovered.description,
      recovered.kind,
      recovered.css,
      recovered.js,
      recovered.version,
      recovered.fields,
      recovered.templates,
      recovered.created_at,
      recovered.updated_at
    );

    repaired.push(row.note_type_id);
  }

  return { repaired: repaired.length, noteTypeIds: repaired };
}

export function repairMissingServerNoteTypes(userId?: string) {
  return repairMissingServerNoteTypesInDatabase(sqlite as unknown as DatabaseLike, userId);
}
