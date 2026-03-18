// ============================================================================
// RecallForge — Account Data Deletion Helpers
// ============================================================================
// Centralizes destructive account operations so new user-scoped tables do not
// get forgotten in one route and break server-side deletion flows.
// ============================================================================

import { sqlite } from '@/lib/server/db';

type DeleteMode = 'data-only' | 'account';

interface DeleteInstruction {
  key: string;
  table: string;
  where: string;
}

export interface UserDataDeletionSummary {
  mode: DeleteMode;
  deleted: Record<string, number>;
}

const USER_DATA_DELETE_ORDER: DeleteInstruction[] = [
  { key: 'pushSubscriptions', table: 'push_subscriptions', where: 'user_id' },
  { key: 'notificationPreferences', table: 'notification_preferences', where: 'user_id' },
  { key: 'copilotOutcomes', table: 'copilot_outcomes', where: 'user_id' },
  { key: 'copilotDrafts', table: 'copilot_drafts', where: 'user_id' },
  { key: 'syncOperations', table: 'sync_operations', where: 'user_id' },
  { key: 'syncCursors', table: 'sync_cursors', where: 'user_id' },
  { key: 'curriculumLinks', table: 'curriculum_links', where: 'user_id' },
  { key: 'curriculumTopics', table: 'curriculum_topics', where: 'user_id' },
  { key: 'curriculumChapters', table: 'curriculum_chapters', where: 'user_id' },
  { key: 'curriculumModules', table: 'curriculum_modules', where: 'user_id' },
  { key: 'curriculumSubjects', table: 'curriculum_subjects', where: 'user_id' },
  { key: 'curriculumPrograms', table: 'curriculum_programs', where: 'user_id' },
  { key: 'userGamification', table: 'user_gamification', where: 'user_id' },
  { key: 'personalSummaries', table: 'personal_summaries', where: 'user_id' },
  { key: 'dailySummaries', table: 'daily_summaries', where: 'user_id' },
  { key: 'activityEvents', table: 'activity_events', where: 'user_id' },
  { key: 'cardCommands', table: 'card_commands', where: 'user_id' },
  { key: 'reviewLogs', table: 'review_logs', where: 'user_id' },
  { key: 'cards', table: 'cards', where: 'user_id' },
  { key: 'notes', table: 'notes', where: 'user_id' },
  { key: 'noteTypes', table: 'note_types', where: 'user_id' },
  { key: 'presets', table: 'presets', where: 'user_id' },
  { key: 'decks', table: 'decks', where: 'user_id' },
];

const deleteUserDataTransaction = sqlite.transaction((userId: string, mode: DeleteMode) => {
  const deleted: Record<string, number> = {};

  for (const instruction of USER_DATA_DELETE_ORDER) {
    const result = sqlite.prepare(
      `DELETE FROM ${instruction.table} WHERE ${instruction.where} = ?`
    ).run(userId);
    deleted[instruction.key] = result.changes;
  }

  if (mode === 'account') {
    deleted.sessions = sqlite
      .prepare('DELETE FROM sessions WHERE user_id = ?')
      .run(userId).changes;
    deleted.users = sqlite
      .prepare('DELETE FROM users WHERE id = ?')
      .run(userId).changes;
  }

  return {
    mode,
    deleted,
  } satisfies UserDataDeletionSummary;
});

export function deleteUserData(userId: string): UserDataDeletionSummary {
  return deleteUserDataTransaction(userId, 'data-only');
}

export function deleteUserAccount(userId: string): UserDataDeletionSummary {
  return deleteUserDataTransaction(userId, 'account');
}
