// ============================================================================
// RecallForge — Phase 6 Copilot Tests
// ============================================================================
// Tests copilot service functions (server-side, direct SQLite):
// brief generation, actions, drafts CRUD, review, outcomes, history, audit trail
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateBrief,
  getActions,
  createDrafts,
  getDrafts,
  reviewDrafts,
  recordOutcome,
  getCopilotHistory,
} from '@/lib/server/copilot-service';
import {
  createOpenClawImprovementDrafts,
  getOpenClawReviewCandidates,
} from '@/lib/server/openclaw-review-service';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';

const TEST_USER_ID = `test-phase6-${Date.now()}`;
const TEST_EMAIL = `${TEST_USER_ID}@test.com`;

async function reviewDraftsWithRetry(
  userId: string,
  reviews: Parameters<typeof reviewDrafts>[1],
  attempts = 5
) {
  let result = reviewDrafts(userId, reviews);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const lockErrors = result.errors.filter((error) => /locked|busy/i.test(error.message));
    if (lockErrors.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
    result = reviewDrafts(userId, reviews);
  }
  return result;
}

beforeAll(() => {
  runMigrations();

  // Clean up any previous test data
  const oldUsers = sqlite.prepare(
    `SELECT id FROM users WHERE email LIKE 'test-phase6-%@test.com'`
  ).all() as Array<{ id: string }>;
  for (const u of oldUsers) {
    sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM copilot_drafts WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM copilot_outcomes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(u.id);
  }

  // Create test user
  sqlite.prepare(`
    INSERT INTO users (id, email, name, password_hash, api_key, created_at, updated_at)
    VALUES (?, ?, ?, 'dummy', 'test-key-p6', datetime('now'), datetime('now'))
  `).run(TEST_USER_ID, TEST_EMAIL, 'Phase 6 Test');

  // Create basic note type
  sqlite.prepare(`
    INSERT OR IGNORE INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
    VALUES (?, ?, 'basic', 'basic', ?, ?, '', datetime('now'), datetime('now'))
  `).run(
    `nt-${TEST_USER_ID}`, TEST_USER_ID,
    JSON.stringify([{ name: 'Front' }, { name: 'Back' }]),
    JSON.stringify([{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }])
  );
});

// ─── Brief Generation ──────────────────────────────────────────────────────

describe('generateBrief', () => {
  it('returns a structured brief with all expected fields', () => {
    const brief = generateBrief(TEST_USER_ID);

    expect(brief).toHaveProperty('date');
    expect(brief).toHaveProperty('summary');
    expect(brief).toHaveProperty('topPriority');
    expect(brief).toHaveProperty('actions');
    expect(brief).toHaveProperty('studyPlan');
    expect(brief).toHaveProperty('stats');
    expect(brief).toHaveProperty('recommendations');
    expect(Array.isArray(brief.actions)).toBe(true);
    expect(Array.isArray(brief.recommendations)).toBe(true);
    expect(typeof brief.summary).toBe('string');
    expect(brief.stats).toHaveProperty('totalCards');
    expect(brief.stats).toHaveProperty('overdueCards');
    expect(brief.stats).toHaveProperty('draftsPending');
    expect(brief.stats).toHaveProperty('subjectsAtRisk');
    expect(brief.stats).toHaveProperty('avgRetrievability');
  });

  it('emits copilot_brief_generated audit event', () => {
    generateBrief(TEST_USER_ID);

    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'copilot_brief_generated' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { payload: string } | undefined;

    expect(evt).toBeDefined();
    const payload = JSON.parse(evt!.payload);
    expect(payload).toHaveProperty('date');
    expect(payload).toHaveProperty('actionsCount');
  });
});

// ─── Actions ───────────────────────────────────────────────────────────────

describe('getActions', () => {
  it('returns an array of structured actions', () => {
    const actions = getActions(TEST_USER_ID);

    expect(Array.isArray(actions)).toBe(true);
    for (const a of actions) {
      expect(a).toHaveProperty('id');
      expect(a).toHaveProperty('actionType');
      expect(a).toHaveProperty('title');
      expect(a).toHaveProperty('description');
      expect(a).toHaveProperty('reason');
      expect(a).toHaveProperty('scope');
      expect(a).toHaveProperty('estimatedMinutes');
      expect(a).toHaveProperty('urgency');
      expect(a).toHaveProperty('expectedImpact');
      expect(['low', 'medium', 'high', 'critical']).toContain(a.urgency);
    }
  });

  it('emits copilot_action_suggested audit event', () => {
    getActions(TEST_USER_ID);

    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'copilot_action_suggested' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { payload: string } | undefined;

    expect(evt).toBeDefined();
  });
});

// ─── Draft Creation ────────────────────────────────────────────────────────

describe('createDrafts', () => {
  it('creates pending drafts', () => {
    const result = createDrafts(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'D1', Back: 'A1' }, reason: 'test', sourceActionId: 'action-seed-1' },
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'D2', Back: 'A2' }, tags: ['tag1'] },
    ]);

    expect(result.created).toBe(2);
    expect(result.drafts.length).toBe(2);
    expect(result.drafts[0].status).toBe('pending');
    expect(result.drafts[0].reason).toBe('test');
    expect(result.drafts[0].sourceActionId).toBe('action-seed-1');
    expect(result.drafts[1].tags).toContain('tag1');
  });

  it('skips invalid drafts (empty fields)', () => {
    const result = createDrafts(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TestDeck', fields: {} },
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Valid', Back: 'Yes' } },
    ]);

    expect(result.created).toBe(1);
  });

  it('emits copilot_draft_created audit event', () => {
    createDrafts(TEST_USER_ID, [
      { noteType: 'basic', deck: 'AuditDeck', fields: { Front: 'Audit', Back: 'Test' } },
    ]);

    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'copilot_draft_created' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { payload: string } | undefined;

    expect(evt).toBeDefined();
    expect(JSON.parse(evt!.payload).count).toBeGreaterThanOrEqual(1);
  });

  it('stores canonical academic metadata and source assets for OpenClaw drafts', () => {
    const result = createDrafts(TEST_USER_ID, [
      {
        noteType: 'basic',
        deck: 'Anatomia::Pares craneales',
        fields: { Front: '¿Qué par inerva el recto lateral?', Back: 'VI (abducens)' },
        subject: 'Anatomia',
        module: 'Neuroanatomia',
        chapter: 'Pares craneales',
        topic: 'Motor ocular',
        reason: 'OpenClaw chapter ingest',
        sourceActionId: 'openclaw-action-1',
        externalId: 'openclaw-ext-1',
        duplicateKey: 'openclaw-dup-1',
        sourceMetadata: {
          importSource: 'openclaw',
          ingestionId: 'ing-openclaw-1',
          model: 'openclaw-v1',
          promptVersion: '2026-03-12',
        },
        sourceAssets: [
          {
            kind: 'image',
            name: 'pares-craneales-p12.png',
            mimeType: 'image/png',
            pageNumber: 12,
            sourceUrl: 'https://openclaw.test/assets/pares-craneales-p12.png',
          },
        ],
      },
    ], 'openclaw');

    expect(result.created).toBe(1);
    expect(result.drafts[0].sourceMetadata.importSource).toBe('openclaw');
    expect(result.drafts[0].sourceAssets).toHaveLength(1);

    const row = sqlite.prepare(`
      SELECT source_metadata, source_assets
      FROM copilot_drafts
      WHERE id = ?
    `).get(result.drafts[0].id) as { source_metadata: string; source_assets: string };

    const metadata = JSON.parse(row.source_metadata) as {
      importSource?: string;
      ingestionId?: string;
      sourceActionId?: string;
      academic?: { subject?: string; chapter?: string };
    };
    const assets = JSON.parse(row.source_assets) as Array<{ name?: string; pageNumber?: number }>;

    expect(metadata.importSource).toBe('openclaw');
    expect(metadata.ingestionId).toBe('ing-openclaw-1');
    expect(metadata.sourceActionId).toBe('openclaw-action-1');
    expect(metadata.academic?.subject).toBe('Anatomia');
    expect(metadata.academic?.chapter).toBe('Pares craneales');
    expect(assets[0]?.name).toBe('pares-craneales-p12.png');
    expect(assets[0]?.pageNumber).toBe(12);
  });
});

// ─── getDrafts ─────────────────────────────────────────────────────────────

describe('getDrafts', () => {
  it('returns all drafts for user', () => {
    const drafts = getDrafts(TEST_USER_ID);
    expect(Array.isArray(drafts)).toBe(true);
    expect(drafts.length).toBeGreaterThanOrEqual(3); // from previous tests
    for (const d of drafts) {
      expect(d).toHaveProperty('id');
      expect(d).toHaveProperty('status');
      expect(d).toHaveProperty('noteType');
      expect(d).toHaveProperty('fields');
      expect(d.userId).toBe(TEST_USER_ID);
    }
  });

  it('filters by status', () => {
    const pending = getDrafts(TEST_USER_ID, 'pending');
    for (const d of pending) {
      expect(d.status).toBe('pending');
    }
  });
});

// ─── Draft Review ──────────────────────────────────────────────────────────

describe('reviewDrafts', () => {
  let draftIdApprove: string;
  let draftIdReject: string;
  let draftIdEdit: string;

  beforeAll(() => {
    const result = createDrafts(TEST_USER_ID, [
      { noteType: 'basic', deck: 'ReviewDeck', fields: { Front: 'Approve Me', Back: 'Yes' } },
      { noteType: 'basic', deck: 'ReviewDeck', fields: { Front: 'Reject Me', Back: 'No' } },
      { noteType: 'basic', deck: 'ReviewDeck', fields: { Front: 'Edit Me', Back: 'Maybe' } },
    ], 'test-agent');
    draftIdApprove = result.drafts[0].id;
    draftIdReject = result.drafts[1].id;
    draftIdEdit = result.drafts[2].id;
  });

  it('approves a draft and imports it', async () => {
    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: draftIdApprove, action: 'approve', comment: 'Looks good' },
    ]);

    expect(result.reviewed).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(0);

    // Verify draft status changed
    const draft = sqlite.prepare(
      `SELECT status, imported_note_id, source_action_id FROM copilot_drafts WHERE id = ?`
    ).get(draftIdApprove) as { status: string; imported_note_id: string | null; source_action_id: string | null };
    expect(draft.status).toBe('imported');
    expect(draft.imported_note_id).toBeTruthy();
    expect(draft.source_action_id).toBe(draftIdApprove);

    // Verify a note was actually created
    const note = sqlite.prepare(
      `SELECT id, source_metadata FROM notes WHERE id = ?`
    ).get(draft.imported_note_id) as { id: string; source_metadata: string } | undefined;
    expect(note).toBeDefined();
    const metadata = JSON.parse(note!.source_metadata);
    expect(metadata.draftId).toBe(draftIdApprove);
    expect(metadata.sourceActionId).toBe(draftIdApprove);
  });

  it('rejects a draft without importing', async () => {
    const notesBefore = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;

    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: draftIdReject, action: 'reject', comment: 'Not useful' },
    ]);

    expect(result.reviewed).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.imported).toBe(0);

    const notesAfter = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;
    expect(notesAfter).toBe(notesBefore);

    const draft = sqlite.prepare(`SELECT status, reviewer_comment FROM copilot_drafts WHERE id = ?`).get(draftIdReject) as { status: string; reviewer_comment: string };
    expect(draft.status).toBe('rejected');
    expect(draft.reviewer_comment).toBe('Not useful');
  });

  it('edits a draft fields without importing', async () => {
    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: draftIdEdit, action: 'edit', editedFields: { Front: 'Edited Front', Back: 'Edited Back' }, comment: 'Fixed typo' },
    ]);

    expect(result.reviewed).toBe(1);
    expect(result.edited).toBe(1);
    expect(result.imported).toBe(0);

    const draft = sqlite.prepare(`SELECT status, fields FROM copilot_drafts WHERE id = ?`).get(draftIdEdit) as { status: string; fields: string };
    expect(draft.status).toBe('edited');
    expect(JSON.parse(draft.fields).Front).toBe('Edited Front');
  });

  it('can approve an edited draft', async () => {
    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: draftIdEdit, action: 'approve' },
    ]);

    expect(result.imported).toBe(1);

    const draft = sqlite.prepare(`SELECT status FROM copilot_drafts WHERE id = ?`).get(draftIdEdit) as { status: string };
    expect(draft.status).toBe('imported');
  });

  it('rejects review of already-imported draft', async () => {
    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: draftIdApprove, action: 'approve' },
    ]);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain('already');
  });

  it('handles not-found draft', async () => {
    const result = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: 'nonexistent-draft-id', action: 'approve' },
    ]);

    expect(result.notFound).toBe(1);
  });

  it('allows retrying approved drafts that failed import before they are imported', async () => {
    const retryNoteType = `retry-basic-${Date.now()}`;
    const retryDraft = createDrafts(TEST_USER_ID, [
      { noteType: retryNoteType, deck: 'RetryDeck', fields: { Front: 'Retry', Back: 'Later' } },
    ], 'retry-agent').drafts[0];

    const firstAttempt = reviewDrafts(TEST_USER_ID, [
      { draftId: retryDraft.id, action: 'approve', comment: 'Approved before note type exists' },
    ]);

    expect(firstAttempt.reviewed).toBe(1);
    expect(firstAttempt.imported).toBe(0);
    expect(firstAttempt.errors[0]?.message).toContain('not found');

    const approvedDraft = sqlite.prepare(
      `SELECT status, imported_note_id FROM copilot_drafts WHERE id = ?`
    ).get(retryDraft.id) as { status: string; imported_note_id: string | null };
    expect(approvedDraft.status).toBe('approved');
    expect(approvedDraft.imported_note_id).toBeNull();

    sqlite.prepare(`
      INSERT INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
      VALUES (?, ?, ?, 'basic', ?, ?, '', datetime('now'), datetime('now'))
    `).run(
      `nt-${retryNoteType}`,
      TEST_USER_ID,
      retryNoteType,
      JSON.stringify([{ name: 'Front', required: true }, { name: 'Back', required: true }]),
      JSON.stringify([{ id: 'tpl-retry-front-back', name: 'Card 1', active: true }])
    );

    let secondAttempt = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: retryDraft.id, action: 'approve', comment: 'Retry after note type creation' },
    ]);

    for (let attempt = 0; attempt < 3 && secondAttempt.imported === 0; attempt++) {
      const message = secondAttempt.errors[0]?.message || '';
      if (!/locked|busy/i.test(message)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      secondAttempt = await reviewDraftsWithRetry(TEST_USER_ID, [
        { draftId: retryDraft.id, action: 'approve', comment: 'Retry after note type creation' },
      ]);
    }

    expect(secondAttempt.reviewed).toBe(1);
    expect(secondAttempt.imported).toBe(1);
    expect(secondAttempt.errors).toHaveLength(0);

    const importedDraft = sqlite.prepare(
      `SELECT status, imported_note_id FROM copilot_drafts WHERE id = ?`
    ).get(retryDraft.id) as { status: string; imported_note_id: string | null };
    expect(importedDraft.status).toBe('imported');
    expect(importedDraft.imported_note_id).toBeTruthy();

    const failureEvent = sqlite.prepare(`
      SELECT payload
      FROM activity_events
      WHERE user_id = ? AND type = 'copilot_draft_import_failed' AND entity_id = ?
      ORDER BY ts DESC
      LIMIT 1
    `).get(TEST_USER_ID, retryDraft.id) as { payload: string } | undefined;
    expect(failureEvent).toBeDefined();
  });

  it('emits copilot_draft_reviewed audit event', () => {
    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'copilot_draft_reviewed' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { payload: string } | undefined;

    expect(evt).toBeDefined();
    const payload = JSON.parse(evt!.payload);
    expect(payload).toHaveProperty('reviewed');
    expect(payload).toHaveProperty('imported');
    expect(payload).toHaveProperty('rejected');
  });

  it('preserves OpenClaw traceability and academic placement after approval', async () => {
    const openClawDraft = createDrafts(TEST_USER_ID, [
      {
        noteType: 'basic',
        deck: 'Histologia::Epitelio',
        fields: { Front: '¿Qué epitelio reviste la tráquea?', Back: 'Pseudoestratificado ciliado' },
        subject: 'Histologia',
        module: 'Respiratorio',
        chapter: 'Epitelio respiratorio',
        topic: 'Tráquea',
        sourceActionId: 'openclaw-action-approval',
        externalId: 'openclaw-ext-approval',
        duplicateKey: 'openclaw-dup-approval',
        sourceMetadata: {
          importSource: 'openclaw',
          ingestionId: 'ing-openclaw-approval',
          provider: 'openclaw',
        },
        sourceAssets: [{ kind: 'image', name: 'trachea-page-8.png', pageNumber: 8 }],
      },
    ], 'openclaw').drafts[0];

    const review = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: openClawDraft.id, action: 'approve', comment: 'Aprobado para importar' },
    ]);

    expect(review.imported).toBe(1);

    const importedDraft = sqlite.prepare(`
      SELECT imported_note_id
      FROM copilot_drafts
      WHERE id = ?
    `).get(openClawDraft.id) as { imported_note_id: string };

    const note = sqlite.prepare(`
      SELECT source_metadata
      FROM notes
      WHERE id = ?
    `).get(importedDraft.imported_note_id) as { source_metadata: string };

    const metadata = JSON.parse(note.source_metadata) as {
      importSource?: string;
      draftId?: string;
      sourceActionId?: string;
      externalId?: string;
      duplicateKey?: string;
      ingestionId?: string;
      sourceAssets?: Array<{ name?: string }>;
      academic?: { subject?: string; module?: string; chapter?: string; topic?: string; aiReviewStatus?: string };
    };

    expect(metadata.importSource).toBe('openclaw');
    expect(metadata.draftId).toBe(openClawDraft.id);
    expect(metadata.sourceActionId).toBe('openclaw-action-approval');
    expect(metadata.externalId).toBe('openclaw-ext-approval');
    expect(metadata.duplicateKey).toBe('openclaw-dup-approval');
    expect(metadata.ingestionId).toBe('ing-openclaw-approval');
    expect(metadata.sourceAssets?.[0]?.name).toBe('trachea-page-8.png');
    expect(metadata.academic?.subject).toBe('Histologia');
    expect(metadata.academic?.module).toBe('Respiratorio');
    expect(metadata.academic?.chapter).toBe('Epitelio respiratorio');
    expect(metadata.academic?.topic).toBe('Tráquea');
    expect(metadata.academic?.aiReviewStatus).toBe('reviewed');
  });

  it('lets OpenClaw improve an existing note without duplicating it', async () => {
    const seedTs = Date.now();
    const originalDeckId = `deck-openclaw-improve-${seedTs}`;
    const targetNoteId = `note-openclaw-improve-${seedTs}`;
    const targetCardId = `card-openclaw-improve-${seedTs}`;

    sqlite.prepare(`
      INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '', 0, 0, '{}', datetime('now'), datetime('now'))
    `).run(originalDeckId, TEST_USER_ID, `Farmacologia::Antibioticos::Base ${seedTs}`);

    sqlite.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, 'hash-openclaw-improve', 0, datetime('now'), datetime('now'))
    `).run(
      targetNoteId,
      TEST_USER_ID,
      originalDeckId,
      `nt-${TEST_USER_ID}`,
      JSON.stringify({ Front: 'Penicilina G', Back: 'Antibiótico beta-lactámico' }),
      JSON.stringify(['farmaco']),
      JSON.stringify({ academic: { subject: 'Farmacologia', chapter: 'Antibioticos', aiReviewStatus: 'pending-review' } }),
    );

    sqlite.prepare(`
      INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, created_at, updated_at)
      VALUES (?, ?, ?, 'tpl-phase6-improve', ?, datetime('now'), 'new', datetime('now'), datetime('now'))
    `).run(targetCardId, TEST_USER_ID, targetNoteId, originalDeckId);

    const notesBefore = (sqlite.prepare(`SELECT COUNT(*) as c FROM notes WHERE user_id = ?`).get(TEST_USER_ID) as { c: number }).c;

    const proposalBatch = createOpenClawImprovementDrafts(TEST_USER_ID, [
      {
        targetNoteId,
        targetCardIds: [targetCardId],
        deck: `Farmacologia::Beta-lactamicos::Refinado ${seedTs}`,
        fields: {
          Front: '¿Qué clase de antibiótico es la penicilina G?',
          Back: 'Un antibiótico beta-lactámico sensible a penicilinasa.',
        },
        tags: ['farmaco', 'beta-lactamicos', 'penicilinas'],
        subject: 'Farmacologia',
        module: 'Antimicrobianos',
        chapter: 'Beta-lactamicos',
        topic: 'Penicilinas',
        aiReviewStatus: 'reviewed',
        recommendationSummary: 'Separar clasificación del detalle clínico y corregir el capítulo.',
        confidence: 0.94,
      },
    ], 'openclaw');

    expect(proposalBatch.created).toBe(1);
    expect(proposalBatch.notFound).toHaveLength(0);
    expect(proposalBatch.drafts[0].sourceMetadata.draftMode).toBe('improve-existing');
    expect(proposalBatch.drafts[0].sourceMetadata.targetNoteId).toBe(targetNoteId);

    const review = await reviewDraftsWithRetry(TEST_USER_ID, [
      { draftId: proposalBatch.drafts[0].id, action: 'approve', comment: 'Aplicar mejora sugerida' },
    ]);

    expect(review.reviewed).toBe(1);
    expect(review.imported).toBe(1);
    expect(review.updatedExisting).toBe(1);
    expect(review.errors).toHaveLength(0);

    const notesAfter = (sqlite.prepare(`SELECT COUNT(*) as c FROM notes WHERE user_id = ?`).get(TEST_USER_ID) as { c: number }).c;
    expect(notesAfter).toBe(notesBefore);

    const updatedNote = sqlite.prepare(`
      SELECT n.field_values, n.tags, n.source_metadata, d.name as deck_name
      FROM notes n
      JOIN decks d ON d.id = n.deck_id
      WHERE n.id = ?
    `).get(targetNoteId) as {
      field_values: string;
      tags: string;
      source_metadata: string;
      deck_name: string;
    };

    const updatedFields = JSON.parse(updatedNote.field_values) as { Front?: string; Back?: string };
    const updatedTags = JSON.parse(updatedNote.tags) as string[];
    const updatedMetadata = JSON.parse(updatedNote.source_metadata) as {
      academic?: { module?: string; chapter?: string; topic?: string; aiReviewStatus?: string };
      lastImprovement?: { draftId?: string; sourceActionId?: string; confidence?: number };
    };

    expect(updatedFields.Front).toContain('penicilina G');
    expect(updatedTags).toContain('beta-lactamicos');
    expect(updatedNote.deck_name).toContain('Beta-lactamicos::Refinado');
    expect(updatedMetadata.academic?.module).toBe('Antimicrobianos');
    expect(updatedMetadata.academic?.chapter).toBe('Beta-lactamicos');
    expect(updatedMetadata.academic?.topic).toBe('Penicilinas');
    expect(updatedMetadata.academic?.aiReviewStatus).toBe('reviewed');
    expect(updatedMetadata.lastImprovement?.draftId).toBe(proposalBatch.drafts[0].id);
    expect(updatedMetadata.lastImprovement?.sourceActionId).toBe(proposalBatch.drafts[0].id);
    expect(updatedMetadata.lastImprovement?.confidence).toBe(0.94);

    const updatedDraft = sqlite.prepare(`
      SELECT status, imported_note_id
      FROM copilot_drafts
      WHERE id = ?
    `).get(proposalBatch.drafts[0].id) as { status: string; imported_note_id: string | null };
    expect(updatedDraft.status).toBe('imported');
    expect(updatedDraft.imported_note_id).toBe(targetNoteId);

    const updatedCard = sqlite.prepare(`
      SELECT c.deck_id, d.name as deck_name
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      WHERE c.id = ?
    `).get(targetCardId) as { deck_id: string; deck_name: string };
    expect(updatedCard.deck_name).toContain('Beta-lactamicos::Refinado');
  });
});

describe('OpenClaw review candidates', () => {
  it('surfaces notes that need cleanup or better classification', () => {
    const seedTs = Date.now();
    const deckId = `deck-openclaw-candidate-${seedTs}`;
    const noteId = `note-openclaw-candidate-${seedTs}`;
    const cardId = `card-openclaw-candidate-${seedTs}`;

    sqlite.prepare(`
      INSERT INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
      VALUES (?, ?, ?, '', 0, 0, '{}', datetime('now'), datetime('now'))
    `).run(deckId, TEST_USER_ID, `OpenClaw::Review ${seedTs}`);

    sqlite.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source, source_metadata, hash, suspended, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', 'manual', ?, 'hash-openclaw-candidate', 0, datetime('now'), datetime('now'))
    `).run(
      noteId,
      TEST_USER_ID,
      deckId,
      `nt-${TEST_USER_ID}`,
      JSON.stringify({ Front: 'Describe la neumonía adquirida en la comunidad', Back: 'Respuesta extensa '.repeat(30) }),
      JSON.stringify({ academic: { aiReviewStatus: 'pending-review' } }),
    );

    sqlite.prepare(`
      INSERT INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, lapses, created_at, updated_at)
      VALUES (?, ?, ?, 'tpl-phase6-candidate', ?, datetime('now', '-1 day'), 'review', 2, datetime('now'), datetime('now'))
    `).run(cardId, TEST_USER_ID, noteId, deckId);

    const candidates = getOpenClawReviewCandidates(TEST_USER_ID, { noteId, mode: 'needs-attention' });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].noteId).toBe(noteId);
    expect(candidates[0].issues).toEqual(expect.arrayContaining([
      'missing_subject',
      'missing_module',
      'missing_chapter',
      'missing_topic',
      'pending_ai_review',
      'missing_tags',
      'missing_curriculum_link',
      'long_answer',
    ]));
    expect(candidates[0].stats.overdueCards).toBe(1);
    expect(candidates[0].stats.reviewCards).toBe(1);
  });
});

// ─── Outcome Recording ────────────────────────────────────────────────────

describe('recordOutcome', () => {
  it('records an outcome with all fields', () => {
    const outcome = recordOutcome(TEST_USER_ID, {
      recommendationId: 'rec-123',
      actionType: 'rescue_session',
      actionTaken: true,
      executedAt: new Date().toISOString(),
      resultSummary: 'Completed rescue of 5 cards',
      cardsStudied: 5,
      riskDelta: -0.15,
      masteryDelta: 0.05,
    });

    expect(outcome.id).toBeDefined();
    expect(outcome.actionType).toBe('rescue_session');
    expect(outcome.actionTaken).toBe(true);
    expect(outcome.cardsStudied).toBe(5);
    expect(outcome.riskDelta).toBe(-0.15);

    // Verify persisted in DB
    const row = sqlite.prepare(`SELECT * FROM copilot_outcomes WHERE id = ?`).get(outcome.id) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.action_type).toBe('rescue_session');
    expect(row.action_taken).toBe(1);
  });

  it('records a dismissed outcome', () => {
    const outcome = recordOutcome(TEST_USER_ID, {
      actionType: 'study_overdue',
      actionTaken: false,
      userDismissed: true,
      resultSummary: 'User skipped',
    });

    expect(outcome.userDismissed).toBe(true);
    expect(outcome.actionTaken).toBe(false);
  });

  it('emits copilot_outcome_recorded audit event', () => {
    recordOutcome(TEST_USER_ID, {
      actionType: 'test_outcome',
      actionTaken: true,
    });

    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'copilot_outcome_recorded' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { payload: string } | undefined;

    expect(evt).toBeDefined();
    const payload = JSON.parse(evt!.payload);
    expect(payload.actionType).toBe('test_outcome');
    expect(payload.actionTaken).toBe(true);
  });
});

// ─── Copilot History ───────────────────────────────────────────────────────

describe('getCopilotHistory', () => {
  it('returns copilot events only', () => {
    const history = getCopilotHistory(TEST_USER_ID);

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    for (const evt of history) {
      expect(evt.type).toMatch(/^copilot_/);
      expect(evt).toHaveProperty('ts');
      expect(evt).toHaveProperty('payload');
    }
  });

  it('respects limit parameter', () => {
    const history = getCopilotHistory(TEST_USER_ID, 2);
    expect(history.length).toBeLessThanOrEqual(2);
  });

  it('contains events from all copilot operations', () => {
    const history = getCopilotHistory(TEST_USER_ID, 100);
    const types = new Set(history.map(e => e.type));

    expect(types.has('copilot_brief_generated')).toBe(true);
    expect(types.has('copilot_action_suggested')).toBe(true);
    expect(types.has('copilot_draft_created')).toBe(true);
    expect(types.has('copilot_draft_approved')).toBe(true);
    expect(types.has('copilot_draft_import_failed')).toBe(true);
    expect(types.has('copilot_draft_imported')).toBe(true);
    expect(types.has('copilot_draft_reviewed')).toBe(true);
    expect(types.has('copilot_outcome_recorded')).toBe(true);
  });
});

// ─── Import only after approval (integration) ─────────────────────────────

describe('human-in-the-loop import guard', () => {
  it('draft cards do NOT create notes until approved', async () => {
    const notesBefore = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;

    // Create drafts — should NOT create notes
    const { drafts } = createDrafts(TEST_USER_ID, [
      { noteType: 'basic', deck: 'GuardTest', fields: { Front: `Guard-${Date.now()}`, Back: 'Test' } },
    ]);

    const notesAfterDraft = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;
    expect(notesAfterDraft).toBe(notesBefore);

    // Approve — NOW it should create a note
    await reviewDraftsWithRetry(TEST_USER_ID, [{ draftId: drafts[0].id, action: 'approve' }]);

    const notesAfterApprove = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;
    expect(notesAfterApprove).toBe(notesBefore + 1);
  });
});
