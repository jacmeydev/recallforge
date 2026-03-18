// ============================================================================
// RecallForge — Sync Data Transformation Utilities
// ============================================================================
// Pure functions for converting between client (camelCase/Dexie) and
// server (snake_case/SQLite) record formats. No Next.js dependencies.
// ============================================================================

// JSON columns by client table name (need stringify before insert)
export const JSON_COLS: Record<string, string[]> = {
  decks: ['metadata'],
  presets: ['learningSteps', 'relearningSteps', 'dailyLimits', 'fsrsParameters', 'optimizerMetadata'],
  noteTypes: ['fields', 'templates'],
  notes: ['fieldValues', 'tags', 'sourceMetadata'],
  cards: ['customData'],
  reviewLogs: ['schedulerContext'],
  cardCommands: ['payload'],
  activityEvents: ['payload'],
  dailySummaries: ['metrics'],
  personalSummaries: ['subjectsAdvanced', 'subjectsAbandoned', 'chaptersConsolidated', 'topMasteryGains'],
  curriculumPrograms: [],
  curriculumSubjects: [],
  curriculumModules: [],
  curriculumChapters: [],
  curriculumTopics: [],
  curriculumLinks: [],
  notificationPreferences: [],
  userGamification: ['achievements'],
};

// Boolean columns by client table name (stored as INTEGER 0/1 in SQLite)
export const BOOL_COLS: Record<string, string[]> = {
  decks: ['archived'],
  presets: ['enableFuzz', 'buryNewSiblings', 'buryReviewSiblings'],
  noteTypes: [],
  notes: ['suspended'],
  cards: ['suspended'],
  reviewLogs: ['wasManualReschedule', 'wasFilteredDeck'],
  cardCommands: [],
  activityEvents: [],
  dailySummaries: [],
  personalSummaries: [],
  curriculumPrograms: [],
  curriculumSubjects: [],
  curriculumModules: [],
  curriculumChapters: [],
  curriculumTopics: [],
  curriculumLinks: [],
  notificationPreferences: ['enabled', 'studyReminders', 'streakAlerts', 'dailySummary'],
  userGamification: [],
};

// Map client table names → SQLite table names
export const SQLITE_TABLE: Record<string, string> = {
  decks: 'decks',
  presets: 'presets',
  noteTypes: 'note_types',
  notes: 'notes',
  cards: 'cards',
  reviewLogs: 'review_logs',
  cardCommands: 'card_commands',
  activityEvents: 'activity_events',
  dailySummaries: 'daily_summaries',
  personalSummaries: 'personal_summaries',
  curriculumPrograms: 'curriculum_programs',
  curriculumSubjects: 'curriculum_subjects',
  curriculumModules: 'curriculum_modules',
  curriculumChapters: 'curriculum_chapters',
  curriculumTopics: 'curriculum_topics',
  curriculumLinks: 'curriculum_links',
  notificationPreferences: 'notification_preferences',
  userGamification: 'user_gamification',
};

// Convert camelCase → snake_case
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// Convert snake_case → camelCase
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Convert Dexie record (camelCase) → server DB format (snake_case + JSON stringify)
export function toServerRecord(
  data: Record<string, unknown>,
  userId: string,
  jsonCols: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const snakeKey = camelToSnake(key);
    if (jsonCols.includes(key) && typeof value === 'object' && value !== null) {
      result[snakeKey] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      result[snakeKey] = value ? 1 : 0;
    } else {
      result[snakeKey] = value;
    }
  }
  result['user_id'] = userId;
  return result;
}

// Convert server DB record (snake_case) → client format (camelCase + JSON parse)
export function toClientRecord(
  data: Record<string, unknown>,
  jsonCols: string[],
  boolCols: string[] = []
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const camelKey = snakeToCamel(key);
    if (jsonCols.includes(camelKey) && typeof value === 'string') {
      try { result[camelKey] = JSON.parse(value); } catch { result[camelKey] = value; }
    } else if (key === 'deleted_at') {
      continue; // Strip internal soft-delete column from client responses
    } else if (boolCols.includes(camelKey) && typeof value === 'number') {
      result[camelKey] = value !== 0;
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}
