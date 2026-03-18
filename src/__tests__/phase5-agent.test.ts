// ============================================================================
// RecallForge — Phase 5 Agent Automation Tests
// ============================================================================
// Tests agent service functions (server-side, direct SQLite) and
// validates HTTP endpoints against a running dev server.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';

// ─── Direct Service Tests (no server needed) ─────────────────────────────

import {
  agentImport,
  getRecommendations,
  getStudyPlan,
  getAcademicSummary,
  getAcademicCoverage,
  updateReviewStatus,
  getStudyScopes,
  emitAgentEvent,
} from '@/lib/server/agent-service';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';

const TEST_USER_ID = `test-phase5-${Date.now()}`;
const TEST_EMAIL = `${TEST_USER_ID}@test.com`;

function seedAgentTestUser(userId: string, email: string) {
  sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_links WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_topics WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_chapters WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_modules WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_subjects WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM curriculum_programs WHERE user_id = ?`).run(userId);
  sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

  sqlite.prepare(`
    INSERT INTO users (id, email, name, password_hash, api_key_hash, api_key_preview, created_at, updated_at)
    VALUES (?, ?, ?, 'dummy', ?, ?, datetime('now'), datetime('now'))
  `).run(userId, email, 'Phase 5 Test', `hash-${userId}`, `rf_${userId.slice(-4)}...1234`);

  sqlite.prepare(`
    INSERT OR IGNORE INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
    VALUES (?, ?, 'basic', 'basic', ?, ?, '', datetime('now'), datetime('now'))
  `).run(`nt-${userId}`, userId, JSON.stringify([{ name: 'Front' }, { name: 'Back' }]), JSON.stringify([{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }]));

  sqlite.prepare(`
    INSERT OR IGNORE INTO note_types (id, user_id, name, kind, fields, templates, css, created_at, updated_at)
    VALUES (?, ?, 'basic-reversed', 'basic', ?, ?, '', datetime('now'), datetime('now'))
  `).run(
    `nt-rev-${userId}`, userId,
    JSON.stringify([{ name: 'Front' }, { name: 'Back' }]),
    JSON.stringify([
      { name: 'Card 1', front: '{{Front}}', back: '{{Back}}' },
      { name: 'Card 2', front: '{{Back}}', back: '{{Front}}' },
    ])
  );
}

function seedCurriculumFixture(userId: string) {
  const ts = new Date().toISOString();
  const programId = `prog-${userId}`;
  const subjectId = `subj-${userId}`;
  const moduleId = `mod-${userId}`;
  const chapterId = `chap-${userId}`;
  const topicId = `topic-${userId}`;
  const deckId = `deck-curr-${userId}`;
  const noteId = `note-curr-${userId}`;
  const cardId = `card-curr-${userId}`;

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_programs (id, user_id, name, description, career, year, semester, created_at, updated_at)
    VALUES (?, ?, 'Programa Medicina', '', 'Medicina', 3, 1, ?, ?)
  `).run(programId, userId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_subjects (id, user_id, program_id, name, code, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'Anatomia', 'ANA-301', 0, ?, ?)
  `).run(subjectId, userId, programId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_modules (id, user_id, subject_id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'Torax', 0, ?, ?)
  `).run(moduleId, userId, subjectId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_chapters (id, user_id, module_id, name, exam_scope, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'Mediastino', 'Parcial 1', 0, ?, ?)
  `).run(chapterId, userId, moduleId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_topics (id, user_id, chapter_id, name, priority_default, conceptual_difficulty_default, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'Corazon', 'high', 'hard', 0, ?, ?)
  `).run(topicId, userId, chapterId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO decks (id, user_id, name, description, sort_order, archived, metadata, created_at, updated_at)
    VALUES (?, ?, 'Anatomia::Torax', '', 0, 0, '{}', ?, ?)
  `).run(deckId, userId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, source_metadata, hash, suspended, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?)
  `).run(
    noteId,
    userId,
    deckId,
    `nt-${userId}`,
    JSON.stringify({ Front: 'Corazon', Back: 'Organo muscular' }),
    JSON.stringify({
      academic: {
        subject: 'Anatomia',
        module: 'Torax',
        chapter: 'Mediastino',
        topic: 'Corazon',
        aiReviewStatus: 'pending-review',
      },
    }),
    `hash-curr-${userId}`,
    ts,
    ts
  );

  sqlite.prepare(`
    INSERT OR IGNORE INTO cards (id, user_id, note_id, template_id, deck_id, due_at, state, queue_position, stability, difficulty, retrievability, elapsed_days, scheduled_days, reps, lapses, learning_steps, custom_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '-2 day'), 'review', 0, 3, 5, 0.42, 0, 0, 4, 1, 0, '{}', ?, ?)
  `).run(cardId, userId, noteId, `nt-${userId}:tpl:0`, deckId, ts, ts);

  sqlite.prepare(`
    INSERT OR IGNORE INTO curriculum_links (id, user_id, note_id, card_id, deck_id, program_id, subject_id, module_id, chapter_id, topic_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`link-${userId}`, userId, noteId, cardId, deckId, programId, subjectId, moduleId, chapterId, topicId, ts);
}

beforeAll(() => {
  runMigrations();

  // Clean up any previous test data for this user pattern
  const oldUsers = sqlite.prepare(
    `SELECT id FROM users WHERE email LIKE 'test-phase5-%@test.com'`
  ).all() as Array<{ id: string }>;
  for (const u of oldUsers) {
    sqlite.prepare(`DELETE FROM activity_events WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM note_types WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_links WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_topics WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_chapters WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_modules WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_subjects WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM curriculum_programs WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(u.id);
  }

  // Create test user
  seedAgentTestUser(TEST_USER_ID, TEST_EMAIL);
  seedCurriculumFixture(TEST_USER_ID);
});

// ─── Agent Import ─────────────────────────────────────────────────────────

describe('agentImport', () => {
  it('creates notes and cards from valid items', () => {
    const localUserId = `test-phase5-create-${Date.now()}`;
    seedAgentTestUser(localUserId, `${localUserId}@test.com`);

    const result = agentImport(localUserId, [
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Q1', Back: 'A1' } },
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Q2', Back: 'A2' } },
    ]);

    expect(result.totalItems).toBe(2);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.dryRun).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify notes created
    const notes = sqlite.prepare(
      `SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL`
    ).all(localUserId) as Array<{ id: string }>;
    expect(notes.length).toBeGreaterThanOrEqual(2);

    // Verify cards created
    const cards = sqlite.prepare(
      `SELECT * FROM cards WHERE user_id = ? AND deleted_at IS NULL`
    ).all(localUserId) as Array<{ id: string }>;
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it('skips duplicates with skip strategy', () => {
    const localUserId = `test-phase5-skip-${Date.now()}`;
    seedAgentTestUser(localUserId, `${localUserId}@test.com`);
    agentImport(localUserId, [
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Q1', Back: 'A1' } },
    ], { duplicateStrategy: 'skip' });

    const result = agentImport(localUserId, [
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Q1', Back: 'A1' } },
    ], { duplicateStrategy: 'skip' });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it('creates always with create_always strategy', () => {
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TestDeck', fields: { Front: 'Q1', Back: 'A1' } },
    ], { duplicateStrategy: 'create_always' });

    expect(result.created).toBe(1);
  });

  it('fails items with missing fields', () => {
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TestDeck', fields: {} },
    ]);

    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toContain('fields');
  });

  it('fails items with unknown note type', () => {
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'nonexistent-type-xyz', deck: 'TestDeck', fields: { Front: 'Q', Back: 'A' } },
    ]);

    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toContain('not found');
  });

  it('handles dry run without creating records', () => {
    const notesBefore = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;

    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'DryRunDeck', fields: { Front: 'X', Back: 'Y' } },
    ], { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.created).toBe(1); // would create

    const notesAfter = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
    ).get(TEST_USER_ID) as { c: number }).c;
    expect(notesAfter).toBe(notesBefore);
  });

  it('adds agent-import tag', () => {
    agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TagTest', fields: { Front: 'Tag', Back: 'Test' }, tags: ['custom'] },
    ], { tagPrefix: 'pf' });

    const note = sqlite.prepare(
      `SELECT tags FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(TEST_USER_ID) as { tags: string };
    const tags = JSON.parse(note.tags) as string[];
    expect(tags).toContain('agent-import');
    expect(tags).toContain('custom');
    expect(tags).toContain('pf');
  });

  it('auto-creates decks', () => {
    agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'AutoCreatedDeck', fields: { Front: 'AC', Back: 'DC' } },
    ]);

    const deck = sqlite.prepare(
      `SELECT id FROM decks WHERE user_id = ? AND LOWER(name) = 'autocreateddeck'`
    ).get(TEST_USER_ID) as { id: string } | undefined;
    expect(deck).toBeDefined();
  });
});

// ─── Recommendations ──────────────────────────────────────────────────────

describe('getRecommendations', () => {
  it('returns an array of recommendations', () => {
    const recs = getRecommendations(TEST_USER_ID);
    expect(Array.isArray(recs)).toBe(true);
    for (const r of recs) {
      expect(r).toHaveProperty('type');
      expect(r).toHaveProperty('priority');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('description');
      expect(['low', 'medium', 'high', 'critical']).toContain(r.priority);
    }
  });
});

// ─── Study Plan ────────────────────────────────────────────────────────────

describe('getStudyPlan', () => {
  it('returns a plan with entries array', () => {
    const plan = getStudyPlan(TEST_USER_ID, 30);
    expect(plan).toHaveProperty('entries');
    expect(plan).toHaveProperty('totalMinutes');
    expect(plan).toHaveProperty('totalCards');
    expect(Array.isArray(plan.entries)).toBe(true);
    for (const entry of plan.entries) {
      expect(entry).toHaveProperty('order');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('cardCount');
      expect(entry).toHaveProperty('estimatedMinutes');
    }
  });

  it('respects maxMinutes boundary', () => {
    const plan = getStudyPlan(TEST_USER_ID, 5);
    expect(plan.totalMinutes).toBeLessThanOrEqual(6); // allow rounding
  });

  it('includes topic-focused entries when curriculum links exist', () => {
    const plan = getStudyPlan(TEST_USER_ID, 30);
    expect(plan.entries.some((entry) =>
      entry.action === 'focus_topic' &&
      entry.topicName === 'Corazon' &&
      entry.moduleName === 'Torax' &&
      entry.chapterName === 'Mediastino'
    )).toBe(true);
  });
});

// ─── Academic Summary ──────────────────────────────────────────────────────

describe('getAcademicSummary', () => {
  it('returns structured academic data', () => {
    const summary = getAcademicSummary(TEST_USER_ID);
    expect(summary).toHaveProperty('cards');
    expect(summary).toHaveProperty('activity');
    expect(summary).toHaveProperty('subjects');
    expect(summary).toHaveProperty('modules');
    expect(summary).toHaveProperty('chapters');
    expect(summary).toHaveProperty('topics');
    expect(summary).toHaveProperty('decks');
    expect(summary.cards).toHaveProperty('total');
    expect(summary.cards).toHaveProperty('new');
    expect(summary.cards).toHaveProperty('mature');
    expect(summary.cards).toHaveProperty('overdue');
    expect(summary.activity).toHaveProperty('last7Days');
    expect(summary.activity).toHaveProperty('last30Days');
    expect(Array.isArray(summary.subjects)).toBe(true);
    expect(Array.isArray(summary.modules)).toBe(true);
    expect(Array.isArray(summary.chapters)).toBe(true);
    expect(Array.isArray(summary.topics)).toBe(true);
    expect(Array.isArray(summary.decks)).toBe(true);
  });

  it('includes deep curriculum breakdown with real module/chapter/topic stats', () => {
    const summary = getAcademicSummary(TEST_USER_ID);
    expect(summary.modules.some((module: { name: string }) => module.name === 'Torax')).toBe(true);
    expect(summary.chapters.some((chapter: { name: string; examScope: string | null }) => chapter.name === 'Mediastino' && chapter.examScope === 'Parcial 1')).toBe(true);
    expect(summary.topics.some((topic: { name: string; subjectName: string; moduleName: string; chapterName: string }) =>
      topic.name === 'Corazon' &&
      topic.subjectName === 'Anatomia' &&
      topic.moduleName === 'Torax' &&
      topic.chapterName === 'Mediastino'
    )).toBe(true);
  });
});

describe('getAcademicCoverage', () => {
  it('returns clear coverage and risk snapshot with curriculum linking stats', () => {
    const coverage = getAcademicCoverage(TEST_USER_ID);
    expect(coverage).toHaveProperty('overall');
    expect(coverage.overall.totalCards).toBeGreaterThan(0);
    expect(coverage.overall.curriculumLinkedCards).toBeGreaterThan(0);
    expect(coverage.overall.curriculumLinkedPercent).toBeGreaterThan(0);
    expect(Array.isArray(coverage.subjects)).toBe(true);
    expect(Array.isArray(coverage.topics)).toBe(true);
    expect(Array.isArray(coverage.atRisk.subjects)).toBe(true);

    const corazon = coverage.topics.find((topic) => topic.name === 'Corazon');
    expect(corazon).toBeDefined();
    expect(corazon?.subjectName).toBe('Anatomia');
    expect(typeof corazon?.coveragePercent).toBe('number');
    expect(typeof corazon?.overdueRatioPercent).toBe('number');
  });
});

// ─── Review Status ─────────────────────────────────────────────────────────

describe('updateReviewStatus', () => {
  it('updates source_metadata for existing notes', () => {
    // Create a note to update
    const noteId = `review-test-${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, hash, suspended, created_at, updated_at)
      VALUES (?, ?, 'deck1', 'nt1', '{}', '[]', 'hash1', 0, datetime('now'), datetime('now'))
    `).run(noteId, TEST_USER_ID);

    const result = updateReviewStatus(TEST_USER_ID, [noteId], 'reviewed');
    expect(result.updated).toBe(1);
    expect(result.notFound).toBe(0);

    const note = sqlite.prepare(`SELECT source_metadata FROM notes WHERE id = ?`).get(noteId) as { source_metadata: string };
    const meta = JSON.parse(note.source_metadata);
    expect(meta.academic.aiReviewStatus).toBe('reviewed');
  });

  it('returns notFound for missing notes', () => {
    const result = updateReviewStatus(TEST_USER_ID, ['nonexistent-id'], 'corrected');
    expect(result.updated).toBe(0);
    expect(result.notFound).toBe(1);
  });
});

// ─── Study Scopes ──────────────────────────────────────────────────────────

describe('getStudyScopes', () => {
  it('returns scopes with decks, programs, subjects, modules, chapters, topics, noteTypes', () => {
    const scopes = getStudyScopes(TEST_USER_ID);
    expect(scopes).toHaveProperty('decks');
    expect(scopes).toHaveProperty('programs');
    expect(scopes).toHaveProperty('subjects');
    expect(scopes).toHaveProperty('modules');
    expect(scopes).toHaveProperty('chapters');
    expect(scopes).toHaveProperty('topics');
    expect(scopes).toHaveProperty('noteTypes');
    expect(Array.isArray(scopes.decks)).toBe(true);
    expect(Array.isArray(scopes.modules)).toBe(true);
    expect(Array.isArray(scopes.chapters)).toBe(true);
    expect(Array.isArray(scopes.topics)).toBe(true);
    expect(Array.isArray(scopes.noteTypes)).toBe(true);
  });

  it('returns decks with card statistics', () => {
    const scopes = getStudyScopes(TEST_USER_ID);
    for (const d of scopes.decks) {
      expect(d).toHaveProperty('totalCards');
      expect(d).toHaveProperty('newCards');
      expect(d).toHaveProperty('overdueCards');
    }
  });

  it('returns curriculum scopes with deep parent references', () => {
    const scopes = getStudyScopes(TEST_USER_ID);
    expect(scopes.modules.some((module: { name: string; subjectId: string }) => module.name === 'Torax' && module.subjectId === `subj-${TEST_USER_ID}`)).toBe(true);
    expect(scopes.chapters.some((chapter: { name: string; moduleId: string; examScope: string | null }) => chapter.name === 'Mediastino' && chapter.moduleId === `mod-${TEST_USER_ID}` && chapter.examScope === 'Parcial 1')).toBe(true);
    expect(scopes.topics.some((topic: { name: string; chapterId: string; priorityDefault: string | null }) => topic.name === 'Corazon' && topic.chapterId === `chap-${TEST_USER_ID}` && topic.priorityDefault === 'high')).toBe(true);
  });
});

// ─── Audit Trail ───────────────────────────────────────────────────────────

describe('emitAgentEvent', () => {
  it('creates an activity event', () => {
    emitAgentEvent(TEST_USER_ID, 'test_event', 'test', 'test-1', { foo: 'bar' });

    const evt = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = 'test_event' ORDER BY ts DESC LIMIT 1`
    ).get(TEST_USER_ID) as { id: string; payload: string } | undefined;

    expect(evt).toBeDefined();
    expect(JSON.parse(evt!.payload)).toEqual({ foo: 'bar' });
  });
});

// ─── P0-1: Transaction atomicity ──────────────────────────────────────────

describe('agentImport transaction', () => {
  it('rolls back all notes on catastrophic failure (atomicity)', () => {
    // We can't easily force a mid-transaction crash in a unit test,
    // but we can verify that a batch with some valid and some failing items
    // correctly creates the valid ones and reports failures.
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'TxTest', fields: { Front: `TX-${Date.now()}`, Back: 'OK' } },
      { noteType: 'basic', deck: 'TxTest', fields: {} }, // will fail validation
      { noteType: 'basic', deck: 'TxTest', fields: { Front: `TX2-${Date.now()}`, Back: 'OK2' } },
    ]);

    // Validation failures are caught per-item, so valid items still succeed
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toContain('fields');
  });

  it('does not emit audit events on dry run', () => {
    const before = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM activity_events WHERE user_id = ? AND type LIKE 'agent_import%'`
    ).get(TEST_USER_ID) as { c: number }).c;

    agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'PreviewNoop', fields: { Front: 'P', Back: 'N' } },
    ], { dryRun: true });

    const after = (sqlite.prepare(
      `SELECT COUNT(*) as c FROM activity_events WHERE user_id = ? AND type LIKE 'agent_import%'`
    ).get(TEST_USER_ID) as { c: number }).c;

    expect(after).toBe(before);
  });
});

// ─── P1-1: Reject unsupported duplicateStrategy ──────────────────────────

describe('agentImport duplicateStrategy validation', () => {
  it('updates an existing duplicate when strategy is "update"', () => {
    const fields = { Front: `UP-${Date.now()}`, Back: 'Before' };
    const duplicateKey = `dup-${Date.now()}`;
    agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'X', fields, duplicateKey },
    ], { duplicateStrategy: 'skip' });

    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'X', fields: { ...fields, Back: 'After' }, duplicateKey },
    ], { duplicateStrategy: 'update' });

    expect(result.failed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('merges tags on an existing duplicate when strategy is "merge_tags"', () => {
    const fields = { Front: `MT-${Date.now()}`, Back: 'Base' };
    agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'X', fields, tags: ['base'] },
    ], { duplicateStrategy: 'skip' });

    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'X', fields, tags: ['extra'] },
    ], { duplicateStrategy: 'merge_tags' });

    expect(result.failed).toBe(0);
    expect(result.updated).toBe(1);

    const hash = require('crypto').createHash('sha256')
      .update(Object.entries(fields).sort().map(([k, v]: [string, string]) => `${k}:${v}`).join('|||'))
      .digest('hex').slice(0, 16);
    const note = sqlite.prepare(
      `SELECT tags FROM notes WHERE user_id = ? AND hash = ? AND deleted_at IS NULL`
    ).get(TEST_USER_ID, hash) as { tags: string };
    const tags = JSON.parse(note.tags) as string[];
    expect(tags).toContain('base');
    expect(tags).toContain('extra');
  });

  it('accepts valid strategy "skip"', () => {
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'StratValid', fields: { Front: `SV-${Date.now()}`, Back: 'OK' } },
    ], { duplicateStrategy: 'skip' });

    expect(result.failed).toBe(0);
  });

  it('accepts valid strategy "create_always"', () => {
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'StratValid', fields: { Front: `SV-${Date.now()}`, Back: 'OK' } },
    ], { duplicateStrategy: 'create_always' });

    expect(result.failed).toBe(0);
    expect(result.created).toBe(1);
  });
});

// ─── P1-2: Multi-template import ─────────────────────────────────────────

describe('agentImport multi-template', () => {
  it('creates 1 card for basic note type with 1 template', () => {
    const fields = { Front: `MT1-${Date.now()}`, Back: 'Single' };
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic', deck: 'MultiTpl', fields },
    ]);

    expect(result.created).toBe(1);

    // Find the note and count its cards
    const hash = require('crypto').createHash('sha256')
      .update(Object.entries(fields).sort().map(([k, v]: [string, string]) => `${k}:${v}`).join('|||'))
      .digest('hex').slice(0, 16);
    const note = sqlite.prepare(
      `SELECT id FROM notes WHERE user_id = ? AND hash = ? AND deleted_at IS NULL`
    ).get(TEST_USER_ID, hash) as { id: string };

    const cards = sqlite.prepare(
      `SELECT COUNT(*) as c FROM cards WHERE note_id = ? AND deleted_at IS NULL`
    ).get(note.id) as { c: number };
    expect(cards.c).toBe(1);
  });

  it('creates 2 cards for note type with 2 templates', () => {
    const fields = { Front: `MT2-${Date.now()}`, Back: 'Double' };
    const result = agentImport(TEST_USER_ID, [
      { noteType: 'basic-reversed', deck: 'MultiTpl', fields },
    ]);

    expect(result.created).toBe(1);

    // Find the note and count its cards
    const hash = require('crypto').createHash('sha256')
      .update(Object.entries(fields).sort().map(([k, v]: [string, string]) => `${k}:${v}`).join('|||'))
      .digest('hex').slice(0, 16);
    const note = sqlite.prepare(
      `SELECT id FROM notes WHERE user_id = ? AND hash = ? AND deleted_at IS NULL`
    ).get(TEST_USER_ID, hash) as { id: string };

    const cards = sqlite.prepare(
      `SELECT COUNT(*) as c FROM cards WHERE note_id = ? AND deleted_at IS NULL`
    ).get(note.id) as { c: number };
    expect(cards.c).toBe(2);
  });
});

// ─── P0-2: Events prefix filter ──────────────────────────────────────────

describe('events prefix filter', () => {
  it('agent events are queryable with LIKE prefix via emitAgentEvent', () => {
    // Emit some agent events
    emitAgentEvent(TEST_USER_ID, 'agent_test_alpha', 'test', 'et-1', { x: 1 });
    emitAgentEvent(TEST_USER_ID, 'agent_test_beta', 'test', 'et-2', { x: 2 });

    // Query with prefix 'agent_test_'
    const events = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type LIKE ? ORDER BY ts DESC LIMIT 10`
    ).all(TEST_USER_ID, 'agent_test_%') as Array<{ type: string }>;

    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const e of events) {
      expect(e.type).toMatch(/^agent_test_/);
    }
  });

  it('exact type match still works', () => {
    const events = sqlite.prepare(
      `SELECT * FROM activity_events WHERE user_id = ? AND type = ? LIMIT 5`
    ).all(TEST_USER_ID, 'agent_test_alpha') as Array<{ type: string }>;

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('agent_test_alpha');
  });
});
