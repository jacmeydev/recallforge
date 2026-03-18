// ============================================================================
// RecallForge — Gamification Service
// ============================================================================
// XP system, streak tracking, achievements, anti-burnout.
// All tied to REAL learning metrics — no vanity points.
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now, today } from '@/lib/utils';
import { calculateRetrievability, isOverdue } from '@/lib/fsrs';
import { emitEvent } from '@/lib/events';
import type {
  XPEntry,
  XPSource,
  UserGamification,
  Achievement,
  Card,
  JSONObject,
} from '@/types';

// ─── XP Constants ─────────────────────────────────────────────────────────

const XP_REVIEW_BASE = 5;
const XP_HIGH_RISK_BONUS = 15;      // R < 0.5 recovered
const XP_OVERDUE_BONUS = 10;        // overdue > 7 days resolved
const XP_SESSION_ACCURACY_BONUS = 20; // session accuracy ≥ 85%
const XP_RESCUE_SESSION = 25;       // completed a rescue session
const XP_TRIVIAL_PENALTY = 0.3;     // multiplier for very easy cards (stability > 90d, R > 0.95)

const LEVEL_BASE = 100;             // XP for level 1
const LEVEL_EXPONENT = 1.5;         // xpForLevel(n) = LEVEL_BASE * n^LEVEL_EXPONENT

const DEFAULT_DAILY_GOAL = 10;      // min reviews to keep streak
const MAX_STREAK_FREEZES = 3;

// ─── Level calculation ────────────────────────────────────────────────────

export function xpForLevel(level: number): number {
  return Math.floor(LEVEL_BASE * Math.pow(level, LEVEL_EXPONENT));
}

export function levelFromXP(totalXP: number): number {
  let level = 1;
  let cumulative = 0;
  while (true) {
    const needed = xpForLevel(level);
    if (cumulative + needed > totalXP) break;
    cumulative += needed;
    level++;
  }
  return level;
}

export function xpProgressInLevel(totalXP: number): { current: number; needed: number } {
  let level = 1;
  let cumulative = 0;
  while (true) {
    const needed = xpForLevel(level);
    if (cumulative + needed > totalXP) {
      return { current: totalXP - cumulative, needed };
    }
    cumulative += needed;
    level++;
  }
}

// ─── Get or create user gamification record ───────────────────────────────

export async function getGamification(userId: string): Promise<UserGamification> {
  const existing = await db.userGamification
    .where('userId')
    .equals(userId)
    .first();

  if (existing) return existing;

  const record: UserGamification = {
    id: generateId(),
    userId,
    totalXP: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    streakFreezes: MAX_STREAK_FREEZES,
    lastStudyDate: '',
    streakFrozenToday: false,
    dailyGoal: DEFAULT_DAILY_GOAL,
    easyDayMultiplier: 0.5,
    achievements: [],
    updatedAt: now(),
  };

  await db.userGamification.add(record);
  return record;
}

// ─── Award XP ─────────────────────────────────────────────────────────────

export async function awardXP(
  userId: string,
  amount: number,
  source: XPSource,
  reason: string,
  entityId?: string
): Promise<XPEntry> {
  const entry: XPEntry = {
    id: generateId(),
    userId,
    amount: Math.round(amount),
    source,
    reason,
    entityId,
    ts: now(),
  };

  await db.xpLedger.add(entry);

  // Update gamification totals
  const gam = await getGamification(userId);
  const newTotal = gam.totalXP + entry.amount;
  const newLevel = levelFromXP(newTotal);

  await db.userGamification.update(gam.id, {
    totalXP: newTotal,
    level: newLevel,
    updatedAt: now(),
  });

  await emitEvent(userId, 'xp_earned', 'gamification', entry.id, {
    amount: entry.amount,
    source,
    reason,
    totalXP: newTotal,
    level: newLevel,
  });

  return entry;
}

// ─── XP for a card review (called from study flow) ────────────────────────

export async function awardReviewXP(
  userId: string,
  card: Card,
  rating: string,
  sessionAccuracy?: number
): Promise<number> {
  let totalAwarded = 0;

  // Base XP for any review
  let baseXP = XP_REVIEW_BASE;

  // Reduce XP for trivially easy cards (anti-spam)
  const r = calculateRetrievability(card);
  if (card.stability > 90 && r > 0.95) {
    baseXP = Math.round(baseXP * XP_TRIVIAL_PENALTY);
  }

  // No XP for pressing Again on new cards (no learning happened)
  if (card.state === 'new' && rating === 'again') {
    baseXP = 0;
  }

  if (baseXP > 0) {
    await awardXP(userId, baseXP, 'review_card', 'Revisión de tarjeta', card.id);
    totalAwarded += baseXP;
  }

  // High-risk recovery bonus
  if (r < 0.5 && (rating === 'good' || rating === 'easy')) {
    await awardXP(userId, XP_HIGH_RISK_BONUS, 'high_risk_recovered', 'Tarjeta de alto riesgo recuperada', card.id);
    totalAwarded += XP_HIGH_RISK_BONUS;
  }

  // Overdue bonus
  if (isOverdue(card)) {
    const dueDate = new Date(card.dueAt);
    const overdueDays = (Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24);
    if (overdueDays > 7 && (rating === 'good' || rating === 'easy')) {
      await awardXP(userId, XP_OVERDUE_BONUS, 'overdue_resolved', `Tarjeta atrasada ${Math.round(overdueDays)}d resuelta`, card.id);
      totalAwarded += XP_OVERDUE_BONUS;
    }
  }

  return totalAwarded;
}

// ─── Session accuracy bonus ───────────────────────────────────────────────

export async function awardSessionBonus(
  userId: string,
  sessionId: string,
  accuracy: number,
  cardsStudied: number
): Promise<number> {
  // Minimum 10 cards to qualify for accuracy bonus
  if (cardsStudied >= 10 && accuracy >= 0.85) {
    const entry = await awardXP(
      userId,
      XP_SESSION_ACCURACY_BONUS,
      'session_accuracy_bonus',
      `Sesión con ${Math.round(accuracy * 100)}% precisión`,
      sessionId
    );
    return entry.amount;
  }
  return 0;
}

// ─── Streak management ───────────────────────────────────────────────────

export async function updateStreak(userId: string, reviewsDone: number): Promise<{
  streak: number;
  froze: boolean;
  lost: boolean;
  milestone?: number;
}> {
  const gam = await getGamification(userId);
  const todayStr = today();
  const result = { streak: gam.currentStreak, froze: false, lost: false, milestone: undefined as number | undefined };

  // Already counted today
  if (gam.lastStudyDate === todayStr) {
    return result;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Check if we met the goal (considers easy day multiplier)
  const effectiveGoal = gam.dailyGoal; // normal day

  if (reviewsDone >= effectiveGoal) {
    // Met the goal — continue or start streak
    if (gam.lastStudyDate === yesterdayStr || gam.currentStreak === 0) {
      result.streak = gam.currentStreak + 1;
    } else {
      // Missed days — check freeze
      if (gam.streakFreezes > 0 && !gam.streakFrozenToday) {
        result.streak = gam.currentStreak + 1;
        result.froze = true;
        await db.userGamification.update(gam.id, {
          streakFreezes: gam.streakFreezes - 1,
          streakFrozenToday: true,
        });
      } else {
        result.streak = 1; // reset
        result.lost = true;
      }
    }
  } else if (gam.lastStudyDate !== yesterdayStr && gam.currentStreak > 0) {
    // Didn't study enough and missed yesterday
    if (gam.streakFreezes > 0) {
      result.froze = true;
      await db.userGamification.update(gam.id, {
        streakFreezes: gam.streakFreezes - 1,
      });
    } else {
      result.streak = 0;
      result.lost = true;
    }
    return result;
  } else {
    return result;
  }

  // Check milestones
  const milestones = [7, 14, 30, 50, 100, 200, 365];
  const hit = milestones.find(m => result.streak === m);
  if (hit) {
    result.milestone = hit;
    const xp = hit * 2; // 14 XP for 7d, 60 XP for 30d, 200 XP for 100d, etc.
    await awardXP(userId, xp, 'streak_milestone', `¡Racha de ${hit} días!`);
    await emitEvent(userId, 'streak_milestone', 'gamification', gam.id, {
      streak: hit,
      xpAwarded: xp,
    });
  }

  // Update record
  const longestStreak = Math.max(gam.longestStreak, result.streak);
  await db.userGamification.update(gam.id, {
    currentStreak: result.streak,
    longestStreak,
    lastStudyDate: todayStr,
    streakFrozenToday: false,
    updatedAt: now(),
  });

  return result;
}

// ─── Set daily goal (anti-burnout: flexible goals) ────────────────────────

export async function setDailyGoal(userId: string, goal: number): Promise<void> {
  const gam = await getGamification(userId);
  await db.userGamification.update(gam.id, {
    dailyGoal: Math.max(1, Math.min(100, goal)),
    updatedAt: now(),
  });
}

// ─── Grant streak freeze (earned or purchased) ───────────────────────────

export async function grantStreakFreeze(userId: string, count: number = 1): Promise<void> {
  const gam = await getGamification(userId);
  await db.userGamification.update(gam.id, {
    streakFreezes: Math.min(gam.streakFreezes + count, MAX_STREAK_FREEZES * 2),
    updatedAt: now(),
  });
}

// ─── XP history ───────────────────────────────────────────────────────────

export async function getXPHistory(
  userId: string,
  days: number = 30
): Promise<{ date: string; xp: number }[]> {
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString();

  const entries = await db.xpLedger
    .where('[userId+ts]')
    .between([userId, startStr], [userId, '\uffff'])
    .toArray();

  const dayMap = new Map<string, number>();
  for (const e of entries) {
    const date = e.ts.split('T')[0];
    dayMap.set(date, (dayMap.get(date) || 0) + e.amount);
  }

  const result: { date: string; xp: number }[] = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    result.push({ date: dateStr, xp: dayMap.get(dateStr) || 0 });
  }

  return result;
}

// ─── Achievements ─────────────────────────────────────────────────────────

export const ACHIEVEMENTS: Achievement[] = [
  // Streak
  { id: 'streak_7', name: 'Primera Semana', description: 'Racha de 7 días', icon: '🔥', category: 'streak', condition: 'streak >= 7', xpReward: 14 },
  { id: 'streak_30', name: 'Mes Completo', description: 'Racha de 30 días', icon: '🔥', category: 'streak', condition: 'streak >= 30', xpReward: 60 },
  { id: 'streak_100', name: 'Centenario', description: 'Racha de 100 días', icon: '💯', category: 'streak', condition: 'streak >= 100', xpReward: 200 },
  { id: 'streak_365', name: 'Un Año Completo', description: 'Racha de 365 días', icon: '🏆', category: 'streak', condition: 'streak >= 365', xpReward: 730 },

  // Volume
  { id: 'reviews_100', name: 'Primer Centenar', description: '100 revisiones totales', icon: '📚', category: 'volume', condition: 'totalReviews >= 100', xpReward: 25 },
  { id: 'reviews_1000', name: 'Millar', description: '1000 revisiones totales', icon: '📖', category: 'volume', condition: 'totalReviews >= 1000', xpReward: 100 },
  { id: 'reviews_10000', name: 'Diez Mil', description: '10,000 revisiones', icon: '🎓', category: 'volume', condition: 'totalReviews >= 10000', xpReward: 500 },

  // Mastery
  { id: 'mastery_deck_80', name: 'Dominio Inicial', description: 'Un mazo con mastery ≥ 80', icon: '⭐', category: 'mastery', condition: 'deckMastery >= 80', xpReward: 50 },
  { id: 'mastery_deck_95', name: 'Maestría Total', description: 'Un mazo con mastery ≥ 95', icon: '🌟', category: 'mastery', condition: 'deckMastery >= 95', xpReward: 150 },
  { id: 'risk_reduced', name: 'Bombero', description: 'Reducir riesgo de olvido en un mazo de alto a bajo', icon: '🧯', category: 'mastery', condition: 'riskReduced', xpReward: 75 },

  // Rescue
  { id: 'first_rescue', name: 'Primer Rescate', description: 'Completar una sesión de rescate', icon: '🚑', category: 'rescue', condition: 'rescueCompleted', xpReward: 25 },
  { id: 'rescue_10', name: 'Rescatista', description: '10 sesiones de rescate completadas', icon: '🛟', category: 'rescue', condition: 'rescueCount >= 10', xpReward: 100 },

  // Academic
  { id: 'subject_mastered', name: 'Materia Dominada', description: 'Mastery ≥ 80 en todos los capítulos de una materia', icon: '🎖️', category: 'academic', condition: 'subjectMastery >= 80', xpReward: 200 },
  { id: 'chapter_perfect', name: 'Capítulo Perfecto', description: 'Retención ≥ 95% en un capítulo', icon: '✅', category: 'academic', condition: 'chapterRetention >= 0.95', xpReward: 50 },
  { id: 'ai_cards_reviewed', name: 'Curador IA', description: 'Revisar 50 tarjetas generadas por IA', icon: '🤖', category: 'academic', condition: 'aiCardsReviewed >= 50', xpReward: 75 },
];

export async function checkAndUnlockAchievements(
  userId: string,
  context: {
    streak?: number;
    totalReviews?: number;
    deckMastery?: number;
    rescueCount?: number;
    aiCardsReviewed?: number;
  }
): Promise<Achievement[]> {
  const gam = await getGamification(userId);
  const unlocked: Achievement[] = [];

  for (const ach of ACHIEVEMENTS) {
    if (gam.achievements.includes(ach.id)) continue;

    let qualifies = false;
    switch (ach.id) {
      case 'streak_7': qualifies = (context.streak || gam.currentStreak) >= 7; break;
      case 'streak_30': qualifies = (context.streak || gam.currentStreak) >= 30; break;
      case 'streak_100': qualifies = (context.streak || gam.currentStreak) >= 100; break;
      case 'streak_365': qualifies = (context.streak || gam.currentStreak) >= 365; break;
      case 'reviews_100': qualifies = (context.totalReviews || 0) >= 100; break;
      case 'reviews_1000': qualifies = (context.totalReviews || 0) >= 1000; break;
      case 'reviews_10000': qualifies = (context.totalReviews || 0) >= 10000; break;
      case 'mastery_deck_80': qualifies = (context.deckMastery || 0) >= 80; break;
      case 'mastery_deck_95': qualifies = (context.deckMastery || 0) >= 95; break;
      case 'first_rescue': qualifies = (context.rescueCount || 0) >= 1; break;
      case 'rescue_10': qualifies = (context.rescueCount || 0) >= 10; break;
      case 'ai_cards_reviewed': qualifies = (context.aiCardsReviewed || 0) >= 50; break;
    }

    if (qualifies) {
      gam.achievements.push(ach.id);
      await awardXP(userId, ach.xpReward, 'quest_completed', `Logro: ${ach.name}`);
      await emitEvent(userId, 'achievement_unlocked', 'gamification', gam.id, {
        achievementId: ach.id,
        name: ach.name,
        xpReward: ach.xpReward,
      });
      unlocked.push(ach);
    }
  }

  if (unlocked.length > 0) {
    await db.userGamification.update(gam.id, {
      achievements: gam.achievements,
      updatedAt: now(),
    });
  }

  return unlocked;
}

// ─── Today's XP ───────────────────────────────────────────────────────────

export async function getTodayXP(userId: string): Promise<number> {
  const todayStr = today();
  const startOfDay = `${todayStr}T00:00:00.000Z`;

  const entries = await db.xpLedger
    .where('[userId+ts]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .toArray();

  return entries.reduce((sum, e) => sum + e.amount, 0);
}
