// ============================================================================
// RecallForge — Quest Service
// ============================================================================
// Daily and weekly quests oriented to REAL learning, not engagement farming.
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now, today } from '@/lib/utils';
import { calculateRetrievability } from '@/lib/fsrs';
import { awardXP } from './gamification-service';
import { emitEvent } from '@/lib/events';
import type { Quest, QuestFrequency, Card, JSONObject } from '@/types';

// ─── Quest Templates ──────────────────────────────────────────────────────

interface QuestTemplate {
  id: string;
  name: string;
  description: string;
  frequency: QuestFrequency;
  target: number;
  xpReward: number;
  checker: (userId: string, quest: Quest) => Promise<number>;
}

async function countTodayReviews(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  return db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .count();
}

async function countHighRiskRecovered(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .filter(l => l.rating === 'good' || l.rating === 'easy')
    .toArray();

  let count = 0;
  for (const log of logs) {
    // Check if card had low retrievability before review
    if (log.previousStability < 3 && log.previousState === 'review') {
      count++;
    }
  }
  return count;
}

async function countOverdueResolved(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .toArray();

  let count = 0;
  for (const log of logs) {
    const dueDate = new Date(log.previousDueAt);
    const reviewDate = new Date(log.reviewedAt);
    const overdueDays = (reviewDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24);
    if (overdueDays > 3) count++;
  }
  return count;
}

async function countAICardsReviewed(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .toArray();

  let count = 0;
  for (const log of logs) {
    const card = await db.cards.get(log.cardId);
    if (!card) continue;
    const note = await db.notes.get(card.noteId);
    if (note?.source === 'ai-import' || (note?.sourceMetadata as Record<string, unknown>)?.importSource === 'ai-batch-import') {
      count++;
    }
  }
  return count;
}

async function countWeekReviews(userId: string): Promise<number> {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const startStr = start.toISOString();

  return db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startStr], [userId, '\uffff'])
    .count();
}

async function countFragileStabilized(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .filter(l => (l.rating === 'good' || l.rating === 'easy') && l.previousStability < 7)
    .toArray();

  return logs.filter(l => l.nextStability >= 7).length;
}

async function countHighPriorityReviewed(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .toArray();

  let count = 0;
  for (const log of logs) {
    const card = await db.cards.get(log.cardId);
    if (!card) continue;
    const note = await db.notes.get(card.noteId);
    if (!note) continue;
    const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    if (acad?.priority === 'high' || acad?.priority === 'critical') count++;
  }
  return count;
}

async function countHardTopicsReviewed(userId: string): Promise<number> {
  const startOfDay = `${today()}T00:00:00.000Z`;
  const logs = await db.reviewLogs
    .where('[userId+reviewedAt]')
    .between([userId, startOfDay], [userId, '\uffff'])
    .filter(l => l.rating === 'good' || l.rating === 'easy')
    .toArray();

  let count = 0;
  for (const log of logs) {
    const card = await db.cards.get(log.cardId);
    if (!card) continue;
    const note = await db.notes.get(card.noteId);
    if (!note) continue;
    const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    if (acad?.conceptualDifficulty === 'hard' || acad?.conceptualDifficulty === 'very_hard') count++;
  }
  return count;
}

const DAILY_TEMPLATES: QuestTemplate[] = [
  {
    id: 'daily_reviews_20',
    name: 'Sesión Diaria',
    description: 'Completa 20 revisiones',
    frequency: 'daily',
    target: 20,
    xpReward: 15,
    checker: countTodayReviews,
  },
  {
    id: 'daily_high_risk_5',
    name: 'Rescate de Riesgo',
    description: 'Recupera 5 tarjetas de alto riesgo',
    frequency: 'daily',
    target: 5,
    xpReward: 25,
    checker: countHighRiskRecovered,
  },
  {
    id: 'daily_overdue_3',
    name: 'Desatrasarse',
    description: 'Resuelve 3 tarjetas atrasadas',
    frequency: 'daily',
    target: 3,
    xpReward: 20,
    checker: countOverdueResolved,
  },
  {
    id: 'daily_ai_review_5',
    name: 'Curador IA',
    description: 'Revisa 5 tarjetas importadas por IA',
    frequency: 'daily',
    target: 5,
    xpReward: 15,
    checker: countAICardsReviewed,
  },
  {
    id: 'daily_fragile_3',
    name: 'Estabilizar Frágiles',
    description: 'Estabiliza 3 tarjetas frágiles (stability < 7d → ≥ 7d)',
    frequency: 'daily',
    target: 3,
    xpReward: 20,
    checker: countFragileStabilized,
  },
  {
    id: 'daily_high_priority_5',
    name: 'Prioridad Alta',
    description: 'Repasa 5 tarjetas de prioridad alta o crítica',
    frequency: 'daily',
    target: 5,
    xpReward: 25,
    checker: countHighPriorityReviewed,
  },
  {
    id: 'daily_hard_topics_3',
    name: 'Dominar lo Difícil',
    description: 'Aprueba 3 tarjetas de temas difíciles',
    frequency: 'daily',
    target: 3,
    xpReward: 30,
    checker: countHardTopicsReviewed,
  },
];

const WEEKLY_TEMPLATES: QuestTemplate[] = [
  {
    id: 'weekly_reviews_100',
    name: 'Semana Consistente',
    description: 'Completa 100 revisiones esta semana',
    frequency: 'weekly',
    target: 100,
    xpReward: 50,
    checker: countWeekReviews,
  },
  {
    id: 'weekly_overdue_15',
    name: 'Limpieza Semanal',
    description: 'Resuelve 15 tarjetas atrasadas esta semana',
    frequency: 'weekly',
    target: 15,
    xpReward: 40,
    checker: countOverdueResolved,
  },
];

// ─── Generate quests ──────────────────────────────────────────────────────

function getEndDate(frequency: QuestFrequency): string {
  const end = new Date();
  if (frequency === 'daily') {
    end.setDate(end.getDate() + 1);
  } else {
    end.setDate(end.getDate() + 7);
  }
  return end.toISOString().split('T')[0];
}

export async function generateDailyQuests(userId: string): Promise<Quest[]> {
  // Check if we already have active daily quests for today
  const existing = await db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .filter(q => q.frequency === 'daily' && q.startDate === today())
    .toArray();

  if (existing.length > 0) return existing;

  // Expire old daily quests
  const oldDaily = await db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .filter(q => q.frequency === 'daily' && q.startDate < today())
    .toArray();

  for (const q of oldDaily) {
    await db.quests.update(q.id, { status: 'expired' });
  }

  // Pick 3 random daily templates
  const shuffled = [...DAILY_TEMPLATES].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 3);
  const todayStr = today();

  const quests: Quest[] = [];
  for (const tmpl of selected) {
    const quest: Quest = {
      id: generateId(),
      userId,
      templateId: tmpl.id,
      name: tmpl.name,
      description: tmpl.description,
      frequency: 'daily',
      status: 'active',
      progress: 0,
      target: tmpl.target,
      xpReward: tmpl.xpReward,
      startDate: todayStr,
      endDate: getEndDate('daily'),
      metadata: {},
    };
    await db.quests.add(quest);
    quests.push(quest);
  }

  return quests;
}

export async function generateWeeklyQuests(userId: string): Promise<Quest[]> {
  const todayStr = today();
  const dayOfWeek = new Date().getDay(); // 0 = Sunday

  // Only generate on Monday (1) or if none exist
  const existing = await db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .filter(q => q.frequency === 'weekly')
    .toArray();

  if (existing.length > 0) return existing;

  // Expire old weeklies
  const oldWeekly = await db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .filter(q => q.frequency === 'weekly' && q.endDate < todayStr)
    .toArray();

  for (const q of oldWeekly) {
    await db.quests.update(q.id, { status: 'expired' });
  }

  const quests: Quest[] = [];
  for (const tmpl of WEEKLY_TEMPLATES) {
    const quest: Quest = {
      id: generateId(),
      userId,
      templateId: tmpl.id,
      name: tmpl.name,
      description: tmpl.description,
      frequency: 'weekly',
      status: 'active',
      progress: 0,
      target: tmpl.target,
      xpReward: tmpl.xpReward,
      startDate: todayStr,
      endDate: getEndDate('weekly'),
      metadata: {},
    };
    await db.quests.add(quest);
    quests.push(quest);
  }

  return quests;
}

// ─── Update quest progress ───────────────────────────────────────────────

export async function updateQuestProgress(userId: string): Promise<Quest[]> {
  const activeQuests = await db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .toArray();

  const completed: Quest[] = [];

  for (const quest of activeQuests) {
    const template = [...DAILY_TEMPLATES, ...WEEKLY_TEMPLATES].find(t => t.id === quest.templateId);
    if (!template) continue;

    const progress = await template.checker(userId, quest);

    if (progress !== quest.progress) {
      await db.quests.update(quest.id, { progress });
      quest.progress = progress;
    }

    if (progress >= quest.target && quest.status === 'active') {
      await db.quests.update(quest.id, {
        status: 'completed',
        completedAt: now(),
        progress,
      });
      quest.status = 'completed';

      await awardXP(userId, quest.xpReward, 'quest_completed', `Quest: ${quest.name}`);
      await emitEvent(userId, 'quest_completed', 'gamification', quest.id, {
        name: quest.name,
        xpReward: quest.xpReward,
      });

      completed.push(quest);
    }
  }

  return completed;
}

// ─── Get active quests ───────────────────────────────────────────────────

export async function getActiveQuests(userId: string): Promise<Quest[]> {
  return db.quests
    .where('[userId+status]')
    .equals([userId, 'active'])
    .toArray();
}

export async function getCompletedQuests(userId: string, days: number = 7): Promise<Quest[]> {
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString();

  return db.quests
    .where('[userId+status]')
    .equals([userId, 'completed'])
    .filter(q => q.completedAt != null && q.completedAt >= startStr)
    .toArray();
}
