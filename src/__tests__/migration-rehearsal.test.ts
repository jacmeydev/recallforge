import { describe, expect, it } from 'vitest';
import { sqlite } from '@/lib/server/db';
import { getSchemaStatus, runMigrations } from '@/lib/server/db/migrate';

describe('migration rehearsal', () => {
  it('applies all pending migrations and exposes schema status', () => {
    const result = runMigrations();
    const status = getSchemaStatus();

    expect(result.schemaVersion).toBeTruthy();
    expect(status.pendingCount).toBe(0);
    expect(status.schemaVersion).toBeTruthy();
    expect(status.appliedCount).toBeGreaterThan(0);

    const tables = [
      'schema_migrations',
      'presets',
      'curriculum_modules',
      'curriculum_chapters',
      'curriculum_topics',
      'sync_operations',
      'card_commands',
    ];

    for (const tableName of tables) {
      const row = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(tableName) as { name: string } | undefined;
      expect(row?.name).toBe(tableName);
    }

    const columns = sqlite.prepare(`PRAGMA table_info("review_logs")`).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('effective_reviewed_at');
    expect(columns.map((column) => column.name)).toContain('scheduler_context');
  });
});
