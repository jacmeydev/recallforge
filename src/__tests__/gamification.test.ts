import { describe, it, expect } from 'vitest';
import {
  xpForLevel,
  levelFromXP,
  xpProgressInLevel,
  ACHIEVEMENTS,
} from '@/lib/services/gamification-service';
import { getAcademicMeta } from '@/lib/services/mastery-service';
import {
  AIImportItemSchema,
  AIImportOptionsSchema,
} from '@/lib/validation/ai-import-schema';

// ============================================================================
// Gamification — Level Calculation Tests
// ============================================================================

describe('xpForLevel', () => {
  it('returns base XP for level 1', () => {
    // xpForLevel(1) = floor(100 * 1^1.5) = 100
    expect(xpForLevel(1)).toBe(100);
  });

  it('returns correct XP for level 2', () => {
    // xpForLevel(2) = floor(100 * 2^1.5) = floor(282.84) = 282
    expect(xpForLevel(2)).toBe(282);
  });

  it('returns correct XP for level 5', () => {
    // xpForLevel(5) = floor(100 * 5^1.5) = floor(1118.03) = 1118
    expect(xpForLevel(5)).toBe(1118);
  });

  it('returns correct XP for level 10', () => {
    // xpForLevel(10) = floor(100 * 10^1.5) = floor(3162.27) = 3162
    expect(xpForLevel(10)).toBe(3162);
  });

  it('scales non-linearly', () => {
    expect(xpForLevel(5)).toBeGreaterThan(xpForLevel(4));
    expect(xpForLevel(10)).toBeGreaterThan(2 * xpForLevel(5));
  });
});

describe('levelFromXP', () => {
  it('returns level 1 for 0 XP', () => {
    expect(levelFromXP(0)).toBe(1);
  });

  it('returns level 1 for 99 XP (just under threshold)', () => {
    expect(levelFromXP(99)).toBe(1);
  });

  it('returns level 2 for exactly 100 XP', () => {
    expect(levelFromXP(100)).toBe(2);
  });

  it('returns level 2 for 381 XP (100 for L1, but not enough for L2 cost)', () => {
    // Need 100 XP for level 1, then 282 for level 2, total 382
    expect(levelFromXP(381)).toBe(2);
  });

  it('returns level 3 for 382 XP', () => {
    expect(levelFromXP(382)).toBe(3);
  });

  it('increases monotonically', () => {
    let prev = levelFromXP(0);
    for (let xp = 100; xp <= 10000; xp += 100) {
      const level = levelFromXP(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('handles large XP values', () => {
    expect(levelFromXP(1000000)).toBeGreaterThan(20);
  });
});

describe('xpProgressInLevel', () => {
  it('returns full needed for level 1 at 0 XP', () => {
    const result = xpProgressInLevel(0);
    expect(result.current).toBe(0);
    expect(result.needed).toBe(100);
  });

  it('shows progress within level 1', () => {
    const result = xpProgressInLevel(50);
    expect(result.current).toBe(50);
    expect(result.needed).toBe(100);
  });

  it('resets current after leveling up', () => {
    // 100 XP completes level 1, should show 0 progress into level 2
    const result = xpProgressInLevel(100);
    expect(result.current).toBe(0);
    expect(result.needed).toBe(282); // xpForLevel(2)
  });

  it('shows partial progress in level 2', () => {
    const result = xpProgressInLevel(200);
    expect(result.current).toBe(100);
    expect(result.needed).toBe(282);
  });

  it('current is always less than needed', () => {
    for (const xp of [0, 50, 99, 100, 150, 382, 500, 1000, 5000]) {
      const result = xpProgressInLevel(xp);
      expect(result.current).toBeLessThan(result.needed);
    }
  });
});

// ============================================================================
// Achievements Structure Tests
// ============================================================================

describe('ACHIEVEMENTS', () => {
  it('has 15 achievements', () => {
    expect(ACHIEVEMENTS).toHaveLength(15);
  });

  it('all achievements have required fields', () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.id).toBeTruthy();
      expect(ach.name).toBeTruthy();
      expect(ach.description).toBeTruthy();
      expect(ach.icon).toBeTruthy();
      expect(ach.category).toBeTruthy();
      expect(ach.condition).toBeTruthy();
      expect(ach.xpReward).toBeGreaterThan(0);
    }
  });

  it('has unique IDs', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all expected categories', () => {
    const categories = new Set(ACHIEVEMENTS.map((a) => a.category));
    expect(categories).toContain('streak');
    expect(categories).toContain('volume');
    expect(categories).toContain('mastery');
    expect(categories).toContain('rescue');
    expect(categories).toContain('academic');
  });

  it('has streak achievements in ascending order', () => {
    const streakAch = ACHIEVEMENTS.filter((a) => a.category === 'streak');
    expect(streakAch.length).toBeGreaterThanOrEqual(3);
    // XP rewards should increase with difficulty
    for (let i = 1; i < streakAch.length; i++) {
      expect(streakAch[i].xpReward).toBeGreaterThan(streakAch[i - 1].xpReward);
    }
  });
});

// ============================================================================
// Academic Meta Tests
// ============================================================================

describe('getAcademicMeta', () => {
  it('returns empty object for undefined metadata', () => {
    const result = getAcademicMeta(undefined);
    expect(result).toEqual({});
  });

  it('returns empty object for empty metadata', () => {
    const result = getAcademicMeta({});
    expect(result).toEqual({
      subject: undefined,
      module: undefined,
      chapter: undefined,
      topic: undefined,
      subtopic: undefined,
      lectureDate: undefined,
      professor: undefined,
      sourcePage: undefined,
      book: undefined,
      className: undefined,
      examScope: undefined,
      aiGenerated: undefined,
      aiReviewStatus: undefined,
    });
  });

  it('extracts subject and chapter', () => {
    const result = getAcademicMeta({
      subject: 'Anatomía',
      chapter: 'Capítulo 4',
    });
    expect(result.subject).toBe('Anatomía');
    expect(result.chapter).toBe('Capítulo 4');
  });

  it('extracts all academic fields', () => {
    const meta = {
      subject: 'Cardiología',
      module: 'Sistema Cardiovascular',
      chapter: 'Arritmias',
      topic: 'Fibrilación Auricular',
      subtopic: 'Tratamiento Farmacológico',
      lectureDate: '2025-03-15',
      professor: 'Dr. García',
      sourcePage: '42',
      book: 'Harrison',
      className: 'Medicina Interna',
      examScope: 'Parcial 2',
      aiGenerated: true,
      aiReviewStatus: 'reviewed',
    };
    const result = getAcademicMeta(meta);
    expect(result).toEqual(meta);
  });

  it('handles aiGenerated boolean correctly', () => {
    expect(getAcademicMeta({ aiGenerated: true }).aiGenerated).toBe(true);
    expect(getAcademicMeta({ aiGenerated: false }).aiGenerated).toBe(false);
  });

  it('handles aiReviewStatus enum values', () => {
    expect(getAcademicMeta({ aiReviewStatus: 'pending-review' }).aiReviewStatus).toBe('pending-review');
    expect(getAcademicMeta({ aiReviewStatus: 'reviewed' }).aiReviewStatus).toBe('reviewed');
    expect(getAcademicMeta({ aiReviewStatus: 'corrected' }).aiReviewStatus).toBe('corrected');
  });
});

// ============================================================================
// Academic Schema Extension Tests
// ============================================================================

describe('AIImportItemSchema — academic fields', () => {
  const validBase = {
    noteType: 'Básica',
    deck: 'Medicina/Cardiología',
    fields: { Front: 'What is AF?', Back: 'Atrial Fibrillation' },
  };

  it('accepts item with academic fields', () => {
    const result = AIImportItemSchema.safeParse({
      ...validBase,
      subject: 'Cardiología',
      module: 'Sistema Cardiovascular',
      chapter: 'Arritmias',
      topic: 'Fibrilación Auricular',
      subtopic: 'Diagnóstico',
      examScope: 'Parcial 2',
      professor: 'Dr. García',
      book: 'Harrison 21ed',
      lectureDate: '2025-03-15',
      aiGenerated: true,
      aiReviewStatus: 'pending-review',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subject).toBe('Cardiología');
      expect(result.data.aiGenerated).toBe(true);
      expect(result.data.aiReviewStatus).toBe('pending-review');
    }
  });

  it('accepts item without academic fields (all optional)', () => {
    const result = AIImportItemSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('accepts valid aiReviewStatus values', () => {
    for (const status of ['pending-review', 'reviewed', 'corrected']) {
      const result = AIImportItemSchema.safeParse({
        ...validBase,
        aiReviewStatus: status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid aiReviewStatus', () => {
    const result = AIImportItemSchema.safeParse({
      ...validBase,
      aiReviewStatus: 'invalid-status',
    });
    expect(result.success).toBe(false);
  });

  it('accepts aiGenerated as boolean', () => {
    const result = AIImportItemSchema.safeParse({
      ...validBase,
      aiGenerated: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiGenerated).toBe(false);
    }
  });
});

describe('AIImportOptionsSchema — academic fields', () => {
  it('accepts academic default fields', () => {
    const result = AIImportOptionsSchema.safeParse({
      defaultSubject: 'Anatomía',
      defaultModule: 'Aparato Locomotor',
      defaultChapter: 'Miembros Superiores',
      autoCreateDecks: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultSubject).toBe('Anatomía');
      expect(result.data.defaultModule).toBe('Aparato Locomotor');
      expect(result.data.defaultChapter).toBe('Miembros Superiores');
      expect(result.data.autoCreateDecks).toBe(true);
    }
  });

  it('defaults autoCreateDecks to true', () => {
    const result = AIImportOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoCreateDecks).toBe(true);
    }
  });

  it('accepts without academic fields', () => {
    const result = AIImportOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultSubject).toBeUndefined();
      expect(result.data.defaultModule).toBeUndefined();
      expect(result.data.defaultChapter).toBeUndefined();
    }
  });
});
