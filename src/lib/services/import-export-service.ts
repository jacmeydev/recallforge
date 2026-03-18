// ============================================================================
// RecallForge — Import / Export / Backup Service
// ============================================================================

import { db, queueSync } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { EventEmitters } from '@/lib/events';
import type { Note, Card, BackupSnapshot, JSONObject } from '@/types';

// ─── Export all data as JSON ──────────────────────────────────────────────

export async function exportAllData(userId: string): Promise<string> {
  const [decks, presets, noteTypes, notes, cards, reviewLogs, tags, flags, savedSearches, filteredDecks, sessions, dailySummaries,
    xpLedger, userGamification, quests,
    curriculumPrograms, curriculumSubjects, curriculumModules, curriculumChapters, curriculumTopics, curriculumLinks,
    personalSummaries,
    optimizationRuns,
  ] = await Promise.all([
    db.decks.where('userId').equals(userId).toArray(),
    db.presets.where('userId').equals(userId).toArray(),
    db.noteTypes.where('userId').equals(userId).toArray(),
    db.notes.where('userId').equals(userId).toArray(),
    db.cards.where('userId').equals(userId).toArray(),
    db.reviewLogs.where('userId').equals(userId).toArray(),
    db.tags.where('userId').equals(userId).toArray(),
    db.flags.where('userId').equals(userId).toArray(),
    db.savedSearches.where('userId').equals(userId).toArray(),
    db.filteredDecks.where('userId').equals(userId).toArray(),
    db.studySessions.where('userId').equals(userId).toArray(),
    db.dailySummaries.where('userId').equals(userId).toArray(),
    db.xpLedger.where('userId').equals(userId).toArray(),
    db.userGamification.where('userId').equals(userId).toArray(),
    db.quests.where('userId').equals(userId).toArray(),
    db.curriculumPrograms.where('userId').equals(userId).toArray(),
    db.curriculumSubjects.where('userId').equals(userId).toArray(),
    db.curriculumModules.where('userId').equals(userId).toArray(),
    db.curriculumChapters.where('userId').equals(userId).toArray(),
    db.curriculumTopics.where('userId').equals(userId).toArray(),
    db.curriculumLinks.where('userId').equals(userId).toArray(),
    db.personalSummaries.where('userId').equals(userId).toArray(),
    db.optimizationRuns.where('userId').equals(userId).toArray(),
  ]);

  const data = {
    version: 2,
    exportedAt: now(),
    app: 'RecallForge',
    data: {
      decks,
      presets,
      noteTypes,
      notes,
      cards,
      reviewLogs,
      tags,
      flags,
      savedSearches,
      filteredDecks,
      sessions,
      dailySummaries,
      xpLedger,
      userGamification,
      quests,
      curriculumPrograms,
      curriculumSubjects,
      curriculumModules,
      curriculumChapters,
      curriculumTopics,
      curriculumLinks,
      personalSummaries,
      optimizationRuns,
    },
  };

  await EventEmitters.exportRun(userId, {
    type: 'json',
    decksCount: decks.length,
    notesCount: notes.length,
    cardsCount: cards.length,
  });

  return JSON.stringify(data, null, 2);
}

// ─── Export as CSV/TSV ────────────────────────────────────────────────────

export async function exportNotesCSV(
  userId: string,
  options?: {
    deckId?: string;
    noteTypeId?: string;
    delimiter?: ',' | '\t';
  }
): Promise<string> {
  const delimiter = options?.delimiter || '\t';
  let notes = await db.notes.where('userId').equals(userId).toArray();

  if (options?.deckId) {
    notes = notes.filter(n => n.deckId === options.deckId);
  }
  if (options?.noteTypeId) {
    notes = notes.filter(n => n.noteTypeId === options.noteTypeId);
  }

  if (notes.length === 0) return '';

  // Get note type for field names
  const noteTypeIds = [...new Set(notes.map(n => n.noteTypeId))];
  const noteTypes = await Promise.all(noteTypeIds.map(id => db.noteTypes.get(id)));

  const rows: string[] = [];

  for (const note of notes) {
    const noteType = noteTypes.find(nt => nt?.id === note.noteTypeId);
    if (!noteType) continue;

    const fieldNames = noteType.fields.sort((a, b) => a.ordinal - b.ordinal).map(f => f.name);
    const values = fieldNames.map(name => {
      const value = note.fieldValues[name] || '';
      // Escape for CSV
      if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });

    // Add tags
    values.push(note.tags.join(' '));

    rows.push(values.join(delimiter));
  }

  // Header
  const noteType = noteTypes[0];
  if (noteType) {
    const fieldNames = noteType.fields.sort((a, b) => a.ordinal - b.ordinal).map(f => f.name);
    fieldNames.push('Tags');
    rows.unshift(fieldNames.join(delimiter));
  }

  await EventEmitters.exportRun(userId, {
    type: 'csv',
    notesCount: notes.length,
  });

  return rows.join('\n');
}

// ─── Import from JSON ─────────────────────────────────────────────────────

export interface ImportResult {
  decksCreated: number;
  notesCreated: number;
  notesUpdated: number;
  notesDuplicate: number;
  cardsCreated: number;
  errors: string[];
}

export async function importFromJSON(
  userId: string,
  jsonString: string,
  options?: {
    duplicateHandling?: 'skip' | 'update' | 'create_new';
  }
): Promise<ImportResult> {
  const result: ImportResult = {
    decksCreated: 0,
    notesCreated: 0,
    notesUpdated: 0,
    notesDuplicate: 0,
    cardsCreated: 0,
    errors: [],
  };

  try {
    const parsed = JSON.parse(jsonString);
    // Validate top-level structure
    const { ImportJSONSchema } = await import('@/lib/validation/schemas');
    const validatedImport = ImportJSONSchema.safeParse(parsed);
    if (!validatedImport.success) {
      result.errors.push('Formato de importación inválido: ' + validatedImport.error.message);
      return result;
    }
    const data = validatedImport.data.data || parsed.data || parsed;

    await db.transaction(
      'rw',
      [db.decks, db.noteTypes, db.presets, db.notes, db.cards, db.tags, db.reviewLogs,
       db.xpLedger, db.userGamification, db.quests,
       db.curriculumPrograms, db.curriculumSubjects, db.curriculumModules,
       db.curriculumChapters, db.curriculumTopics, db.curriculumLinks,
       db.personalSummaries, db.optimizationRuns],
      async () => {
        // Import decks
        if (data.decks) {
          for (const deck of data.decks) {
            const existing = await db.decks.get(deck.id);
            if (!existing) {
              const record = { ...deck, userId };
              await db.decks.add(record);
              await queueSync('decks', deck.id, 'create', record as unknown as Record<string, unknown>);
              result.decksCreated++;
            }
          }
        }

        // Import note types
        if (data.noteTypes) {
          for (const nt of data.noteTypes) {
            const existing = await db.noteTypes.get(nt.id);
            if (!existing) {
              const record = { ...nt, userId };
              await db.noteTypes.add(record);
              await queueSync('noteTypes', nt.id, 'create', record as unknown as Record<string, unknown>);
            }
          }
        }

        // Import presets
        if (data.presets) {
          for (const preset of data.presets) {
            const existing = await db.presets.get(preset.id);
            if (!existing) {
              await db.presets.add({ ...preset, userId });
            }
          }
        }

        // Import notes
        if (data.notes) {
          for (const note of data.notes) {
            const existing = await db.notes.where('hash').equals(note.hash).first();

            if (existing) {
              if (options?.duplicateHandling === 'update') {
                await db.notes.update(existing.id, { ...note, userId, id: existing.id });
                await queueSync('notes', existing.id, 'update', { ...note, userId, id: existing.id } as unknown as Record<string, unknown>);
                result.notesUpdated++;
              } else if (options?.duplicateHandling === 'create_new') {
                const newId = generateId();
                const record = { ...note, userId, id: newId };
                await db.notes.add(record);
                await queueSync('notes', newId, 'create', record as unknown as Record<string, unknown>);
                result.notesCreated++;
              } else {
                result.notesDuplicate++;
              }
            } else {
              await db.notes.add({ ...note, userId });
              await queueSync('notes', note.id, 'create', { ...note, userId } as unknown as Record<string, unknown>);
              result.notesCreated++;
            }
          }
        }

        // Import cards
        if (data.cards) {
          for (const card of data.cards) {
            const existing = await db.cards.get(card.id);
            if (!existing) {
              const record = { ...card, userId };
              await db.cards.add(record);
              await queueSync('cards', card.id, 'create', record as unknown as Record<string, unknown>);
              result.cardsCreated++;
            }
          }
        }

        // Import review logs
        if (data.reviewLogs) {
          for (const log of data.reviewLogs) {
            const existing = await db.reviewLogs.get(log.id);
            if (!existing) {
              const record = { ...log, userId };
              await db.reviewLogs.add(record);
              await queueSync('reviewLogs', log.id, 'create', record as unknown as Record<string, unknown>);
            }
          }
        }

        // Import tags
        if (data.tags) {
          for (const tag of data.tags) {
            const existing = await db.tags.where('name').equals(tag.name).first();
            if (!existing) {
              await db.tags.add({ ...tag, userId });
            }
          }
        }

        // Import gamification data
        const bulkImportTable = async (table: any, items: Array<{ id: string; [key: string]: unknown }> | undefined) => {
          if (!items) return;
          for (const item of items) {
            const existing = await table.get(item.id);
            if (!existing) {
              await table.add({ ...item, userId });
            }
          }
        };

        await bulkImportTable(db.xpLedger, data.xpLedger);
        await bulkImportTable(db.userGamification, data.userGamification);
        await bulkImportTable(db.quests, data.quests);

        // Import curriculum data
        await bulkImportTable(db.curriculumPrograms, data.curriculumPrograms);
        await bulkImportTable(db.curriculumSubjects, data.curriculumSubjects);
        await bulkImportTable(db.curriculumModules, data.curriculumModules);
        await bulkImportTable(db.curriculumChapters, data.curriculumChapters);
        await bulkImportTable(db.curriculumTopics, data.curriculumTopics);
        await bulkImportTable(db.curriculumLinks, data.curriculumLinks);
        await bulkImportTable(db.personalSummaries, data.personalSummaries);
        await bulkImportTable(db.optimizationRuns, data.optimizationRuns);
      }
    );
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'Unknown import error');
  }

  await EventEmitters.importRun(userId, result as unknown as JSONObject);
  return result;
}

// ─── Import from CSV/TSV ──────────────────────────────────────────────────

export interface CSVImportMapping {
  columns: string[];
  fieldMapping: Record<number, string>; // column index -> field name
  tagColumn?: number;
  deckId: string;
  noteTypeId: string;
}

export async function importFromCSV(
  userId: string,
  csvContent: string,
  mapping: CSVImportMapping,
  delimiter: ',' | '\t' = '\t'
): Promise<ImportResult> {
  const result: ImportResult = {
    decksCreated: 0,
    notesCreated: 0,
    notesUpdated: 0,
    notesDuplicate: 0,
    cardsCreated: 0,
    errors: [],
  };

  const { createNote } = await import('./note-service');
  const lines = csvContent.split('\n').filter(l => l.trim());

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i], delimiter);
      const fieldValues: Record<string, string> = {};

      for (const [colIndex, fieldName] of Object.entries(mapping.fieldMapping)) {
        const idx = parseInt(colIndex);
        fieldValues[fieldName] = values[idx] || '';
      }

      const tags: string[] = [];
      if (mapping.tagColumn !== undefined && values[mapping.tagColumn]) {
        tags.push(...values[mapping.tagColumn].split(/\s+/).filter(Boolean));
      }

      const { cards } = await createNote(userId, {
        deckId: mapping.deckId,
        noteTypeId: mapping.noteTypeId,
        fieldValues,
        tags,
      });

      result.notesCreated++;
      result.cardsCreated += cards.length;
    } catch (err) {
      result.errors.push(`Row ${i}: ${err instanceof Error ? err.message : 'Error'}`);
    }
  }

  await EventEmitters.importRun(userId, {
    type: 'csv',
    ...result,
  } as unknown as JSONObject);

  return result;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ─── Backups ──────────────────────────────────────────────────────────────

export async function createBackup(
  userId: string,
  type: 'auto' | 'manual' | 'pre_operation' = 'manual',
  label?: string
): Promise<BackupSnapshot> {
  const jsonData = await exportAllData(userId);
  const blob = new Blob([jsonData], { type: 'application/json' });

  const backup: BackupSnapshot = {
    id: generateId(),
    userId,
    type,
    label,
    data: blob,
    createdAt: now(),
    metadata: {
      size: blob.size,
      version: 1,
    },
  };

  await db.backups.add(backup);
  await EventEmitters.backupCreated(userId, backup.id, {
    type: backup.type,
    size: blob.size,
  });

  return backup;
}

export async function listBackups(userId: string): Promise<Omit<BackupSnapshot, 'data'>[]> {
  const backups = await db.backups
    .where('userId')
    .equals(userId)
    .reverse()
    .toArray();

  return backups.map(({ data, ...rest }) => rest);
}

export async function restoreBackup(userId: string, backupId: string): Promise<ImportResult> {
  const backup = await db.backups.get(backupId);
  if (!backup || !backup.data) {
    return {
      decksCreated: 0,
      notesCreated: 0,
      notesUpdated: 0,
      notesDuplicate: 0,
      cardsCreated: 0,
      errors: ['Backup not found or has no data'],
    };
  }

  const jsonString = await backup.data.text();
  return importFromJSON(userId, jsonString, { duplicateHandling: 'update' });
}

export async function deleteOldBackups(userId: string, keepCount: number = 10): Promise<number> {
  const backups = await db.backups
    .where('userId')
    .equals(userId)
    .sortBy('createdAt');

  if (backups.length <= keepCount) return 0;

  const toDelete = backups.slice(0, backups.length - keepCount);
  for (const backup of toDelete) {
    await db.backups.delete(backup.id);
  }

  return toDelete.length;
}
