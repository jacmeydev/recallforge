import { z } from 'zod';
import {
  AIImportItemSchema,
  ConceptualDifficultySchema,
  ConceptualPrioritySchema,
} from '@/lib/validation/ai-import-schema';

export const DraftSourceAssetSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['image', 'page-image', 'pdf-page', 'url', 'text-snippet']),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  pageNumber: z.number().int().positive().optional(),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CopilotDraftCreateItemSchema = AIImportItemSchema.extend({
  reason: z.string().optional(),
  sourceActionId: z.string().optional(),
  sourceAssets: z.array(DraftSourceAssetSchema).optional(),
}).omit({
  source: true,
  program: true,
});

export type CopilotDraftCreateItem = z.infer<typeof CopilotDraftCreateItemSchema>;

export const OpenClawDraftItemSchema = CopilotDraftCreateItemSchema.partial({
  noteType: true,
  deck: true,
}).extend({
  chapterTitle: z.string().optional(),
});

export const OpenClawContextSchema = z.object({
  subject: z.string().min(1, 'subject es obligatorio'),
  module: z.string().optional(),
  chapter: z.string().optional(),
  topic: z.string().optional(),
  subtopic: z.string().optional(),
  lectureDate: z.string().optional(),
  professor: z.string().optional(),
  sourcePage: z.string().optional(),
  book: z.string().optional(),
  className: z.string().optional(),
  examScope: z.string().optional(),
  priority: ConceptualPrioritySchema.optional(),
  conceptualDifficulty: ConceptualDifficultySchema.optional(),
  defaultDeck: z.string().optional(),
  defaultNoteType: z.string().optional(),
  defaultTags: z.array(z.string().min(1)).optional().default([]),
  reason: z.string().optional(),
  sourceActionId: z.string().optional(),
  ingestionId: z.string().optional(),
  chapterTitle: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  sourceAssets: z.array(DraftSourceAssetSchema).optional().default([]),
});

export type OpenClawContext = z.infer<typeof OpenClawContextSchema>;

export const OpenClawDraftBatchSchema = z.object({
  agentId: z.string().optional(),
  context: OpenClawContextSchema,
  drafts: z.array(OpenClawDraftItemSchema).min(1).max(200),
});

export type OpenClawDraftBatch = z.infer<typeof OpenClawDraftBatchSchema>;

export const OpenClawReviewCandidateQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  mode: z.enum(['needs-attention', 'all']).optional().default('needs-attention'),
  deckId: z.string().optional(),
  noteId: z.string().optional(),
});

export const OpenClawImprovementDraftSchema = CopilotDraftCreateItemSchema.partial({
  noteType: true,
  deck: true,
  fields: true,
  tags: true,
}).extend({
  targetNoteId: z.string().min(1, 'targetNoteId es obligatorio'),
  targetCardIds: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  issues: z.array(z.string().min(1)).optional(),
  recommendationSummary: z.string().optional(),
});

export type OpenClawImprovementDraft = z.infer<typeof OpenClawImprovementDraftSchema>;

export const OpenClawImprovementDraftBatchSchema = z.object({
  agentId: z.string().optional(),
  proposals: z.array(OpenClawImprovementDraftSchema).min(1).max(200),
});

export type OpenClawImprovementDraftBatch = z.infer<typeof OpenClawImprovementDraftBatchSchema>;
