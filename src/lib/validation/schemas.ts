import { z } from 'zod';

// ─── Primitives ────────────────────────────────────────────────────────────
const nonEmptyString = z.string().min(1, 'No puede estar vacío');
const uuidString = z.string().min(8, 'ID inválido');
const iso8601String = z.string().min(10, 'Fecha inválida');

// ─── Deck ──────────────────────────────────────────────────────────────────
export const CreateDeckSchema = z.object({
  name: nonEmptyString.max(200, 'El nombre del mazo es demasiado largo'),
  description: z.string().max(2000).optional().default(''),
  parentDeckId: uuidString.nullable().optional().default(null),
  presetId: uuidString.nullable().optional().default(null),
});

export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;

// ─── Note ──────────────────────────────────────────────────────────────────
export const CreateNoteSchema = z.object({
  deckId: uuidString,
  noteTypeId: uuidString,
  fieldValues: z.record(z.string(), z.string()).refine(
    (vals) => Object.values(vals).some((v) => v.trim().length > 0),
    { message: 'Al menos un campo debe tener contenido' }
  ),
  tags: z.array(z.string().min(1)).optional().default([]),
  source: z.string().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

// ─── Preset ────────────────────────────────────────────────────────────────
export const PresetSchema = z.object({
  name: nonEmptyString.max(100),
  desiredRetention: z.number().min(0.7).max(0.99),
  learningSteps: z.array(z.number().min(0)).min(1),
  relearningSteps: z.array(z.number().min(0)),
  maximumInterval: z.number().min(1).max(36500),
  enableFuzz: z.boolean(),
  buryNewSiblings: z.boolean(),
  buryReviewSiblings: z.boolean(),
  newCardOrder: z.union([z.literal('sequential'), z.literal('random')]),
  reviewOrder: z.union([
    z.literal('due_date'),
    z.literal('random'),
    z.literal('intervals_ascending'),
    z.literal('intervals_descending'),
  ]),
  dailyLimits: z.object({
    newCards: z.number().min(0).max(9999),
    reviews: z.number().min(0).max(9999),
  }),
  fsrsParameters: z.array(z.number()).min(19).max(19),
});

export type PresetInput = z.infer<typeof PresetSchema>;

// ─── Import JSON ───────────────────────────────────────────────────────────
const ImportEntitySchema = z.object({
  id: uuidString,
}).passthrough();

export const ImportJSONSchema = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  app: z.string().optional(),
  data: z.object({
    decks: z.array(ImportEntitySchema).optional().default([]),
    noteTypes: z.array(ImportEntitySchema).optional().default([]),
    presets: z.array(ImportEntitySchema).optional().default([]),
    notes: z.array(ImportEntitySchema).optional().default([]),
    cards: z.array(ImportEntitySchema).optional().default([]),
    reviewLogs: z.array(ImportEntitySchema).optional().default([]),
    tags: z.array(ImportEntitySchema).optional().default([]),
  }).optional(),
}).passthrough();

export type ImportJSONInput = z.infer<typeof ImportJSONSchema>;

// ─── CSV Import Mapping ───────────────────────────────────────────────────
export const CSVMappingSchema = z.object({
  columns: z.array(z.string()),
  fieldMapping: z.record(z.string(), z.string()),
  tagColumn: z.number().min(0).optional(),
  deckId: uuidString,
  noteTypeId: uuidString,
});

export type CSVMappingInput = z.infer<typeof CSVMappingSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────
export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function validateSafe<T>(schema: z.ZodType<T>, data: unknown) {
  return schema.safeParse(data);
}

// ─── Curriculum Schemas ───────────────────────────────────────────────────

export const CreateProgramSchema = z.object({
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional().default(''),
  career: z.string().max(200).optional(),
  year: z.number().int().min(1).max(10).optional(),
  semester: z.number().int().min(1).max(20).optional(),
});
export type CreateProgramInput = z.input<typeof CreateProgramSchema>;

export const CreateSubjectSchema = z.object({
  programId: uuidString,
  name: nonEmptyString.max(200),
  code: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type CreateSubjectInput = z.input<typeof CreateSubjectSchema>;

export const CreateModuleSchema = z.object({
  subjectId: uuidString,
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type CreateModuleInput = z.input<typeof CreateModuleSchema>;

export const CreateChapterSchema = z.object({
  moduleId: uuidString,
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional(),
  examScope: z.string().max(200).optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type CreateChapterInput = z.input<typeof CreateChapterSchema>;

export const CreateTopicSchema = z.object({
  chapterId: uuidString,
  name: nonEmptyString.max(200),
  description: z.string().max(2000).optional(),
  priorityDefault: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  conceptualDifficultyDefault: z.enum(['easy', 'medium', 'hard', 'very_hard']).optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type CreateTopicInput = z.input<typeof CreateTopicSchema>;

export const CreateCurriculumLinkSchema = z.object({
  noteId: uuidString.optional(),
  cardId: uuidString.optional(),
  deckId: uuidString.optional(),
  programId: uuidString.optional(),
  subjectId: uuidString.optional(),
  moduleId: uuidString.optional(),
  chapterId: uuidString.optional(),
  topicId: uuidString.optional(),
}).refine(
  (data) => data.noteId || data.cardId || data.deckId,
  { message: 'Se requiere al menos noteId, cardId, o deckId' }
).refine(
  (data) => data.subjectId || data.moduleId || data.chapterId || data.topicId,
  { message: 'Se requiere al menos un nodo curricular (subjectId, moduleId, chapterId, o topicId)' }
);
export type CreateCurriculumLinkInput = z.infer<typeof CreateCurriculumLinkSchema>;
