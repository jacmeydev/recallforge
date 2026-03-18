// ============================================================================
// RecallForge — Copilot Service (Phase 6: Closed-Loop Study Copilot)
// ============================================================================
// Provides daily briefs, actionable suggestions, draft card queue with
// human-in-the-loop approval, outcome tracking, and feedback loop.
// Builds on top of the existing agent-service layer.
// ============================================================================

import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import { emitAgentEvent, getRecommendations, getStudyPlan, getAcademicSummary, agentImport, countPendingAiReviewCards } from './agent-service';
import type { Recommendation, StudyPlanEntry, AgentImportItem } from './agent-service';
import crypto from 'crypto';
import { buildCanonicalSourceMetadata, serializeNoteFields } from '@/lib/import/canonical';
import type { AcademicMeta, DraftSourceContext, JSONObject, SourceAsset } from '@/types';

let migrated = false;
function ensureMigrated() { if (!migrated) { runMigrations(); migrated = true; } }

function genId(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }
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

function parseSourceAssets(value: unknown): SourceAsset[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) as unknown as SourceAsset[] : [];
  } catch {
    return [];
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)));
}

function resolveOrCreateDeck(userId: string, deckPath: string): { id: string; name: string } {
  const normalizedName = deckPath.trim();
  const existing = sqlite.prepare(
    `SELECT id, name FROM decks WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`
  ).get(userId, normalizedName) as { id: string; name: string } | undefined;
  if (existing) return existing;

  const id = genId();
  const ts = nowIso();
  sqlite.prepare(`
    INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
    VALUES (?, ?, ?, '', 0, 0, '{}', ?, ?)
  `).run(id, userId, normalizedName, ts, ts);

  return { id, name: normalizedName };
}

function getAcademicFromMetadata(metadata: Record<string, unknown>, fallbackSubject?: string | null): AcademicMeta {
  const academic = isRecord(metadata.academic) ? metadata.academic : {};
  return {
    subject: typeof academic.subject === 'string' ? academic.subject : fallbackSubject ?? undefined,
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
    aiReviewStatus: typeof academic.aiReviewStatus === 'string'
      ? academic.aiReviewStatus as AcademicMeta['aiReviewStatus']
      : undefined,
    priority: typeof academic.priority === 'string'
      ? academic.priority as AcademicMeta['priority']
      : undefined,
    conceptualDifficulty: typeof academic.conceptualDifficulty === 'string'
      ? academic.conceptualDifficulty as AcademicMeta['conceptualDifficulty']
      : undefined,
  };
}

function getPendingDraftsCount(userId: string): number {
  return (sqlite.prepare(
    `SELECT COUNT(*) as c FROM copilot_drafts WHERE user_id = ? AND status = 'pending'`
  ).get(userId) as { c: number }).c;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'imported';

export interface CopilotDraft {
  id: string;
  userId: string;
  agentId: string;
  status: DraftStatus;
  noteType: string;
  deck: string;
  fields: Record<string, string>;
  tags: string[];
  subject: string | null;
  reason: string | null;
  sourceMetadata: DraftSourceContext;
  sourceAssets: SourceAsset[];
  sourceActionId: string | null;
  importedNoteId: string | null;
  reviewerComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface CopilotAction {
  id: string;
  actionType: 'rescue_session' | 'review_ai_cards' | 'import_new' | 'study_overdue' | 'study_weak_topic' | 'review_drafts';
  title: string;
  description: string;
  reason: string;
  scope: {
    deckId?: string;
    deckName?: string;
    subject?: string;
    subjectId?: string;
    moduleId?: string;
    moduleName?: string;
    chapterId?: string;
    chapterName?: string;
    topicId?: string;
    topicName?: string;
    noteCount?: number;
  };
  estimatedMinutes: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  expectedImpact: string;
}

export interface CopilotBrief {
  date: string;
  summary: string;
  topPriority: string;
  actions: CopilotAction[];
  studyPlan: { entries: StudyPlanEntry[]; totalMinutes: number; totalCards: number };
  stats: {
    totalCards: number;
    overdueCards: number;
    newCards: number;
    matureCards: number;
    pendingReviewCards: number;
    draftsPending: number;
    subjectsAtRisk: number;
    avgRetrievability: number;
  };
  recommendations: Recommendation[];
}

export interface CopilotOutcome {
  id: string;
  userId: string;
  recommendationId: string | null;
  actionType: string;
  actionTaken: boolean;
  executedAt: string | null;
  resultSummary: string | null;
  cardsImported: number;
  cardsStudied: number;
  riskDelta: number | null;
  masteryDelta: number | null;
  userDismissed: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ─── Daily Brief ───────────────────────────────────────────────────────────

export function generateBrief(userId: string): CopilotBrief {
  ensureMigrated();

  const recommendations = getRecommendations(userId);
  const studyPlan = getStudyPlan(userId, 60);
  const academic = getAcademicSummary(userId);

  // Count pending AI review cards
  const pendingReview = countPendingAiReviewCards(userId);

  // Count pending drafts
  const draftsPending = getPendingDraftsCount(userId);

  // Count subjects at risk
  const subjectsAtRisk = Array.isArray(academic.subjects)
    ? academic.subjects.filter((s: { riskLevel?: string }) => s.riskLevel === 'high' || s.riskLevel === 'critical').length
    : 0;

  // Generate actionable suggestions from real data
  const actions = generateActions(userId, recommendations, academic, pendingReview, draftsPending);

  // Build summary text
  const summaryParts: string[] = [];
  if (academic.cards.overdue > 0) summaryParts.push(`${academic.cards.overdue} tarjetas vencidas`);
  if (pendingReview > 0) summaryParts.push(`${pendingReview} tarjetas IA sin revisar`);
  if (draftsPending > 0) summaryParts.push(`${draftsPending} borradores pendientes`);
  if (subjectsAtRisk > 0) summaryParts.push(`${subjectsAtRisk} materias en riesgo`);
  const summary = summaryParts.length > 0
    ? `Hoy tienes: ${summaryParts.join(', ')}.`
    : 'Todo al día. Buen momento para avanzar con material nuevo.';

  const topPriority = actions.length > 0
    ? actions[0].title
    : 'Sin prioridades urgentes hoy';

  const brief: CopilotBrief = {
    date: new Date().toISOString().slice(0, 10),
    summary,
    topPriority,
    actions,
    studyPlan,
    stats: {
      totalCards: academic.cards.total,
      overdueCards: academic.cards.overdue,
      newCards: academic.cards.new,
      matureCards: academic.cards.mature,
      pendingReviewCards: pendingReview,
      draftsPending,
      subjectsAtRisk,
      avgRetrievability: academic.cards.avgRetrievability ?? 0,
    },
    recommendations,
  };

  emitAgentEvent(userId, 'copilot_brief_generated', 'copilot', genId(), {
    date: brief.date,
    actionsCount: actions.length,
    overdueCards: academic.cards.overdue,
    pendingReview,
    draftsPending,
  }, 'copilot');

  return brief;
}

// ─── Actionable Suggestions ────────────────────────────────────────────────

function generateActions(
  userId: string,
  recommendations: Recommendation[],
  academic: ReturnType<typeof getAcademicSummary>,
  pendingReview: number,
  draftsPending: number
): CopilotAction[] {
  const actions: CopilotAction[] = [];
  let actionIndex = 0;

  // 1. Rescue session if there are cards with very low retrievability
  const rescueCritical = recommendations.filter(r => r.type === 'rescue_session');
  if (rescueCritical.length > 0) {
    const count = rescueCritical.reduce((sum, r) => sum + (((r.data.highRiskCount as number) || (r.data.count as number) || 0)), 0);
    if (count > 0) {
      actions.push({
        id: `action-${++actionIndex}`,
        actionType: 'rescue_session',
        title: `Rescata ${count} tarjetas en peligro`,
        description: 'Hay tarjetas con retrievability muy bajo que podrías perder si no las repasas pronto.',
        reason: 'Basado en retrievability < 0.5',
        scope: { noteCount: count },
        estimatedMinutes: Math.ceil(count * 0.5),
        urgency: 'critical',
        expectedImpact: 'Evitar olvido permanente de material ya aprendido',
      });
    }
  }

  // 2. Overdue cards
  if (academic.cards.overdue > 0) {
    actions.push({
      id: `action-${++actionIndex}`,
      actionType: 'study_overdue',
      title: `Repasa ${academic.cards.overdue} tarjetas vencidas`,
      description: 'Estas tarjetas ya pasaron su fecha de repaso programada.',
      reason: `${academic.cards.overdue} cards con due_at en el pasado`,
      scope: { noteCount: academic.cards.overdue },
      estimatedMinutes: Math.ceil(academic.cards.overdue * 0.5),
      urgency: academic.cards.overdue > 20 ? 'high' : 'medium',
      expectedImpact: 'Mantener estabilidad y evitar acumulación',
    });
  }

  // 3. AI cards pending review
  if (pendingReview > 0) {
    actions.push({
      id: `action-${++actionIndex}`,
      actionType: 'review_ai_cards',
      title: `Revisa ${pendingReview} tarjetas IA pendientes`,
      description: 'Tarjetas importadas por IA que necesitan revisión humana.',
      reason: 'source_metadata.academic.aiReviewStatus = pending-review',
      scope: { noteCount: pendingReview },
      estimatedMinutes: Math.ceil(pendingReview * 0.3),
      urgency: pendingReview > 10 ? 'high' : 'medium',
      expectedImpact: 'Mejorar calidad del material de estudio',
    });
  }

  // 4. Pending drafts
  if (draftsPending > 0) {
    actions.push({
      id: `action-${++actionIndex}`,
      actionType: 'review_drafts',
      title: `Revisa ${draftsPending} borradores del copiloto`,
      description: 'Hay tarjetas sugeridas por el copiloto esperando aprobación.',
      reason: `${draftsPending} drafts con status=pending`,
      scope: { noteCount: draftsPending },
      estimatedMinutes: Math.ceil(draftsPending * 0.3),
      urgency: 'medium',
      expectedImpact: 'Aprobar o rechazar material sugerido',
    });
  }

  // 5. Subjects at risk
  const riskyTopics = Array.isArray(academic.topics)
    ? academic.topics.filter((topic: { riskLevel?: string }) =>
        topic.riskLevel === 'high' || topic.riskLevel === 'critical'
      )
    : [];
  for (const topic of riskyTopics.slice(0, 3)) {
    const current = topic as {
      id?: string;
      name?: string;
      masteryPercent?: number;
      subjectName?: string;
      subjectId?: string;
      moduleId?: string;
      moduleName?: string;
      chapterId?: string;
      chapterName?: string;
    };
    actions.push({
      id: `action-${++actionIndex}`,
      actionType: 'study_weak_topic',
      title: `Refuerza "${current.name || 'tema'}"`,
      description: `Tema con mastery bajo (${current.masteryPercent ?? 0}%) y riesgo alto dentro de ${current.subjectName || 'tu materia'}.`,
      reason: 'riskLevel alto o crítico en resumen académico por topic',
      scope: {
        subject: current.subjectName,
        subjectId: current.subjectId,
        moduleId: current.moduleId,
        moduleName: current.moduleName,
        chapterId: current.chapterId,
        chapterName: current.chapterName,
        topicId: current.id,
        topicName: current.name,
      },
      estimatedMinutes: 15,
      urgency: 'high',
      expectedImpact: 'Mejorar mastery y reducir riesgo en un foco académico concreto',
    });
  }

  const riskySubjects = Array.isArray(academic.subjects)
    ? academic.subjects.filter((s: { riskLevel?: string; name?: string; masteryPercent?: number; deckId?: string }) =>
        s.riskLevel === 'high' || s.riskLevel === 'critical'
      )
    : [];
  for (const sub of riskySubjects.slice(0, 3)) {
    const s = sub as { id?: string; name?: string; masteryPercent?: number; deckId?: string };
    actions.push({
      id: `action-${++actionIndex}`,
      actionType: 'study_weak_topic',
      title: `Refuerza "${s.name || 'materia'}"`,
      description: `Tiene mastery bajo (${s.masteryPercent ?? 0}%) y alto riesgo.`,
      reason: 'riskLevel alto o crítico en resumen académico',
      scope: { subject: s.name, subjectId: s.id, deckId: s.deckId },
      estimatedMinutes: 15,
      urgency: 'high',
      expectedImpact: 'Mejorar mastery y reducir riesgo en esta materia',
    });
  }

  // 6. Leeches
  const leechRecs = recommendations.filter(r => r.type === 'hard_topics');
  if (leechRecs.length > 0) {
    const count = leechRecs.reduce((sum, r) => sum + (((r.data.total as number) || (r.data.count as number) || 0)), 0);
    if (count > 0) {
      actions.push({
        id: `action-${++actionIndex}`,
        actionType: 'rescue_session',
        title: `Atiende ${count} tarjetas sanguijuela`,
        description: 'Tarjetas que fallan repetidamente — considera reformularlas.',
        reason: 'lapses ≥ 3 en review history',
        scope: { noteCount: count },
        estimatedMinutes: Math.ceil(count * 1),
        urgency: 'high',
        expectedImpact: 'Reducir fallos repetidos y frustración',
      });
    }
  }

  // Sort by urgency
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return actions;
}

export function getActions(userId: string): CopilotAction[] {
  ensureMigrated();

  const recommendations = getRecommendations(userId);
  const academic = getAcademicSummary(userId);

  const pendingReview = countPendingAiReviewCards(userId);
  const draftsPending = getPendingDraftsCount(userId);

  const actions = generateActions(userId, recommendations, academic, pendingReview, draftsPending);

  emitAgentEvent(userId, 'copilot_action_suggested', 'copilot', genId(), {
    actionsCount: actions.length,
  }, 'copilot');

  return actions;
}

// ─── Draft Queue ───────────────────────────────────────────────────────────

export function createDrafts(
  userId: string,
  drafts: Array<{
    noteType: string;
    deck: string;
    fields: Record<string, string>;
    tags?: string[];
    subject?: string;
    reason?: string;
    sourceActionId?: string;
    sourceMetadata?: Record<string, unknown>;
    sourceAssets?: SourceAsset[];
    externalId?: string;
    duplicateKey?: string;
    module?: string;
    chapter?: string;
    topic?: string;
    subtopic?: string;
    lectureDate?: string;
    professor?: string;
    sourcePage?: string;
    book?: string;
    className?: string;
    examScope?: string;
    aiGenerated?: boolean;
    aiReviewStatus?: 'pending-review' | 'reviewed' | 'corrected';
    priority?: AcademicMeta['priority'];
    conceptualDifficulty?: AcademicMeta['conceptualDifficulty'];
  }>,
  agentId = 'copilot'
): { created: number; drafts: CopilotDraft[] } {
  ensureMigrated();
  const ts = nowIso();
  const created: CopilotDraft[] = [];

  const insertDraft = sqlite.transaction(() => {
    for (const d of drafts) {
      if (!d.fields || Object.keys(d.fields).length === 0) continue;
      if (!d.noteType || !d.deck) continue;

      const id = genId();
      const sourceAssets = Array.isArray(d.sourceAssets) ? d.sourceAssets : [];
      const canonicalSourceMetadata = buildCanonicalSourceMetadata({
        source: typeof d.sourceMetadata?.importSource === 'string' ? d.sourceMetadata.importSource : agentId,
        sourceMetadata: d.sourceMetadata,
        importSource: typeof d.sourceMetadata?.importSource === 'string' ? d.sourceMetadata.importSource : agentId,
        externalId: d.externalId,
        duplicateKey: d.duplicateKey,
        agentId,
        subject: d.subject,
        module: d.module,
        chapter: d.chapter,
        topic: d.topic,
        subtopic: d.subtopic,
        lectureDate: d.lectureDate,
        professor: d.professor,
        sourcePage: d.sourcePage,
        book: d.book,
        className: d.className,
        examScope: d.examScope,
        aiGenerated: d.aiGenerated ?? true,
        aiReviewStatus: d.aiReviewStatus ?? 'pending-review',
        priority: d.priority,
        conceptualDifficulty: d.conceptualDifficulty,
      }) as DraftSourceContext;

      if (d.sourceActionId) {
        canonicalSourceMetadata.sourceActionId = d.sourceActionId;
      }
      if (sourceAssets.length > 0) {
        canonicalSourceMetadata.sourceAssets = sourceAssets;
      }

      sqlite.prepare(`
        INSERT INTO copilot_drafts (
          id, user_id, agent_id, status, note_type, deck, fields, tags, subject, reason,
          source_metadata, source_assets, source_action_id, created_at, updated_at
        )
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, agentId,
        d.noteType, d.deck,
        JSON.stringify(d.fields),
        JSON.stringify(d.tags || []),
        d.subject || null,
        d.reason || null,
        JSON.stringify(canonicalSourceMetadata),
        JSON.stringify(sourceAssets),
        d.sourceActionId || null,
        ts, ts
      );

      created.push({
        id, userId, agentId, status: 'pending',
        noteType: d.noteType, deck: d.deck,
        fields: d.fields, tags: d.tags || [],
        subject: d.subject || null, reason: d.reason || null,
        sourceMetadata: canonicalSourceMetadata,
        sourceAssets,
        sourceActionId: d.sourceActionId || null, importedNoteId: null,
        reviewerComment: null, createdAt: ts, reviewedAt: null, updatedAt: ts,
      });
    }
  });

  insertDraft();

  if (created.length > 0) {
    emitAgentEvent(userId, 'copilot_draft_created', 'copilot', genId(), {
      agentId,
      count: created.length,
    }, 'copilot');
  }

  return { created: created.length, drafts: created };
}

export function getDrafts(
  userId: string,
  status?: DraftStatus,
  limit = 50
): CopilotDraft[] {
  ensureMigrated();

  let query = `SELECT * FROM copilot_drafts WHERE user_id = ?`;
  const params: unknown[] = [userId];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = sqlite.prepare(query).all(...params) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: r.id as string,
    userId: r.user_id as string,
    agentId: r.agent_id as string,
    status: r.status as DraftStatus,
    noteType: r.note_type as string,
    deck: r.deck as string,
    fields: JSON.parse(r.fields as string),
    tags: JSON.parse(r.tags as string),
    subject: r.subject as string | null,
    reason: r.reason as string | null,
    sourceMetadata: parseJsonRecord(r.source_metadata) as DraftSourceContext,
    sourceAssets: parseSourceAssets(r.source_assets),
    sourceActionId: r.source_action_id as string | null,
    importedNoteId: r.imported_note_id as string | null,
    reviewerComment: r.reviewer_comment as string | null,
    createdAt: r.created_at as string,
    reviewedAt: r.reviewed_at as string | null,
    updatedAt: r.updated_at as string,
  }));
}

// ─── Draft Review (approve / reject / edit) ────────────────────────────────

export interface DraftReviewAction {
  draftId: string;
  action: 'approve' | 'reject' | 'edit';
  comment?: string;
  editedFields?: Record<string, string>;
  editedTags?: string[];
}

export interface DraftReviewResult {
  reviewed: number;
  imported: number;
  updatedExisting: number;
  rejected: number;
  edited: number;
  notFound: number;
  errors: Array<{ draftId: string; message: string }>;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

const applyImprovementDraftToExistingNote = sqlite.transaction((params: {
  userId: string;
  draft: Record<string, unknown>;
  fields: Record<string, string>;
  tags: string[];
  sourceActionId: string;
  ts: string;
}) => {
  const draftMetadata = parseJsonRecord(params.draft.source_metadata);
  const targetNoteId = getString(draftMetadata, 'targetNoteId');
  if (!targetNoteId) {
    throw new Error('Improvement draft is missing targetNoteId');
  }

  const current = sqlite.prepare(`
    SELECT
      n.id,
      n.deck_id,
      d.name AS deck_name,
      n.note_type_id,
      n.field_values,
      n.tags,
      n.source,
      n.source_metadata
    FROM notes n
    JOIN decks d ON d.id = n.deck_id
    WHERE n.id = ? AND n.user_id = ? AND n.deleted_at IS NULL
    LIMIT 1
  `).get(targetNoteId, params.userId) as Record<string, unknown> | undefined;

  if (!current) {
    throw new Error(`Target note ${targetNoteId} not found`);
  }

  const currentFields = parseJsonRecord(current.field_values) as Record<string, string>;
  const currentTags = parseStringArray(current.tags);
  const currentMetadata = parseJsonRecord(current.source_metadata);
  const currentAcademic = getAcademicFromMetadata(currentMetadata);
  const draftAcademic = getAcademicFromMetadata(draftMetadata, params.draft.subject as string | null);
  const sourceAssets = parseSourceAssets(params.draft.source_assets);

  const nextFields = Object.keys(params.fields).length > 0 ? params.fields : currentFields;
  const nextTags = uniqueStrings(params.tags.length > 0 ? params.tags : currentTags);
  const requestedDeckName = typeof params.draft.deck === 'string' && params.draft.deck.trim().length > 0
    ? params.draft.deck.trim()
    : (current.deck_name as string);
  const targetDeck = resolveOrCreateDeck(params.userId, requestedDeckName);

  const improvementDetails: Record<string, unknown> = {
    draftId: params.draft.id,
    agentId: params.draft.agent_id,
    approvedAt: params.ts,
    sourceActionId: params.sourceActionId,
  };

  if (typeof draftMetadata.confidence === 'number') improvementDetails.confidence = draftMetadata.confidence;
  if (Array.isArray(draftMetadata.issues)) improvementDetails.issues = draftMetadata.issues;
  if (typeof draftMetadata.recommendationSummary === 'string') {
    improvementDetails.recommendationSummary = draftMetadata.recommendationSummary;
  }

  const mergedSourceMetadataInput: Record<string, unknown> = {
    ...currentMetadata,
    ...draftMetadata,
    draftId: params.draft.id,
    sourceActionId: params.sourceActionId,
    improvedByAgentId: params.draft.agent_id,
    lastImprovement: improvementDetails,
  };

  if (sourceAssets.length > 0) {
    mergedSourceMetadataInput.sourceAssets = sourceAssets;
  }

  delete mergedSourceMetadataInput.draftMode;
  delete mergedSourceMetadataInput.targetNoteId;
  delete mergedSourceMetadataInput.targetCardIds;
  delete mergedSourceMetadataInput.targetDeckId;
  delete mergedSourceMetadataInput.targetDeckName;
  delete mergedSourceMetadataInput.confidence;
  delete mergedSourceMetadataInput.issues;
  delete mergedSourceMetadataInput.recommendationSummary;

  const currentImportSource = getString(currentMetadata, 'importSource')
    ?? (current.source as string | null)
    ?? (params.draft.agent_id as string | null)
    ?? 'manual';
  const externalId = getString(draftMetadata, 'externalId') ?? getString(currentMetadata, 'externalId');
  const duplicateKey = getString(draftMetadata, 'duplicateKey') ?? getString(currentMetadata, 'duplicateKey');

  const nextSourceMetadata = buildCanonicalSourceMetadata({
    source: currentImportSource,
    sourceMetadata: mergedSourceMetadataInput,
    importSource: currentImportSource,
    externalId,
    duplicateKey,
    agentId: typeof params.draft.agent_id === 'string' ? params.draft.agent_id : undefined,
    subject: draftAcademic.subject ?? currentAcademic.subject,
    module: draftAcademic.module ?? currentAcademic.module,
    chapter: draftAcademic.chapter ?? currentAcademic.chapter,
    topic: draftAcademic.topic ?? currentAcademic.topic,
    subtopic: draftAcademic.subtopic ?? currentAcademic.subtopic,
    lectureDate: draftAcademic.lectureDate ?? currentAcademic.lectureDate,
    professor: draftAcademic.professor ?? currentAcademic.professor,
    sourcePage: draftAcademic.sourcePage ?? currentAcademic.sourcePage,
    book: draftAcademic.book ?? currentAcademic.book,
    className: draftAcademic.className ?? currentAcademic.className,
    examScope: draftAcademic.examScope ?? currentAcademic.examScope,
    aiGenerated: true,
    aiReviewStatus: 'reviewed',
    priority: draftAcademic.priority ?? currentAcademic.priority,
    conceptualDifficulty: draftAcademic.conceptualDifficulty ?? currentAcademic.conceptualDifficulty,
  }) as DraftSourceContext;

  if (sourceAssets.length > 0) {
    nextSourceMetadata.sourceAssets = sourceAssets;
  }

  const nextHash = crypto.createHash('sha256').update(serializeNoteFields(nextFields)).digest('hex').slice(0, 16);

  sqlite.prepare(`
    UPDATE notes
    SET deck_id = ?,
        field_values = ?,
        tags = ?,
        source = ?,
        source_metadata = ?,
        hash = ?,
        updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(
    targetDeck.id,
    JSON.stringify(nextFields),
    JSON.stringify(nextTags),
    currentImportSource,
    JSON.stringify(nextSourceMetadata),
    nextHash,
    params.ts,
    targetNoteId,
    params.userId
  );

  sqlite.prepare(`
    UPDATE cards
    SET deck_id = ?, updated_at = ?
    WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(targetDeck.id, params.ts, targetNoteId, params.userId);

  sqlite.prepare(`
    UPDATE curriculum_links
    SET deck_id = ?
    WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(targetDeck.id, targetNoteId, params.userId);

  return {
    noteId: targetNoteId,
    deckId: targetDeck.id,
    deckName: targetDeck.name,
  };
});

export function reviewDrafts(userId: string, reviews: DraftReviewAction[]): DraftReviewResult {
  ensureMigrated();
  const ts = nowIso();
  const result: DraftReviewResult = { reviewed: 0, imported: 0, updatedExisting: 0, rejected: 0, edited: 0, notFound: 0, errors: [] };

  for (const rev of reviews) {
    const draft = sqlite.prepare(
      `SELECT * FROM copilot_drafts WHERE id = ? AND user_id = ?`
    ).get(rev.draftId, userId) as Record<string, unknown> | undefined;

    if (!draft) {
      result.notFound++;
      continue;
    }

    const draftStatus = draft.status as DraftStatus;
    const canRetryApprovedImport = draftStatus === 'approved' && !draft.imported_note_id;

    if (!['pending', 'edited'].includes(draftStatus) && !canRetryApprovedImport) {
      result.errors.push({ draftId: rev.draftId, message: `Draft already ${draft.status}` });
      continue;
    }

    if (rev.action === 'reject') {
      sqlite.prepare(
        `UPDATE copilot_drafts SET status = 'rejected', reviewer_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
      ).run(rev.comment || null, ts, ts, rev.draftId);
      result.rejected++;
      result.reviewed++;
    } else if (rev.action === 'edit') {
      const newFields = rev.editedFields || JSON.parse(draft.fields as string);
      const newTags = rev.editedTags || JSON.parse(draft.tags as string);
      sqlite.prepare(
        `UPDATE copilot_drafts SET status = 'edited', fields = ?, tags = ?, reviewer_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(newFields), JSON.stringify(newTags), rev.comment || null, ts, ts, rev.draftId);
      result.edited++;
      result.reviewed++;
    } else if (rev.action === 'approve') {
      const fields = rev.editedFields || JSON.parse(draft.fields as string);
      const tags = rev.editedTags || JSON.parse(draft.tags as string);
      const sourceActionId = (draft.source_action_id as string | null) || rev.draftId;
      const alreadyApproved = draftStatus === 'approved';
      const existingSourceMetadata = parseJsonRecord(draft.source_metadata);
      const improvementMode = getString(existingSourceMetadata, 'draftMode') === 'improve-existing';
      const sourceAssets = parseSourceAssets(draft.source_assets);
      const academic = getAcademicFromMetadata(existingSourceMetadata, draft.subject as string | null);
      const importSource = typeof existingSourceMetadata.importSource === 'string'
        ? existingSourceMetadata.importSource
        : (draft.agent_id as string) || 'copilot-draft';
      const externalId = typeof existingSourceMetadata.externalId === 'string'
        ? existingSourceMetadata.externalId
        : undefined;
      const duplicateKey = typeof existingSourceMetadata.duplicateKey === 'string'
        ? existingSourceMetadata.duplicateKey
        : undefined;
      const importSourceMetadata: JSONObject = {
        ...(existingSourceMetadata as JSONObject),
        draftId: rev.draftId,
        agentId: draft.agent_id as string,
        sourceActionId,
      };
      if (sourceAssets.length > 0) {
        importSourceMetadata.sourceAssets = sourceAssets as unknown as JSONObject[keyof JSONObject];
      }
      const importItem: AgentImportItem = {
        noteType: draft.note_type as string,
        deck: draft.deck as string,
        fields,
        tags,
        subject: academic.subject,
        module: academic.module,
        chapter: academic.chapter,
        topic: academic.topic,
        subtopic: academic.subtopic,
        lectureDate: academic.lectureDate,
        professor: academic.professor,
        sourcePage: academic.sourcePage,
        book: academic.book,
        className: academic.className,
        examScope: academic.examScope,
        priority: academic.priority,
        conceptualDifficulty: academic.conceptualDifficulty,
        source: importSource,
        sourceMetadata: importSourceMetadata,
        externalId,
        duplicateKey,
        aiGenerated: true,
        aiReviewStatus: 'reviewed',
      };

      if (!alreadyApproved) {
        sqlite.prepare(
          `UPDATE copilot_drafts SET status = 'approved', reviewer_comment = ?, reviewed_at = ?, updated_at = ?, source_action_id = ? WHERE id = ?`
        ).run(rev.comment || null, ts, ts, sourceActionId, rev.draftId);
        emitAgentEvent(userId, 'copilot_draft_approved', 'copilot', rev.draftId, {
          draftId: rev.draftId,
          sourceActionId,
        }, 'copilot');
      } else {
        sqlite.prepare(
          `UPDATE copilot_drafts SET reviewer_comment = COALESCE(?, reviewer_comment), updated_at = ?, source_action_id = ? WHERE id = ?`
        ).run(rev.comment || null, ts, sourceActionId, rev.draftId);
      }

      if (improvementMode) {
        try {
          const updateResult = applyImprovementDraftToExistingNote({
            userId,
            draft,
            fields,
            tags,
            sourceActionId,
            ts,
          });

          sqlite.prepare(
            `UPDATE copilot_drafts SET status = 'imported', reviewer_comment = ?, reviewed_at = ?, updated_at = ?, imported_note_id = ?, source_action_id = ? WHERE id = ?`
          ).run(rev.comment || null, ts, ts, updateResult.noteId, sourceActionId, rev.draftId);

          emitAgentEvent(userId, 'copilot_draft_imported', 'copilot', rev.draftId, {
            draftId: rev.draftId,
            importedNoteId: updateResult.noteId,
            sourceActionId,
            mode: 'updated-existing',
            deckId: updateResult.deckId,
            deckName: updateResult.deckName,
          }, 'copilot');
          result.imported++;
          result.updatedExisting++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Existing note update failed';
          result.errors.push({ draftId: rev.draftId, message });
          emitAgentEvent(userId, 'copilot_draft_import_failed', 'copilot', rev.draftId, {
            draftId: rev.draftId,
            sourceActionId,
            error: message,
            mode: 'updated-existing',
          }, 'copilot');
        }
      } else {
        const importResult = agentImport(userId, [importItem], {
          duplicateStrategy: 'skip',
          agentId: (draft.agent_id as string) || 'copilot',
        });
        const importedNoteId = importResult.itemResults[0]?.noteId ?? null;

        if (importResult.created > 0) {
          sqlite.prepare(
            `UPDATE copilot_drafts SET status = 'imported', reviewer_comment = ?, reviewed_at = ?, updated_at = ?, imported_note_id = ?, source_action_id = ? WHERE id = ?`
          ).run(rev.comment || null, ts, ts, importedNoteId, sourceActionId, rev.draftId);
          emitAgentEvent(userId, 'copilot_draft_imported', 'copilot', rev.draftId, {
            draftId: rev.draftId,
            importedNoteId,
            sourceActionId,
            mode: 'created',
          }, 'copilot');
          result.imported++;
        } else if (importResult.skipped > 0) {
          sqlite.prepare(
            `UPDATE copilot_drafts SET status = 'imported', reviewer_comment = ?, reviewed_at = ?, updated_at = ?, imported_note_id = ?, source_action_id = ? WHERE id = ?`
          ).run('Duplicate — skipped but marked imported', ts, ts, importedNoteId, sourceActionId, rev.draftId);
          emitAgentEvent(userId, 'copilot_draft_imported', 'copilot', rev.draftId, {
            draftId: rev.draftId,
            importedNoteId,
            sourceActionId,
            mode: 'duplicate-skip',
          }, 'copilot');
          result.imported++;
        } else {
          result.errors.push({
            draftId: rev.draftId,
            message: importResult.errors[0]?.message || 'Import failed',
          });
          emitAgentEvent(userId, 'copilot_draft_import_failed', 'copilot', rev.draftId, {
            draftId: rev.draftId,
            sourceActionId,
            error: importResult.errors[0]?.message || 'Import failed',
          }, 'copilot');
        }
      }
      result.reviewed++;
    }
  }

  emitAgentEvent(userId, 'copilot_draft_reviewed', 'copilot', genId(), {
    reviewed: result.reviewed,
    imported: result.imported,
    updatedExisting: result.updatedExisting,
    rejected: result.rejected,
    edited: result.edited,
  }, 'copilot');

  return result;
}

// ─── Outcome Tracking ──────────────────────────────────────────────────────

export function recordOutcome(
  userId: string,
  outcome: {
    recommendationId?: string;
    actionType: string;
    actionTaken: boolean;
    executedAt?: string;
    resultSummary?: string;
    cardsImported?: number;
    cardsStudied?: number;
    riskDelta?: number;
    masteryDelta?: number;
    userDismissed?: boolean;
    payload?: Record<string, unknown>;
  }
): CopilotOutcome {
  ensureMigrated();
  const id = genId();
  const ts = nowIso();

  sqlite.prepare(`
    INSERT INTO copilot_outcomes (id, user_id, recommendation_id, action_type, action_taken, executed_at, result_summary, cards_imported, cards_studied, risk_delta, mastery_delta, user_dismissed, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId,
    outcome.recommendationId || null,
    outcome.actionType,
    outcome.actionTaken ? 1 : 0,
    outcome.executedAt || null,
    outcome.resultSummary || null,
    outcome.cardsImported || 0,
    outcome.cardsStudied || 0,
    outcome.riskDelta ?? null,
    outcome.masteryDelta ?? null,
    outcome.userDismissed ? 1 : 0,
    JSON.stringify(outcome.payload || {}),
    ts
  );

  emitAgentEvent(userId, 'copilot_outcome_recorded', 'copilot', id, {
    actionType: outcome.actionType,
    actionTaken: outcome.actionTaken,
    userDismissed: outcome.userDismissed || false,
  }, 'copilot');

  return {
    id, userId,
    recommendationId: outcome.recommendationId || null,
    actionType: outcome.actionType,
    actionTaken: outcome.actionTaken,
    executedAt: outcome.executedAt || null,
    resultSummary: outcome.resultSummary || null,
    cardsImported: outcome.cardsImported || 0,
    cardsStudied: outcome.cardsStudied || 0,
    riskDelta: outcome.riskDelta ?? null,
    masteryDelta: outcome.masteryDelta ?? null,
    userDismissed: outcome.userDismissed || false,
    payload: outcome.payload || {},
    createdAt: ts,
  };
}

// ─── History ───────────────────────────────────────────────────────────────

export function getCopilotHistory(
  userId: string,
  limit = 50
): Array<{ type: string; ts: string; payload: Record<string, unknown> }> {
  ensureMigrated();

  const events = sqlite.prepare(
    `SELECT type, ts, payload FROM activity_events
     WHERE user_id = ? AND type LIKE 'copilot_%'
     ORDER BY ts DESC LIMIT ?`
  ).all(userId, limit) as Array<{ type: string; ts: string; payload: string }>;

  return events.map(e => ({
    type: e.type,
    ts: e.ts,
    payload: JSON.parse(e.payload),
  }));
}
