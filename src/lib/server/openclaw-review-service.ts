import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { createDrafts } from '@/lib/server/copilot-service';
import { buildCanonicalSourceMetadata } from '@/lib/import/canonical';
import type { DraftSourceContext, SourceAsset, AcademicMeta } from '@/types';
import type { OpenClawImprovementDraft } from '@/lib/validation/copilot-draft-schema';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseSourceAssets(value: unknown): SourceAsset[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) as unknown as SourceAsset[] : [];
  } catch {
    return [];
  }
}

function getAcademic(metadata: Record<string, unknown> | DraftSourceContext): AcademicMeta {
  const metadataRecord = metadata as unknown as Record<string, unknown>;
  const academic = isRecord(metadataRecord.academic) ? metadataRecord.academic : {};
  return {
    subject: typeof academic.subject === 'string' ? academic.subject : undefined,
    module: typeof academic.module === 'string' ? academic.module : undefined,
    chapter: typeof academic.chapter === 'string' ? academic.chapter : undefined,
    topic: typeof academic.topic === 'string' ? academic.topic : undefined,
    subtopic: typeof academic.subtopic === 'string' ? academic.subtopic : undefined,
    lectureDate: typeof academic.lectureDate === 'string' ? academic.lectureDate : undefined,
    professor: typeof academic.professor === 'string' ? academic.professor : undefined,
    sourcePage: typeof academic.sourcePage === 'string' ? academic.sourcePage : undefined,
    book: typeof academic.book === 'string' ? academic.book : undefined,
    className: typeof academic.className === 'string' ? academic.className : undefined,
    examScope: typeof academic.examScope === 'string' ? academic.examScope : undefined,
    aiGenerated: typeof academic.aiGenerated === 'boolean' ? academic.aiGenerated : undefined,
    aiReviewStatus: typeof academic.aiReviewStatus === 'string' ? academic.aiReviewStatus as AcademicMeta['aiReviewStatus'] : undefined,
    priority: typeof academic.priority === 'string' ? academic.priority as AcademicMeta['priority'] : undefined,
    conceptualDifficulty: typeof academic.conceptualDifficulty === 'string'
      ? academic.conceptualDifficulty as AcademicMeta['conceptualDifficulty']
      : undefined,
  };
}

function buildIssues(params: {
  tags: string[];
  academic: AcademicMeta;
  curriculumLinked: boolean;
  fields: Record<string, string>;
}): string[] {
  const issues: string[] = [];

  if (!params.academic.subject) issues.push('missing_subject');
  if (!params.academic.module) issues.push('missing_module');
  if (!params.academic.chapter) issues.push('missing_chapter');
  if (!params.academic.topic) issues.push('missing_topic');
  if (params.academic.aiReviewStatus === 'pending-review') issues.push('pending_ai_review');
  if (params.tags.length === 0) issues.push('missing_tags');
  if (!params.curriculumLinked) issues.push('missing_curriculum_link');

  const back = params.fields.Back ?? params.fields.Answer ?? '';
  if (typeof back === 'string' && back.length > 320) issues.push('long_answer');

  return issues;
}

export interface OpenClawReviewCandidate {
  noteId: string;
  cardIds: string[];
  deckId: string;
  deckName: string;
  noteTypeId: string;
  noteTypeName: string;
  fields: Record<string, string>;
  tags: string[];
  academic: AcademicMeta;
  sourceMetadata: DraftSourceContext;
  sourceAssets: SourceAsset[];
  issues: string[];
  stats: {
    cardCount: number;
    overdueCards: number;
    newCards: number;
    reviewCards: number;
    lapses: number;
  };
  updatedAt: string;
}

export function getOpenClawReviewCandidates(
  userId: string,
  options: { limit?: number; mode?: 'needs-attention' | 'all'; deckId?: string; noteId?: string } = {}
): OpenClawReviewCandidate[] {
  ensureMigrated();

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const where: string[] = ['n.user_id = ?', 'n.deleted_at IS NULL', 'd.deleted_at IS NULL'];
  const params: unknown[] = [userId];

  if (options.deckId) {
    where.push('n.deck_id = ?');
    params.push(options.deckId);
  }
  if (options.noteId) {
    where.push('n.id = ?');
    params.push(options.noteId);
  }

  const rows = sqlite.prepare(`
    SELECT
      n.id AS note_id,
      n.deck_id,
      d.name AS deck_name,
      n.note_type_id,
      nt.name AS note_type_name,
      n.field_values,
      n.tags,
      n.source_metadata,
      n.updated_at,
      COUNT(DISTINCT c.id) AS card_count,
      GROUP_CONCAT(DISTINCT c.id) AS card_ids,
      SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) AS new_cards,
      SUM(CASE WHEN c.state = 'review' THEN 1 ELSE 0 END) AS review_cards,
      SUM(CASE WHEN c.state != 'new' AND c.due_at <= ? THEN 1 ELSE 0 END) AS overdue_cards,
      SUM(COALESCE(c.lapses, 0)) AS lapses,
      COUNT(DISTINCT cl.id) AS curriculum_links
    FROM notes n
    JOIN decks d ON d.id = n.deck_id
    LEFT JOIN note_types nt ON nt.id = n.note_type_id
    LEFT JOIN cards c ON c.note_id = n.id AND c.deleted_at IS NULL
    LEFT JOIN curriculum_links cl ON cl.note_id = n.id AND cl.deleted_at IS NULL
    WHERE ${where.join(' AND ')}
    GROUP BY n.id, n.deck_id, d.name, n.note_type_id, nt.name, n.field_values, n.tags, n.source_metadata, n.updated_at
    ORDER BY n.updated_at DESC
    LIMIT ?
  `).all(new Date().toISOString(), ...params, limit) as Array<Record<string, unknown>>;

  const candidates = rows.map((row): OpenClawReviewCandidate => {
    const sourceMetadata = parseJsonRecord(row.source_metadata) as DraftSourceContext;
    const academic = getAcademic(sourceMetadata);
    const fields = parseJsonRecord(row.field_values) as Record<string, string>;
    const tags = parseStringArray(row.tags);
    const sourceAssets = Array.isArray(sourceMetadata.sourceAssets)
      ? sourceMetadata.sourceAssets
      : parseSourceAssets(row.source_assets);
    const issues = buildIssues({
      tags,
      academic,
      curriculumLinked: Number(row.curriculum_links ?? 0) > 0,
      fields,
    });

    return {
      noteId: row.note_id as string,
      cardIds: typeof row.card_ids === 'string' && row.card_ids.length > 0 ? row.card_ids.split(',') : [],
      deckId: row.deck_id as string,
      deckName: row.deck_name as string,
      noteTypeId: row.note_type_id as string,
      noteTypeName: typeof row.note_type_name === 'string' && row.note_type_name.length > 0
        ? row.note_type_name as string
        : 'unknown',
      fields,
      tags,
      academic,
      sourceMetadata,
      sourceAssets,
      issues,
      stats: {
        cardCount: Number(row.card_count ?? 0),
        overdueCards: Number(row.overdue_cards ?? 0),
        newCards: Number(row.new_cards ?? 0),
        reviewCards: Number(row.review_cards ?? 0),
        lapses: Number(row.lapses ?? 0),
      },
      updatedAt: row.updated_at as string,
    };
  });

  if (options.mode === 'all') return candidates;
  return candidates.filter((candidate) => candidate.issues.length > 0);
}

function getTargetNote(userId: string, noteId: string) {
  return sqlite.prepare(`
    SELECT
      n.id AS note_id,
      n.deck_id,
      d.name AS deck_name,
      n.note_type_id,
      nt.name AS note_type_name,
      n.field_values,
      n.tags,
      n.source_metadata
    FROM notes n
    JOIN decks d ON d.id = n.deck_id
    LEFT JOIN note_types nt ON nt.id = n.note_type_id
    WHERE n.id = ? AND n.user_id = ? AND n.deleted_at IS NULL
    LIMIT 1
  `).get(noteId, userId) as Record<string, unknown> | undefined;
}

export function createOpenClawImprovementDrafts(
  userId: string,
  proposals: OpenClawImprovementDraft[],
  agentId = 'openclaw'
): { created: number; drafts: ReturnType<typeof createDrafts>['drafts']; notFound: string[] } {
  ensureMigrated();

  const normalized: Parameters<typeof createDrafts>[1] = [];
  const notFound: string[] = [];

  for (const proposal of proposals) {
    const target = getTargetNote(userId, proposal.targetNoteId);
    if (!target) {
      notFound.push(proposal.targetNoteId);
      continue;
    }

    const currentFields = parseJsonRecord(target.field_values) as Record<string, string>;
    const currentTags = parseStringArray(target.tags);
    const currentMetadata = parseJsonRecord(target.source_metadata);
    const currentAcademic = getAcademic(currentMetadata);

    const nextFields = proposal.fields && Object.keys(proposal.fields).length > 0
      ? proposal.fields
      : currentFields;
    const nextTags = proposal.tags && proposal.tags.length > 0
      ? proposal.tags
      : currentTags;

    const canonicalSourceMetadata = buildCanonicalSourceMetadata({
      source: typeof currentMetadata.importSource === 'string' ? currentMetadata.importSource : agentId,
      sourceMetadata: {
        ...currentMetadata,
        ...(proposal.sourceMetadata || {}),
        draftMode: 'improve-existing',
        targetNoteId: proposal.targetNoteId,
        targetCardIds: proposal.targetCardIds,
        targetDeckId: target.deck_id,
        targetDeckName: target.deck_name,
        confidence: proposal.confidence,
        issues: proposal.issues,
        recommendationSummary: proposal.recommendationSummary,
      },
      importSource: typeof currentMetadata.importSource === 'string' ? currentMetadata.importSource : agentId,
      externalId: typeof currentMetadata.externalId === 'string' ? currentMetadata.externalId : undefined,
      duplicateKey: typeof currentMetadata.duplicateKey === 'string' ? currentMetadata.duplicateKey : undefined,
      agentId,
      subject: proposal.subject ?? currentAcademic.subject,
      module: proposal.module ?? currentAcademic.module,
      chapter: proposal.chapter ?? currentAcademic.chapter,
      topic: proposal.topic ?? currentAcademic.topic,
      subtopic: proposal.subtopic ?? currentAcademic.subtopic,
      lectureDate: proposal.lectureDate ?? currentAcademic.lectureDate,
      professor: proposal.professor ?? currentAcademic.professor,
      sourcePage: proposal.sourcePage ?? currentAcademic.sourcePage,
      book: proposal.book ?? currentAcademic.book,
      className: proposal.className ?? currentAcademic.className,
      examScope: proposal.examScope ?? currentAcademic.examScope,
      aiGenerated: true,
      aiReviewStatus: proposal.aiReviewStatus ?? currentAcademic.aiReviewStatus ?? 'pending-review',
      priority: proposal.priority ?? currentAcademic.priority,
      conceptualDifficulty: proposal.conceptualDifficulty ?? currentAcademic.conceptualDifficulty,
    }) as DraftSourceContext;

    normalized.push({
      noteType: proposal.noteType || (target.note_type_name as string) || 'basic',
      deck: proposal.deck || (target.deck_name as string),
      fields: nextFields,
      tags: nextTags,
      reason: proposal.reason || 'OpenClaw suggested improvements for existing note',
      sourceActionId: proposal.sourceActionId,
      sourceMetadata: canonicalSourceMetadata as unknown as Record<string, unknown>,
      sourceAssets: proposal.sourceAssets,
      subject: proposal.subject ?? currentAcademic.subject,
      module: proposal.module ?? currentAcademic.module,
      chapter: proposal.chapter ?? currentAcademic.chapter,
      topic: proposal.topic ?? currentAcademic.topic,
      subtopic: proposal.subtopic ?? currentAcademic.subtopic,
      lectureDate: proposal.lectureDate ?? currentAcademic.lectureDate,
      professor: proposal.professor ?? currentAcademic.professor,
      sourcePage: proposal.sourcePage ?? currentAcademic.sourcePage,
      book: proposal.book ?? currentAcademic.book,
      className: proposal.className ?? currentAcademic.className,
      examScope: proposal.examScope ?? currentAcademic.examScope,
      aiGenerated: true,
      aiReviewStatus: proposal.aiReviewStatus ?? currentAcademic.aiReviewStatus ?? 'pending-review',
      priority: proposal.priority ?? currentAcademic.priority,
      conceptualDifficulty: proposal.conceptualDifficulty ?? currentAcademic.conceptualDifficulty,
    });
  }

  const result = createDrafts(userId, normalized, agentId);
  return { ...result, notFound };
}
