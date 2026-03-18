// ============================================================================
// RecallForge — Note Type Service
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import type { NoteType, FieldDefinition, CardTemplate, NoteTypeKind, JSONObject } from '@/types';

// ─── Create NoteType ───────────────────────────────────────────────────────

export async function createNoteType(
  userId: string,
  data: {
    name: string;
    kind: NoteTypeKind;
    description?: string;
    fields: Omit<FieldDefinition, 'id' | 'noteTypeId'>[];
    templates: Omit<CardTemplate, 'id' | 'noteTypeId'>[];
    css?: string;
  }
): Promise<NoteType> {
  const noteTypeId = generateId();

  const fields: FieldDefinition[] = data.fields.map(f => ({
    ...f,
    id: generateId(),
    noteTypeId,
  }));

  const templates: CardTemplate[] = data.templates.map(t => ({
    ...t,
    id: generateId(),
    noteTypeId,
  }));

  const noteType: NoteType = {
    id: noteTypeId,
    userId,
    name: data.name,
    description: data.description || '',
    kind: data.kind,
    css: data.css || getDefaultCSS(),
    version: 1,
    fields,
    templates,
    createdAt: now(),
    updatedAt: now(),
  };

  await db.noteTypes.add(noteType);
  await queueSync('noteTypes', noteType.id, 'create', noteType as unknown as JSONObject);
  await EventEmitters.noteTypeCreated(userId, noteType.id, { name: noteType.name, kind: noteType.kind });

  return noteType;
}

// ─── Update NoteType ───────────────────────────────────────────────────────

export async function updateNoteType(
  userId: string,
  noteTypeId: string,
  data: Partial<Pick<NoteType, 'name' | 'description' | 'css' | 'js' | 'fields' | 'templates'>>
): Promise<NoteType | undefined> {
  const existing = await db.noteTypes.get(noteTypeId);
  if (!existing) return undefined;

  const updates = {
    ...data,
    version: existing.version + 1,
    updatedAt: now(),
  };

  await db.noteTypes.update(noteTypeId, updates);
  await queueSync('noteTypes', noteTypeId, 'update', updates as unknown as JSONObject);

  return db.noteTypes.get(noteTypeId);
}

// ─── Clone NoteType ────────────────────────────────────────────────────────

export async function cloneNoteType(
  userId: string,
  noteTypeId: string,
  newName?: string
): Promise<NoteType | undefined> {
  const original = await db.noteTypes.get(noteTypeId);
  if (!original) return undefined;

  return createNoteType(userId, {
    name: newName || `${original.name} (copy)`,
    kind: original.kind,
    description: original.description,
    fields: original.fields.map(f => ({
      name: f.name,
      ordinal: f.ordinal,
      required: f.required,
      sticky: f.sticky,
      rtl: f.rtl,
      uniqueBehavior: f.uniqueBehavior,
      inputType: f.inputType,
    })),
    templates: original.templates.map(t => ({
      name: t.name,
      frontTemplate: t.frontTemplate,
      backTemplate: t.backTemplate,
      previewTemplate: t.previewTemplate,
      ordinal: t.ordinal,
      active: t.active,
      generationRules: t.generationRules,
    })),
    css: original.css,
  });
}

// ─── Delete NoteType ───────────────────────────────────────────────────────

export async function deleteNoteType(noteTypeId: string): Promise<{ success: boolean; reason?: string }> {
  const notesUsingType = await db.notes.where('noteTypeId').equals(noteTypeId).count();
  if (notesUsingType > 0) {
    return {
      success: false,
      reason: `Cannot delete: ${notesUsingType} notes use this type. Move them first.`,
    };
  }

  await db.noteTypes.delete(noteTypeId);
  await queueSync('noteTypes', noteTypeId, 'delete', {});
  return { success: true };
}

// ─── Get NoteTypes ─────────────────────────────────────────────────────────

export async function getNoteTypes(userId: string): Promise<NoteType[]> {
  return db.noteTypes.where('userId').equals(userId).toArray();
}

export async function getNoteType(noteTypeId: string): Promise<NoteType | undefined> {
  return db.noteTypes.get(noteTypeId);
}

// ─── Default note types ───────────────────────────────────────────────────

export function getDefaultNoteTypes(userId: string): NoteType[] {
  return [
    createBasicNoteType(userId),
    createBasicReversedNoteType(userId),
    createClozeNoteType(userId),
    createTypeAnswerNoteType(userId),
    createImageOcclusionNoteType(userId),
  ];
}

function createBasicNoteType(userId: string): NoteType {
  const id = generateId();
  return {
    id,
    userId,
    name: 'Basic',
    description: 'Front and back card',
    kind: 'basic',
    css: getDefaultCSS(),
    version: 1,
    fields: [
      { id: generateId(), noteTypeId: id, name: 'Front', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Back', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Source', ordinal: 3, required: false, sticky: true, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
    ],
    templates: [
      {
        id: generateId(), noteTypeId: id, name: 'Card 1',
        frontTemplate: '<div class="front">{{Front}}</div>',
        backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div><div class="extra">{{Extra}}</div></div>',
        ordinal: 0, active: true, generationRules: {},
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
}

function createBasicReversedNoteType(userId: string): NoteType {
  const id = generateId();
  return {
    id,
    userId,
    name: 'Basic (and reversed)',
    description: 'Card in both directions',
    kind: 'basic_reversed',
    css: getDefaultCSS(),
    version: 1,
    fields: [
      { id: generateId(), noteTypeId: id, name: 'Front', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Back', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ],
    templates: [
      {
        id: generateId(), noteTypeId: id, name: 'Card 1',
        frontTemplate: '<div class="front">{{Front}}</div>',
        backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div></div>',
        ordinal: 0, active: true, generationRules: {},
      },
      {
        id: generateId(), noteTypeId: id, name: 'Card 2 (Reversed)',
        frontTemplate: '<div class="front">{{Back}}</div>',
        backTemplate: '<div class="back">{{FrontSide}}<hr id="answer"><div class="answer">{{Front}}</div></div>',
        ordinal: 1, active: true, generationRules: {},
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
}

function createClozeNoteType(userId: string): NoteType {
  const id = generateId();
  return {
    id,
    userId,
    name: 'Cloze',
    description: 'Fill-in-the-blank deletion',
    kind: 'cloze',
    css: getDefaultCSS() + `
.cloze-active { color: #2196F3; font-weight: bold; }
.cloze-answer { color: #2196F3; font-weight: bold; text-decoration: underline; }`,
    version: 1,
    fields: [
      { id: generateId(), noteTypeId: id, name: 'Text', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Extra', ordinal: 1, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Source', ordinal: 2, required: false, sticky: true, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
    ],
    templates: [
      {
        id: generateId(), noteTypeId: id, name: 'Cloze',
        frontTemplate: '<div class="cloze-front">{{cloze:Text}}</div>',
        backTemplate: '<div class="cloze-back">{{cloze:Text}}<br><div class="extra">{{Extra}}</div></div>',
        ordinal: 0, active: true, generationRules: {},
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
}

function createTypeAnswerNoteType(userId: string): NoteType {
  const id = generateId();
  return {
    id,
    userId,
    name: 'Type Answer',
    description: 'Type your answer to check',
    kind: 'type_answer',
    css: getDefaultCSS() + `
.type-correct { color: #4CAF50; }
.type-incorrect { color: #f44336; text-decoration: line-through; }
.type-input { font-size: 1.2em; padding: 8px; border: 2px solid #ccc; border-radius: 8px; width: 80%; text-align: center; }`,
    version: 1,
    fields: [
      { id: generateId(), noteTypeId: id, name: 'Question', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Answer', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
      { id: generateId(), noteTypeId: id, name: 'Extra', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ],
    templates: [
      {
        id: generateId(), noteTypeId: id, name: 'Type Answer',
        frontTemplate: '<div class="front">{{Question}}<br><br>{{type:Answer}}</div>',
        backTemplate: '<div class="back">{{Question}}<hr id="answer"><div class="answer">{{Answer}}</div><div class="extra">{{Extra}}</div></div>',
        ordinal: 0, active: true, generationRules: {},
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
}

function createImageOcclusionNoteType(userId: string): NoteType {
  const id = generateId();
  return {
    id,
    userId,
    name: 'Image Occlusion',
    description: 'Hide parts of an image',
    kind: 'image_occlusion',
    css: getDefaultCSS() + `
.io-container { position: relative; display: inline-block; }
.io-mask { position: absolute; background: #FF5722; border-radius: 4px; opacity: 0.85; }
.io-mask-active { background: #2196F3; }
.io-revealed { background: transparent; border: 2px dashed #4CAF50; }`,
    version: 1,
    fields: [
      { id: generateId(), noteTypeId: id, name: 'Image', ordinal: 0, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'image' },
      { id: generateId(), noteTypeId: id, name: 'Masks', ordinal: 1, required: true, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'text' },
      { id: generateId(), noteTypeId: id, name: 'Header', ordinal: 2, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
      { id: generateId(), noteTypeId: id, name: 'Extra', ordinal: 3, required: false, sticky: false, rtl: false, uniqueBehavior: 'none', inputType: 'richtext' },
    ],
    templates: [
      {
        id: generateId(), noteTypeId: id, name: 'Image Occlusion',
        frontTemplate: '<div class="io-front">{{Header}}<div class="io-container">{{Image}}{{io-masks}}</div></div>',
        backTemplate: '<div class="io-back">{{Header}}<div class="io-container">{{Image}}{{io-masks-revealed}}</div><div class="extra">{{Extra}}</div></div>',
        ordinal: 0, active: true, generationRules: {},
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
}

function getDefaultCSS(): string {
  return `.card {
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
}

// ─── Seed default note types for new user ─────────────────────────────────

export async function seedDefaultNoteTypes(userId: string): Promise<void> {
  const existing = await getNoteTypes(userId);
  if (existing.length > 0) return;

  const defaults = getDefaultNoteTypes(userId);
  await db.noteTypes.bulkAdd(defaults);
}
