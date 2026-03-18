import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CreateProgramSchema,
  CreateSubjectSchema,
  CreateModuleSchema,
  CreateChapterSchema,
  CreateTopicSchema,
  CreateCurriculumLinkSchema,
} from '@/lib/validation/schemas';

// ─── Curriculum Schemas ───────────────────────────────────────────────────

describe('CreateProgramSchema', () => {
  it('accepts valid program data', () => {
    const result = CreateProgramSchema.safeParse({ name: 'Medicina 2025' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateProgramSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 chars', () => {
    const result = CreateProgramSchema.safeParse({ name: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe('CreateSubjectSchema', () => {
  it('accepts valid subject', () => {
    const result = CreateSubjectSchema.safeParse({
      name: 'Anatomía',
      programId: 'prog-12345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing programId', () => {
    const result = CreateSubjectSchema.safeParse({ name: 'Anatomía' });
    expect(result.success).toBe(false);
  });
});

describe('CreateModuleSchema', () => {
  it('accepts valid module', () => {
    const result = CreateModuleSchema.safeParse({
      name: 'Módulo I',
      subjectId: 'subj-12345678',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateChapterSchema', () => {
  it('accepts valid chapter', () => {
    const result = CreateChapterSchema.safeParse({
      name: 'Osteología',
      moduleId: 'mod-12345678',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateTopicSchema', () => {
  it('accepts valid topic', () => {
    const result = CreateTopicSchema.safeParse({
      name: 'Huesos del cráneo',
      chapterId: 'chap-12345678',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateCurriculumLinkSchema', () => {
  it('accepts valid link with noteId and topicId', () => {
    const result = CreateCurriculumLinkSchema.safeParse({
      noteId: 'note-12345678',
      topicId: 'topic-12345678',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid link with deckId and subjectId', () => {
    const result = CreateCurriculumLinkSchema.safeParse({
      deckId: 'deck-12345678',
      subjectId: 'subj-12345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects link without any entity ref', () => {
    const result = CreateCurriculumLinkSchema.safeParse({
      topicId: 'topic-12345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects link without any curriculum node', () => {
    const result = CreateCurriculumLinkSchema.safeParse({
      noteId: 'note-12345678',
    });
    expect(result.success).toBe(false);
  });
});

// ─── AI Import Priority/Difficulty Schemas ────────────────────────────────

describe('AIImportOptionsSchema — academic options', () => {
  it('accepts academic options', async () => {
    const { AIImportOptionsSchema } = await import('@/lib/validation/ai-import-schema');
    const result = AIImportOptionsSchema.safeParse({
      defaultPriority: 'high',
      defaultConceptualDifficulty: 'hard',
      autoCreateCurriculum: true,
      defaultProgram: 'Medicina 2025',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultPriority).toBe('high');
      expect(result.data.defaultConceptualDifficulty).toBe('hard');
      expect(result.data.autoCreateCurriculum).toBe(true);
      expect(result.data.defaultProgram).toBe('Medicina 2025');
    }
  });

  it('rejects invalid priority', async () => {
    const { AIImportOptionsSchema } = await import('@/lib/validation/ai-import-schema');
    const result = AIImportOptionsSchema.safeParse({
      defaultPriority: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid difficulty', async () => {
    const { AIImportOptionsSchema } = await import('@/lib/validation/ai-import-schema');
    const result = AIImportOptionsSchema.safeParse({
      defaultConceptualDifficulty: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('AIImportItemSchema — priority/difficulty fields', () => {
  it('accepts item with priority and conceptualDifficulty', async () => {
    const { AIImportItemSchema } = await import('@/lib/validation/ai-import-schema');
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Test',
      fields: { Front: 'Q', Back: 'A' },
      priority: 'critical',
      conceptualDifficulty: 'very_hard',
      program: 'Medicina 2025',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('critical');
      expect(result.data.conceptualDifficulty).toBe('very_hard');
      expect(result.data.program).toBe('Medicina 2025');
    }
  });

  it('makes priority/difficulty optional', async () => {
    const { AIImportItemSchema } = await import('@/lib/validation/ai-import-schema');
    const result = AIImportItemSchema.safeParse({
      noteType: 'Básica',
      deck: 'Test',
      fields: { Front: 'Q', Back: 'A' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBeUndefined();
      expect(result.data.conceptualDifficulty).toBeUndefined();
    }
  });
});

// ─── StudyScope type checks ───────────────────────────────────────────────

describe('StudyScope type validation', () => {
  it('subject scope has correct shape', () => {
    const scope = { type: 'subject' as const, subjectId: 'subj-123' };
    expect(scope.type).toBe('subject');
    expect(scope.subjectId).toBe('subj-123');
  });

  it('priority scope has correct shape', () => {
    const scope = { type: 'priority' as const, priority: 'high' as const };
    expect(scope.type).toBe('priority');
    expect(scope.priority).toBe('high');
  });

  it('ai_pending scope has correct shape', () => {
    const scope = { type: 'ai_pending' as const };
    expect(scope.type).toBe('ai_pending');
  });
});

// ─── computeProgressFromCards — Pure Logic Tests ──────────────────────────

describe('computeProgressFromCards', () => {
  // Helper to build a minimal Card object
  function makeCard(overrides: Partial<{
    id: string; noteId: string; state: string; suspended: boolean;
    stability: number; lastReviewAt: string; dueAt: string;
  }> = {}): any {
    const now = new Date();
    return {
      id: overrides.id ?? `card-${Math.random().toString(36).slice(2, 10)}`,
      noteId: overrides.noteId ?? 'note-1',
      userId: 'user-1',
      templateId: 'tpl-1',
      deckId: 'deck-1',
      state: overrides.state ?? 'review',
      suspended: overrides.suspended ?? false,
      stability: overrides.stability ?? 30,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      step: null,
      dueAt: overrides.dueAt ?? now.toISOString(),
      lastReviewAt: overrides.lastReviewAt ?? now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  function makeNote(overrides: Partial<{
    id: string; academic: Record<string, unknown>;
  }> = {}): any {
    return {
      id: overrides.id ?? 'note-1',
      userId: 'user-1',
      deckId: 'deck-1',
      noteTypeId: 'nt-1',
      fields: { Front: 'Q', Back: 'A' },
      tags: [],
      sourceMetadata: overrides.academic
        ? { academic: overrides.academic }
        : {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  let computeProgressFromCards: typeof import('@/lib/services/curriculum-service').computeProgressFromCards;

  beforeEach(async () => {
    vi.resetModules();
    // Mock the DB and events so the module can load without real IndexedDB
    vi.doMock('@/lib/db', () => ({ db: {} }));
    vi.doMock('@/lib/events', () => ({ EventEmitters: {} }));
    vi.doMock('@/lib/utils', () => ({
      generateId: () => 'mock-id',
      now: () => new Date().toISOString(),
    }));
    const mod = await import('@/lib/services/curriculum-service');
    computeProgressFromCards = mod.computeProgressFromCards;
  });

  it('returns zeroed progress for empty cards', () => {
    const result = computeProgressFromCards('e1', 'Test Entity', [], [], 0);
    expect(result.totalCards).toBe(0);
    expect(result.masteryScore).toBe(0);
    expect(result.coverage).toBe(0);
    expect(result.avgRetrievability).toBe(0);
    expect(result.entityId).toBe('e1');
    expect(result.entityName).toBe('Test Entity');
  });

  it('excludes suspended cards from all calculations', () => {
    const cards = [
      makeCard({ state: 'review', suspended: true }),
      makeCard({ state: 'review', suspended: true }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    expect(result.totalCards).toBe(0);
    expect(result.masteryScore).toBe(0);
  });

  it('counts new cards correctly', () => {
    const cards = [
      makeCard({ id: 'c1', state: 'new' }),
      makeCard({ id: 'c2', state: 'new' }),
      makeCard({ id: 'c3', state: 'review', stability: 30 }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 2);
    expect(result.totalCards).toBe(3);
    expect(result.newCards).toBe(2);
    expect(result.childCount).toBe(2);
  });

  it('calculates coverage as ratio of non-new to total', () => {
    const cards = [
      makeCard({ id: 'c1', state: 'new' }),
      makeCard({ id: 'c2', state: 'review', stability: 30 }),
      makeCard({ id: 'c3', state: 'learning', stability: 5 }),
      makeCard({ id: 'c4', state: 'review', stability: 10 }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    // 3 non-new out of 4 total = 0.75
    expect(result.coverage).toBe(0.75);
  });

  it('identifies mature cards (state=review, stability>=21)', () => {
    const now = new Date();
    const cards = [
      makeCard({ id: 'c1', state: 'review', stability: 21, lastReviewAt: now.toISOString() }),
      makeCard({ id: 'c2', state: 'review', stability: 50, lastReviewAt: now.toISOString() }),
      makeCard({ id: 'c3', state: 'review', stability: 10, lastReviewAt: now.toISOString() }),
      makeCard({ id: 'c4', state: 'learning', stability: 30, lastReviewAt: now.toISOString() }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    expect(result.matureCards).toBe(2);
  });

  it('counts overdue cards (non-new with dueAt in the past)', () => {
    const past = new Date(Date.now() - 86400000 * 2).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const cards = [
      makeCard({ id: 'c1', state: 'review', dueAt: past }),
      makeCard({ id: 'c2', state: 'review', dueAt: future }),
      makeCard({ id: 'c3', state: 'new', dueAt: past }), // new cards don't count as overdue
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    expect(result.overdueCards).toBe(1);
  });

  it('detects high-priority pending cards', () => {
    const notes = [
      makeNote({ id: 'n1', academic: { priority: 'high' } }),
      makeNote({ id: 'n2', academic: { priority: 'critical' } }),
      makeNote({ id: 'n3', academic: { priority: 'low' } }),
    ];
    const cards = [
      makeCard({ id: 'c1', noteId: 'n1', state: 'new' }), // high + new → pending
      makeCard({ id: 'c2', noteId: 'n2', state: 'new' }), // critical + new → pending
      makeCard({ id: 'c3', noteId: 'n3', state: 'new' }), // low → not pending
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, notes, 0);
    expect(result.highPriorityPending).toBe(2);
  });

  it('detects AI pending-review cards', () => {
    const notes = [
      makeNote({ id: 'n1', academic: { aiReviewStatus: 'pending-review' } }),
      makeNote({ id: 'n2', academic: { aiReviewStatus: 'reviewed' } }),
    ];
    const cards = [
      makeCard({ id: 'c1', noteId: 'n1' }),
      makeCard({ id: 'c2', noteId: 'n2' }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, notes, 0);
    expect(result.aiPendingReview).toBe(1);
  });

  it('mastery score formula: perfect cards → high score', () => {
    // Cards with high retrievability (just reviewed, high stability)
    const now = new Date();
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({
        id: `c${i}`,
        state: 'review',
        stability: 50,
        lastReviewAt: now.toISOString(),
      })
    );
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    // All non-new, high R, all mature → high score
    expect(result.masteryScore).toBeGreaterThanOrEqual(80);
    expect(result.coverage).toBe(1);
    expect(result.matureCards).toBe(10);
    expect(result.riskCards).toBe(0);
  });

  it('mastery score: all new cards → score based on formula with zero coverage', () => {
    const cards = [
      makeCard({ id: 'c1', state: 'new' }),
      makeCard({ id: 'c2', state: 'new' }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    // avgR=0, coverage=0, maturity=0, riskRatio=0 (nonNew=0)
    // score = 0*40 + 0*25 + 0*20 + (1-0)*15 = 15
    expect(result.masteryScore).toBe(15);
    expect(result.avgRetrievability).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('rounds coverage and avgRetrievability to 2 decimal places', () => {
    const now = new Date();
    const cards = [
      makeCard({ id: 'c1', state: 'new' }),
      makeCard({ id: 'c2', state: 'review', stability: 30, lastReviewAt: now.toISOString() }),
      makeCard({ id: 'c3', state: 'review', stability: 30, lastReviewAt: now.toISOString() }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    // coverage = 2/3 ≈ 0.67
    expect(result.coverage).toBe(0.67);
    // avgRetrievability should also be rounded
    expect(typeof result.avgRetrievability).toBe('number');
    const decimalPlaces = result.avgRetrievability.toString().split('.')[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });

  it('mastery score is clamped between 0 and 100', () => {
    const now = new Date();
    // Many perfect cards
    const cards = Array.from({ length: 100 }, (_, i) =>
      makeCard({
        id: `c${i}`,
        state: 'review',
        stability: 100,
        lastReviewAt: now.toISOString(),
      })
    );
    const result = computeProgressFromCards('e1', 'Entity', cards, [], 0);
    expect(result.masteryScore).toBeLessThanOrEqual(100);
    expect(result.masteryScore).toBeGreaterThanOrEqual(0);
  });

  it('mixed: suspended + new + review + learning', () => {
    const now = new Date();
    const pastDay = new Date(Date.now() - 86400000 * 10).toISOString();
    const cards = [
      makeCard({ id: 'c1', state: 'review', stability: 25, suspended: true }), // excluded
      makeCard({ id: 'c2', state: 'new' }),
      makeCard({ id: 'c3', state: 'review', stability: 30, lastReviewAt: now.toISOString() }),
      makeCard({ id: 'c4', state: 'learning', stability: 2, lastReviewAt: pastDay }),
      makeCard({ id: 'c5', state: 'review', stability: 1, lastReviewAt: pastDay }), // low R → risk
    ];
    const notes = [
      makeNote({ id: 'note-1', academic: { priority: 'critical' } }),
    ];
    const result = computeProgressFromCards('e1', 'Entity', cards, notes, 3);
    expect(result.totalCards).toBe(4); // excludes suspended
    expect(result.newCards).toBe(1);
    expect(result.childCount).toBe(3);
    expect(result.masteryScore).toBeGreaterThan(0);
    expect(result.masteryScore).toBeLessThanOrEqual(100);
  });
});

// ─── calculateRetrievability — Regression Tests ──────────────────────────

describe('calculateRetrievability', () => {
  let calculateRetrievability: typeof import('@/lib/fsrs').calculateRetrievability;

  beforeEach(async () => {
    vi.resetModules();
    const { calculateRetrievability: cr } = await import('@/lib/fsrs');
    calculateRetrievability = cr;
  });

  it('returns 0 for new cards', () => {
    const card: any = { state: 'new', stability: 10, lastReviewAt: new Date().toISOString() };
    expect(calculateRetrievability(card)).toBe(0);
  });

  it('returns 0 for stability <= 0', () => {
    const card: any = { state: 'review', stability: 0, lastReviewAt: new Date().toISOString() };
    expect(calculateRetrievability(card)).toBe(0);
  });

  it('returns 1 for just-reviewed card', () => {
    const now = new Date();
    const card: any = { state: 'review', stability: 30, lastReviewAt: now.toISOString(), dueAt: now.toISOString() };
    expect(calculateRetrievability(card, now)).toBe(1);
  });

  it('returns value between 0 and 1 for normal card', () => {
    const past = new Date(Date.now() - 86400000 * 5);
    const card: any = { state: 'review', stability: 30, lastReviewAt: past.toISOString(), dueAt: past.toISOString() };
    const r = calculateRetrievability(card);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });

  it('decreases as more time elapses', () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 86400000 * 5);
    const tenDaysAgo = new Date(now.getTime() - 86400000 * 10);
    const card5: any = { state: 'review', stability: 20, lastReviewAt: fiveDaysAgo.toISOString(), dueAt: fiveDaysAgo.toISOString() };
    const card10: any = { state: 'review', stability: 20, lastReviewAt: tenDaysAgo.toISOString(), dueAt: tenDaysAgo.toISOString() };
    const r5 = calculateRetrievability(card5, now);
    const r10 = calculateRetrievability(card10, now);
    expect(r5).toBeGreaterThan(r10);
  });

  it('higher stability → higher retrievability at same elapsed time', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000 * 10);
    const cardLow: any = { state: 'review', stability: 10, lastReviewAt: past.toISOString(), dueAt: past.toISOString() };
    const cardHigh: any = { state: 'review', stability: 50, lastReviewAt: past.toISOString(), dueAt: past.toISOString() };
    const rLow = calculateRetrievability(cardLow, now);
    const rHigh = calculateRetrievability(cardHigh, now);
    expect(rHigh).toBeGreaterThan(rLow);
  });
});
