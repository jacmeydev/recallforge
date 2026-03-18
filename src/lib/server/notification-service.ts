// ============================================================================
// RecallForge — Notification Service (Phase 7)
// Smart notifications based on study data
// ============================================================================

import { sqlite } from '@/lib/server/db';
import { v4 as uuid } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  id: string;
  userId: string;
  enabled: boolean;
  studyReminders: boolean;
  streakAlerts: boolean;
  dailySummary: boolean;
  quietStart: string; // HH:mm
  quietEnd: string;   // HH:mm
  reminderTime: string; // HH:mm
  updatedAt: string;
}

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  keysP256dh: string;
  keysAuth: string;
  createdAt: string;
}

export interface SmartNotification {
  type: 'study_reminder' | 'streak_at_risk' | 'daily_summary' | 'streak_milestone' | 'comeback';
  title: string;
  body: string;
  icon?: string;
  urgency: 'low' | 'normal' | 'high';
  data?: Record<string, unknown>;
}

// ─── Preferences ──────────────────────────────────────────────────────────

export function getNotificationPreferences(userId: string): NotificationPreferences | null {
  const row = sqlite.prepare(
    'SELECT * FROM notification_preferences WHERE user_id = ?'
  ).get(userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    enabled: row.enabled === 1,
    studyReminders: row.study_reminders === 1,
    streakAlerts: row.streak_alerts === 1,
    dailySummary: row.daily_summary === 1,
    quietStart: row.quiet_start as string,
    quietEnd: row.quiet_end as string,
    reminderTime: row.reminder_time as string,
    updatedAt: row.updated_at as string,
  };
}

export function upsertNotificationPreferences(
  userId: string,
  prefs: Partial<Omit<NotificationPreferences, 'id' | 'userId' | 'updatedAt'>>
): NotificationPreferences {
  const now = new Date().toISOString();
  const existing = getNotificationPreferences(userId);

  if (existing) {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (prefs.enabled !== undefined) { updates.push('enabled = ?'); values.push(prefs.enabled ? 1 : 0); }
    if (prefs.studyReminders !== undefined) { updates.push('study_reminders = ?'); values.push(prefs.studyReminders ? 1 : 0); }
    if (prefs.streakAlerts !== undefined) { updates.push('streak_alerts = ?'); values.push(prefs.streakAlerts ? 1 : 0); }
    if (prefs.dailySummary !== undefined) { updates.push('daily_summary = ?'); values.push(prefs.dailySummary ? 1 : 0); }
    if (prefs.quietStart !== undefined) { updates.push('quiet_start = ?'); values.push(prefs.quietStart); }
    if (prefs.quietEnd !== undefined) { updates.push('quiet_end = ?'); values.push(prefs.quietEnd); }
    if (prefs.reminderTime !== undefined) { updates.push('reminder_time = ?'); values.push(prefs.reminderTime); }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(userId);

    sqlite.prepare(
      `UPDATE notification_preferences SET ${updates.join(', ')} WHERE user_id = ?`
    ).run(...values);
  } else {
    const id = uuid();
    sqlite.prepare(
      `INSERT INTO notification_preferences (id, user_id, enabled, study_reminders, streak_alerts, daily_summary, quiet_start, quiet_end, reminder_time, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, userId,
      prefs.enabled !== undefined ? (prefs.enabled ? 1 : 0) : 1,
      prefs.studyReminders !== undefined ? (prefs.studyReminders ? 1 : 0) : 1,
      prefs.streakAlerts !== undefined ? (prefs.streakAlerts ? 1 : 0) : 1,
      prefs.dailySummary !== undefined ? (prefs.dailySummary ? 1 : 0) : 0,
      prefs.quietStart ?? '22:00',
      prefs.quietEnd ?? '08:00',
      prefs.reminderTime ?? '09:00',
      now
    );
  }

  return getNotificationPreferences(userId)!;
}

// ─── Push Subscriptions ───────────────────────────────────────────────────

export function savePushSubscription(
  userId: string,
  endpoint: string,
  keysP256dh: string,
  keysAuth: string
): PushSubscription {
  // Remove existing subscription with same endpoint
  sqlite.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).run(userId, endpoint);

  const id = uuid();
  const now = new Date().toISOString();

  sqlite.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, endpoint, keysP256dh, keysAuth, now);

  return { id, userId, endpoint, keysP256dh, keysAuth, createdAt: now };
}

export function removePushSubscription(userId: string, endpoint: string): void {
  sqlite.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).run(userId, endpoint);
}

export function getPushSubscriptions(userId: string): PushSubscription[] {
  const rows = sqlite.prepare(
    'SELECT * FROM push_subscriptions WHERE user_id = ?'
  ).all(userId) as Record<string, unknown>[];

  return rows.map(row => ({
    id: row.id as string,
    userId: row.user_id as string,
    endpoint: row.endpoint as string,
    keysP256dh: row.keys_p256dh as string,
    keysAuth: row.keys_auth as string,
    createdAt: row.created_at as string,
  }));
}

// ─── Smart Notification Generation ────────────────────────────────────────

export function generateSmartNotifications(userId: string): SmartNotification[] {
  const prefs = getNotificationPreferences(userId);
  if (prefs && !prefs.enabled) return [];

  const notifications: SmartNotification[] = [];
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // 1. Due cards count
  const dueCount = sqlite.prepare(
    `SELECT COUNT(*) as cnt FROM cards 
     WHERE user_id = ? AND state != 'new' AND suspended = 0 AND due_at <= ?`
  ).get(userId, now.toISOString()) as { cnt: number };

  if (dueCount.cnt > 0 && (!prefs || prefs.studyReminders)) {
    notifications.push({
      type: 'study_reminder',
      title: 'Tarjetas pendientes',
      body: dueCount.cnt === 1
        ? 'Tenés 1 tarjeta pendiente de repaso'
        : `Tenés ${dueCount.cnt} tarjetas pendientes de repaso`,
      urgency: dueCount.cnt > 20 ? 'high' : 'normal',
      data: { dueCount: dueCount.cnt },
    });
  }

  // 2. Streak at risk
  const gam = sqlite.prepare(
    'SELECT current_streak, last_study_date FROM user_gamification WHERE user_id = ?'
  ).get(userId) as { current_streak: number; last_study_date: string | null } | undefined;

  if (gam && gam.current_streak > 0 && (!prefs || prefs.streakAlerts)) {
    const lastStudy = gam.last_study_date;
    if (lastStudy && lastStudy !== todayStr) {
      // Haven't studied today, streak is at risk
      const hour = now.getHours();
      const urgency = hour >= 18 ? 'high' : hour >= 14 ? 'normal' : 'low';
      notifications.push({
        type: 'streak_at_risk',
        title: `¡Racha de ${gam.current_streak} días en riesgo!`,
        body: 'Estudiá hoy para mantener tu racha',
        urgency,
        data: { streak: gam.current_streak },
      });
    }
  }

  // 3. Comeback notification (hasn't studied in 2+ days)
  if (gam?.last_study_date) {
    const lastDate = new Date(gam.last_study_date);
    const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 2) {
      notifications.push({
        type: 'comeback',
        title: '¡Te extrañamos!',
        body: `Hace ${daysSince} días que no estudiás. Una sesión rápida de rescate te pone al día.`,
        urgency: 'normal',
        data: { daysSince },
      });
    }
  }

  // 4. Streak milestones (daily summary context)
  if (gam && gam.last_study_date === todayStr && (!prefs || prefs.dailySummary)) {
    const todaySummary = sqlite.prepare(
      'SELECT metrics FROM daily_summaries WHERE user_id = ? AND date = ?'
    ).get(userId, todayStr) as { metrics: string } | undefined;

    if (todaySummary) {
      const metrics = JSON.parse(todaySummary.metrics);
      notifications.push({
        type: 'daily_summary',
        title: 'Resumen del día',
        body: `Estudiaste ${metrics.cardsStudied || 0} tarjetas con ${((metrics.retention || 0) * 100).toFixed(0)}% de retención`,
        urgency: 'low',
        data: metrics,
      });
    }
  }

  return notifications;
}

// ─── Habit Data ───────────────────────────────────────────────────────────

export interface HabitData {
  streak: number;
  longestStreak: number;
  dailyGoal: number;
  todayProgress: number;
  todayStudied: boolean;
  lastStudyDate: string | null;
  weekActivity: { date: string; studied: boolean; count: number }[];
  streakAtRisk: boolean;
}

export function getHabitData(userId: string): HabitData {
  const gam = sqlite.prepare(
    'SELECT current_streak, longest_streak, last_study_date, daily_goal FROM user_gamification WHERE user_id = ?'
  ).get(userId) as { current_streak: number; longest_streak: number; last_study_date: string | null; daily_goal: number } | undefined;

  const todayStr = new Date().toISOString().split('T')[0];

  // Get today's review count
  const todayCount = sqlite.prepare(
    `SELECT COUNT(*) as cnt FROM review_logs 
     WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at <= ?`
  ).get(userId, `${todayStr}T00:00:00.000Z`, `${todayStr}T23:59:59.999Z`) as { cnt: number };

  // Get last 7 days activity
  const weekActivity: { date: string; studied: boolean; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayCount = sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM review_logs 
       WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at <= ?`
    ).get(userId, `${dateStr}T00:00:00.000Z`, `${dateStr}T23:59:59.999Z`) as { cnt: number };
    weekActivity.push({ date: dateStr, studied: dayCount.cnt > 0, count: dayCount.cnt });
  }

  const streak = gam?.current_streak ?? 0;
  const dailyGoal = gam?.daily_goal ?? 20;
  const todayStudied = todayCount.cnt > 0;
  const streakAtRisk = streak > 0 && !todayStudied;

  return {
    streak,
    longestStreak: gam?.longest_streak ?? 0,
    dailyGoal,
    todayProgress: todayCount.cnt,
    todayStudied,
    lastStudyDate: gam?.last_study_date ?? null,
    weekActivity,
    streakAtRisk,
  };
}
