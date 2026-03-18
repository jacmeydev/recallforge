export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/api-auth';
import { createDrafts } from '@/lib/server/copilot-service';
import { emitAgentEvent } from '@/lib/server/agent-service';
import { logger } from '@/lib/server/logger';
import { recordRouteObservation } from '@/lib/server/observability';
import { OpenClawDraftBatchSchema } from '@/lib/validation/copilot-draft-schema';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

function deriveDefaultDeck(subject: string, chapter?: string): string {
  const cleanSubject = subject.trim();
  const cleanChapter = chapter?.trim();
  if (cleanChapter) {
    return `${cleanSubject}::${cleanChapter}`;
  }
  return cleanSubject;
}

function computeDuplicateKey(ingestionId: string | undefined, draftIndex: number, fields: Record<string, string>): string | undefined {
  if (!ingestionId) return undefined;
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))))
    .digest('hex')
    .slice(0, 16);
  return `openclaw:${ingestionId}:${draftIndex}:${hash}`;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'openclaw/drafts' });
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) {
    recordRouteObservation({
      route: 'openclaw/drafts',
      method: 'POST',
      status: authResult.error.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Authentication required',
    });
    return withRequestContext(authResult.error, context);
  }
  const { user } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const response = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    recordRouteObservation({
      route: 'openclaw/drafts',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Invalid JSON body',
    });
    return withRequestContext(response, context);
  }

  const parsed = OpenClawDraftBatchSchema.safeParse(body);
  if (!parsed.success) {
    const response = NextResponse.json({
        error: 'Invalid OpenClaw payload',
        validationErrors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      }, { status: 400 });
    recordRouteObservation({
      route: 'openclaw/drafts',
      method: 'POST',
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: context.requestId,
      userId: user.id,
      deviceId: context.deviceId,
      operationId: context.operationId,
      errorMessage: 'Invalid OpenClaw payload',
    });
    return withRequestContext(response, context);
  }

  const { drafts, context: openclawContext } = parsed.data;
  const agentId = parsed.data.agentId || 'openclaw';
  const ingestionId = openclawContext.ingestionId || `openclaw-${context.requestId}`;
  const defaultDeck = openclawContext.defaultDeck || deriveDefaultDeck(openclawContext.subject, openclawContext.chapter);
  const defaultNoteType = openclawContext.defaultNoteType || 'basic';
  const defaultTags = Array.from(new Set([...(openclawContext.defaultTags || []), 'openclaw', 'ai-generated']));
  const defaultSourceActionId = openclawContext.sourceActionId || `${ingestionId}:batch`;

  const normalizedDrafts = drafts.map((draft, index) => {
    const sourceAssets = draft.sourceAssets ?? openclawContext.sourceAssets ?? [];
    const sourceActionId = draft.sourceActionId || `${defaultSourceActionId}:${index + 1}`;
    const duplicateKey = draft.duplicateKey || computeDuplicateKey(ingestionId, index + 1, draft.fields);
    const mergedSourceMetadata = {
      ...(openclawContext.sourceMetadata || {}),
      ...(draft.sourceMetadata || {}),
      importSource: 'openclaw',
      provider: openclawContext.provider || 'openclaw',
      ingestionId,
      model: openclawContext.model,
      promptVersion: openclawContext.promptVersion,
      chapterTitle: draft.chapterTitle || openclawContext.chapterTitle || openclawContext.chapter,
      sourceActionId,
      requestId: context.requestId,
    };

    return {
      noteType: draft.noteType || defaultNoteType,
      deck: draft.deck || defaultDeck,
      fields: draft.fields,
      tags: Array.from(new Set([...(draft.tags || []), ...defaultTags])),
      reason: draft.reason || openclawContext.reason || `OpenClaw draft from ${openclawContext.subject}`,
      sourceActionId,
      sourceMetadata: mergedSourceMetadata,
      sourceAssets,
      subject: draft.subject || openclawContext.subject,
      module: draft.module || openclawContext.module,
      chapter: draft.chapter || openclawContext.chapter,
      topic: draft.topic || openclawContext.topic,
      subtopic: draft.subtopic || openclawContext.subtopic,
      lectureDate: draft.lectureDate || openclawContext.lectureDate,
      professor: draft.professor || openclawContext.professor,
      sourcePage: draft.sourcePage || openclawContext.sourcePage,
      book: draft.book || openclawContext.book,
      className: draft.className || openclawContext.className,
      examScope: draft.examScope || openclawContext.examScope,
      externalId: draft.externalId,
      duplicateKey,
      aiGenerated: draft.aiGenerated ?? true,
      aiReviewStatus: draft.aiReviewStatus ?? 'pending-review',
      priority: draft.priority || openclawContext.priority,
      conceptualDifficulty: draft.conceptualDifficulty || openclawContext.conceptualDifficulty,
    };
  });

  const result = createDrafts(user.id, normalizedDrafts, agentId);

  emitAgentEvent(user.id, 'openclaw_draft_batch_received', 'openclaw', ingestionId, {
    ingestionId,
    requestId: context.requestId,
    created: result.created,
    requested: drafts.length,
    subject: openclawContext.subject,
    module: openclawContext.module,
    chapter: openclawContext.chapter,
    topic: openclawContext.topic,
  }, 'openclaw');
  log.metric('openclaw_drafts_received', result.created, {
    userId: user.id,
    ingestionId,
    subject: openclawContext.subject,
    requested: drafts.length,
  });

  const response = NextResponse.json({
    ok: true,
    ingestionId,
    userId: user.id,
    timestamp: new Date().toISOString(),
    ...result,
  });
  recordRouteObservation({
    route: 'openclaw/drafts',
    method: 'POST',
    status: response.status,
    durationMs: Date.now() - startedAt,
    requestId: context.requestId,
    userId: user.id,
    deviceId: context.deviceId,
    operationId: context.operationId,
  });
  return withRequestContext(response, context);
}
