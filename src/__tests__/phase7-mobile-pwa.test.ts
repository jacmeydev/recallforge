// ============================================================================
// RecallForge — Phase 7 Tests
// MOBILE/PWA POLISH + SMART NOTIFICATIONS + DAILY HABIT EXPERIENCE
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { sqlite } from '@/lib/server/db';
import { runMigrations } from '@/lib/server/db/migrate';
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
  savePushSubscription,
  removePushSubscription,
  getPushSubscriptions,
  generateSmartNotifications,
  getHabitData,
} from '@/lib/server/notification-service';

const TEST_USER_ID = `test-phase7-${Date.now()}`;
const TEST_EMAIL = `${TEST_USER_ID}@test.com`;

beforeAll(() => {
  runMigrations();

  // Clean up old test data
  const oldUsers = sqlite.prepare(
    `SELECT id FROM users WHERE email LIKE 'test-phase7-%@test.com'`
  ).all() as Array<{ id: string }>;
  for (const u of oldUsers) {
    sqlite.prepare(`DELETE FROM notification_preferences WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM review_logs WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM cards WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM notes WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM decks WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM user_gamification WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM daily_summaries WHERE user_id = ?`).run(u.id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(u.id);
  }

  // Create test user
  sqlite.prepare(`
    INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
    VALUES (?, ?, 'Phase 7 Test', 'dummy', datetime('now'), datetime('now'))
  `).run(TEST_USER_ID, TEST_EMAIL);
});

// ─── Notification Preferences ─────────────────────────────────────────────

describe('Notification Preferences', () => {
  it('returns null for non-existent preferences', () => {
    const prefs = getNotificationPreferences(TEST_USER_ID);
    expect(prefs).toBeNull();
  });

  it('creates default preferences on first upsert', () => {
    const prefs = upsertNotificationPreferences(TEST_USER_ID, {});
    expect(prefs.enabled).toBe(true);
    expect(prefs.studyReminders).toBe(true);
    expect(prefs.streakAlerts).toBe(true);
    expect(prefs.dailySummary).toBe(false);
    expect(prefs.quietStart).toBe('22:00');
    expect(prefs.quietEnd).toBe('08:00');
    expect(prefs.reminderTime).toBe('09:00');
    expect(prefs.userId).toBe(TEST_USER_ID);
  });

  it('retrieves saved preferences', () => {
    const prefs = getNotificationPreferences(TEST_USER_ID);
    expect(prefs).not.toBeNull();
    expect(prefs!.enabled).toBe(true);
  });

  it('updates specific fields without overwriting others', () => {
    const prefs = upsertNotificationPreferences(TEST_USER_ID, {
      dailySummary: true,
      quietStart: '23:00',
    });
    expect(prefs.dailySummary).toBe(true);
    expect(prefs.quietStart).toBe('23:00');
    // Other fields unchanged
    expect(prefs.studyReminders).toBe(true);
    expect(prefs.quietEnd).toBe('08:00');
  });

  it('can disable all notifications', () => {
    const prefs = upsertNotificationPreferences(TEST_USER_ID, {
      enabled: false,
    });
    expect(prefs.enabled).toBe(false);
  });

  it('can re-enable notifications', () => {
    const prefs = upsertNotificationPreferences(TEST_USER_ID, {
      enabled: true,
    });
    expect(prefs.enabled).toBe(true);
  });
});

// ─── Push Subscriptions ───────────────────────────────────────────────────

describe('Push Subscriptions', () => {
  const testEndpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint';
  const testP256dh = 'test-p256dh-key';
  const testAuth = 'test-auth-key';

  it('saves a push subscription', () => {
    const sub = savePushSubscription(TEST_USER_ID, testEndpoint, testP256dh, testAuth);
    expect(sub.userId).toBe(TEST_USER_ID);
    expect(sub.endpoint).toBe(testEndpoint);
    expect(sub.keysP256dh).toBe(testP256dh);
    expect(sub.keysAuth).toBe(testAuth);
    expect(sub.id).toBeTruthy();
    expect(sub.createdAt).toBeTruthy();
  });

  it('retrieves push subscriptions for user', () => {
    const subs = getPushSubscriptions(TEST_USER_ID);
    expect(subs.length).toBe(1);
    expect(subs[0].endpoint).toBe(testEndpoint);
  });

  it('replaces duplicate endpoints for same user', () => {
    savePushSubscription(TEST_USER_ID, testEndpoint, 'new-p256dh', 'new-auth');
    const subs = getPushSubscriptions(TEST_USER_ID);
    expect(subs.length).toBe(1);
    expect(subs[0].keysP256dh).toBe('new-p256dh');
  });

  it('removes push subscription', () => {
    removePushSubscription(TEST_USER_ID, testEndpoint);
    const subs = getPushSubscriptions(TEST_USER_ID);
    expect(subs.length).toBe(0);
  });
});

// ─── Smart Notifications ─────────────────────────────────────────────────

describe('Smart Notifications', () => {
  it('returns empty when notifications are disabled', () => {
    upsertNotificationPreferences(TEST_USER_ID, { enabled: false });
    const notifs = generateSmartNotifications(TEST_USER_ID);
    expect(notifs).toEqual([]);
    // Re-enable for subsequent tests
    upsertNotificationPreferences(TEST_USER_ID, { enabled: true });
  });

  it('returns no notifications for user with no data', () => {
    const notifs = generateSmartNotifications(TEST_USER_ID);
    // No cards, no gamification → no notifications
    expect(notifs.length).toBe(0);
  });

  it('returns study_reminder when due cards exist', () => {
    // Create a deck and a due card
    const deckId = `deck-p7-${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO decks (id, user_id, name, created_at, updated_at)
      VALUES (?, ?, 'Test Deck', datetime('now'), datetime('now'))
    `).run(deckId, TEST_USER_ID);

    const noteId = `note-p7-${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO notes (id, user_id, deck_id, note_type_id, field_values, tags, hash, created_at, updated_at)
      VALUES (?, ?, ?, 'nt-basic', '{}', '[]', 'testhash', datetime('now'), datetime('now'))
    `).run(noteId, TEST_USER_ID, deckId);

    const cardId = `card-p7-${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO cards (id, user_id, deck_id, note_id, template_id, state, due_at, stability, difficulty,
        retrievability, elapsed_days, scheduled_days, reps, lapses, suspended, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'tmpl-0', 'review', datetime('now', '-1 hour'), 1.0, 5.0,
        0.9, 1, 1, 1, 0, 0, datetime('now'), datetime('now'))
    `).run(cardId, TEST_USER_ID, deckId, noteId);

    const notifs = generateSmartNotifications(TEST_USER_ID);
    const studyReminder = notifs.find(n => n.type === 'study_reminder');
    expect(studyReminder).toBeDefined();
    expect(studyReminder!.title).toContain('pendiente');

    // Cleanup
    sqlite.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
    sqlite.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    sqlite.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
  });

  it('returns streak_at_risk when streak > 0 and not studied today', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    sqlite.prepare(`
      INSERT INTO user_gamification (id, user_id, current_streak, longest_streak, last_study_date, daily_goal, updated_at)
      VALUES (?, ?, 5, 10, ?, 20, datetime('now'))
    `).run(`gam-p7-${Date.now()}`, TEST_USER_ID, yesterdayStr);

    const notifs = generateSmartNotifications(TEST_USER_ID);
    const streakAlert = notifs.find(n => n.type === 'streak_at_risk');
    expect(streakAlert).toBeDefined();
    expect(streakAlert!.title).toContain('5 días');
  });
});

// ─── Habit Data ───────────────────────────────────────────────────────────

describe('Habit Data', () => {
  it('returns habit data for user', () => {
    const habit = getHabitData(TEST_USER_ID);
    expect(habit).toBeDefined();
    expect(habit.streak).toBe(5);
    expect(habit.dailyGoal).toBe(20);
    expect(habit.weekActivity).toHaveLength(7);
    expect(habit.streakAtRisk).toBe(true); // Not studied today
    expect(habit.todayStudied).toBe(false);
  });

  it('weekActivity has correct structure', () => {
    const habit = getHabitData(TEST_USER_ID);
    for (const day of habit.weekActivity) {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('studied');
      expect(day).toHaveProperty('count');
      expect(typeof day.date).toBe('string');
      expect(typeof day.studied).toBe('boolean');
      expect(typeof day.count).toBe('number');
    }
  });

  it('returns defaults for user without gamification', () => {
    const newUser = `habit-no-gam-${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES (?, ?, 'No Gam', 'dummy', datetime('now'), datetime('now'))
    `).run(newUser, `${newUser}@test.com`);

    const habit = getHabitData(newUser);
    expect(habit.streak).toBe(0);
    expect(habit.longestStreak).toBe(0);
    expect(habit.dailyGoal).toBe(20);
    expect(habit.streakAtRisk).toBe(false);

    // Cleanup
    sqlite.prepare('DELETE FROM users WHERE id = ?').run(newUser);
  });
});

// ─── DB Migration ─────────────────────────────────────────────────────────

describe('Phase 7 DB Tables', () => {
  it('notification_preferences table exists', () => {
    const result = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='notification_preferences'`
    ).get() as { name: string } | undefined;
    expect(result?.name).toBe('notification_preferences');
  });

  it('push_subscriptions table exists', () => {
    const result = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'`
    ).get() as { name: string } | undefined;
    expect(result?.name).toBe('push_subscriptions');
  });

  it('notification_preferences index exists', () => {
    const result = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notification_prefs_user'`
    ).get() as { name: string } | undefined;
    expect(result?.name).toBe('idx_notification_prefs_user');
  });

  it('push_subscriptions index exists', () => {
    const result = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_push_subs_user'`
    ).get() as { name: string } | undefined;
    expect(result?.name).toBe('idx_push_subs_user');
  });
});

// ─── Manifest Enhancements ───────────────────────────────────────────────

describe('PWA Manifest', () => {
  it('contains shortcuts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.join(process.cwd(), 'public', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(3);
    expect(manifest.shortcuts[0]).toHaveProperty('name');
    expect(manifest.shortcuts[0]).toHaveProperty('url');
  });

  it('has correct PWA fields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.join(process.cwd(), 'public', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.lang).toBe('es');
  });
});

// ─── Service Worker ───────────────────────────────────────────────────────

describe('Service Worker', () => {
  it('has push notification handler', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    const sw = fs.readFileSync(swPath, 'utf-8');

    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("showNotification");
  });

  it('has notification click handler', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    const sw = fs.readFileSync(swPath, 'utf-8');

    expect(sw).toContain("addEventListener('notificationclick'");
    expect(sw).toContain("openWindow");
  });

  it('has background sync handler', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    const sw = fs.readFileSync(swPath, 'utf-8');

    expect(sw).toContain("addEventListener('sync'");
    expect(sw).toContain('sync-reviews');
  });

  it('uses updated cache version', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    const sw = fs.readFileSync(swPath, 'utf-8');

    expect(sw).toContain('recallforge-v2');
  });
});
