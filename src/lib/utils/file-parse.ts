// ============================================================================
// RecallForge — AI Import File Parsers
// ============================================================================
// Detects format and parses JSON, JSONL, CSV, TSV into AIImportItem[].
// ============================================================================

import type { AIImportItem } from '@/lib/validation/ai-import-schema';
import { AIImportFileSchema, AIImportItemSchema, AI_IMPORT_VERSION } from '@/lib/validation/ai-import-schema';

export type ImportFormat = 'json' | 'jsonl' | 'csv' | 'tsv';

// ─── Format detection ─────────────────────────────────────────────────────

export function detectFormat(content: string): ImportFormat {
  const trimmed = content.trim();

  // JSON array: starts with [
  if (trimmed.startsWith('[')) {
    return 'json';
  }

  // Starts with { — could be JSON object or JSONL
  if (trimmed.startsWith('{')) {
    // JSONL: multiple lines each starting with {
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 1 && lines.every(l => l.trim().startsWith('{'))) {
      return 'jsonl';
    }
    return 'json';
  }

  // TSV vs CSV: check first line for tabs
  const firstLine = trimmed.split('\n')[0].trim();
  if (firstLine.includes('\t')) {
    return 'tsv';
  }

  return 'csv';
}

// ─── JSON parser ──────────────────────────────────────────────────────────

export function parseJSON(content: string): AIImportItem[] {
  const parsed = JSON.parse(content);

  // Envelope format: { version, items }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.version === AI_IMPORT_VERSION && Array.isArray(parsed.items)) {
      const validated = AIImportFileSchema.parse(parsed);
      return validated.items;
    }
    // Single item
    if (parsed.fields || parsed.noteType) {
      return [AIImportItemSchema.parse(parsed)];
    }
  }

  // Bare array
  if (Array.isArray(parsed)) {
    return parsed.map((item, i) => {
      const result = AIImportItemSchema.safeParse(item);
      if (!result.success) {
        throw new Error(`Ítem ${i}: ${result.error.issues.map(e => e.message).join(', ')}`);
      }
      return result.data;
    });
  }

  throw new Error('Formato JSON no reconocido: se esperaba un objeto con { version, items }, un array, o un objeto único');
}

// ─── JSONL parser ─────────────────────────────────────────────────────────

export function parseJSONL(content: string): AIImportItem[] {
  const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
  return lines.map((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Línea ${i + 1}: JSON inválido`);
    }
    const result = AIImportItemSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Línea ${i + 1}: ${result.error.issues.map(e => e.message).join(', ')}`);
    }
    return result.data;
  });
}

// ─── CSV/TSV parser ───────────────────────────────────────────────────────

function parseCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parses CSV/TSV into AIImportItem[].
 *
 * Required columns: noteType, deck, plus at least one field_* column.
 * Optional columns: tags, source, externalId, duplicateKey.
 *
 * Field columns are named with prefix "field_" (e.g., field_Front, field_Back).
 */
export function parseDelimited(content: string, delimiter: string): AIImportItem[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('El archivo debe tener al menos un encabezado y una fila de datos');
  }

  const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim());

  // Validate required headers
  const noteTypeCol = headers.findIndex(h => h.toLowerCase() === 'notetype');
  const deckCol = headers.findIndex(h => h.toLowerCase() === 'deck');
  const tagsCol = headers.findIndex(h => h.toLowerCase() === 'tags');
  const sourceCol = headers.findIndex(h => h.toLowerCase() === 'source');
  const externalIdCol = headers.findIndex(h => h.toLowerCase() === 'externalid');
  const duplicateKeyCol = headers.findIndex(h => h.toLowerCase() === 'duplicatekey');

  // Academic classification columns
  const subjectCol = headers.findIndex(h => h.toLowerCase() === 'subject');
  const moduleCol = headers.findIndex(h => h.toLowerCase() === 'module');
  const chapterCol = headers.findIndex(h => h.toLowerCase() === 'chapter');
  const topicCol = headers.findIndex(h => h.toLowerCase() === 'topic');
  const subtopicCol = headers.findIndex(h => h.toLowerCase() === 'subtopic');
  const examScopeCol = headers.findIndex(h => h.toLowerCase() === 'examscope');
  const professorCol = headers.findIndex(h => h.toLowerCase() === 'professor');
  const bookCol = headers.findIndex(h => h.toLowerCase() === 'book');
  const lectureDateCol = headers.findIndex(h => h.toLowerCase() === 'lecturedate');
  const aiGeneratedCol = headers.findIndex(h => h.toLowerCase() === 'aigenerated');
  const aiReviewStatusCol = headers.findIndex(h => h.toLowerCase() === 'aireviewstatus');

  // Find field columns
  const fieldCols: Array<{ index: number; name: string }> = [];
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase().startsWith('field_')) {
      fieldCols.push({ index: i, name: headers[i].substring(6) });
    }
  }

  if (noteTypeCol === -1) throw new Error('Columna "noteType" requerida');
  if (deckCol === -1) throw new Error('Columna "deck" requerida');
  if (fieldCols.length === 0) throw new Error('Se requiere al menos una columna "field_*" (ej: field_Front, field_Back)');

  const items: AIImportItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const cells = parseCSVLine(line, delimiter);
    const fields: Record<string, string> = {};

    for (const fc of fieldCols) {
      fields[fc.name] = (cells[fc.index] || '').trim();
    }

    const item: AIImportItem = {
      noteType: (cells[noteTypeCol] || '').trim(),
      deck: (cells[deckCol] || '').trim(),
      fields,
      tags: tagsCol >= 0 && cells[tagsCol]
        ? cells[tagsCol].split(';').map(t => t.trim()).filter(Boolean)
        : [],
    };

    if (sourceCol >= 0 && cells[sourceCol]) {
      item.source = cells[sourceCol].trim();
    }
    if (externalIdCol >= 0 && cells[externalIdCol]) {
      item.externalId = cells[externalIdCol].trim();
    }
    if (duplicateKeyCol >= 0 && cells[duplicateKeyCol]) {
      item.duplicateKey = cells[duplicateKeyCol].trim();
    }

    // Academic fields
    if (subjectCol >= 0 && cells[subjectCol]?.trim()) item.subject = cells[subjectCol].trim();
    if (moduleCol >= 0 && cells[moduleCol]?.trim()) item.module = cells[moduleCol].trim();
    if (chapterCol >= 0 && cells[chapterCol]?.trim()) item.chapter = cells[chapterCol].trim();
    if (topicCol >= 0 && cells[topicCol]?.trim()) item.topic = cells[topicCol].trim();
    if (subtopicCol >= 0 && cells[subtopicCol]?.trim()) item.subtopic = cells[subtopicCol].trim();
    if (examScopeCol >= 0 && cells[examScopeCol]?.trim()) item.examScope = cells[examScopeCol].trim();
    if (professorCol >= 0 && cells[professorCol]?.trim()) item.professor = cells[professorCol].trim();
    if (bookCol >= 0 && cells[bookCol]?.trim()) item.book = cells[bookCol].trim();
    if (lectureDateCol >= 0 && cells[lectureDateCol]?.trim()) item.lectureDate = cells[lectureDateCol].trim();
    if (aiGeneratedCol >= 0 && cells[aiGeneratedCol]?.trim()) {
      const val = cells[aiGeneratedCol].trim().toLowerCase();
      item.aiGenerated = val === 'true' || val === '1' || val === 'sí' || val === 'si';
    }
    if (aiReviewStatusCol >= 0 && cells[aiReviewStatusCol]?.trim()) {
      const val = cells[aiReviewStatusCol].trim() as 'pending-review' | 'reviewed' | 'corrected';
      if (['pending-review', 'reviewed', 'corrected'].includes(val)) {
        item.aiReviewStatus = val;
      }
    }

    items.push(item);
  }

  return items;
}

export function parseCSV(content: string): AIImportItem[] {
  return parseDelimited(content, ',');
}

export function parseTSV(content: string): AIImportItem[] {
  return parseDelimited(content, '\t');
}

// ─── Unified parser ───────────────────────────────────────────────────────

export function parseImportFile(content: string, format?: ImportFormat): AIImportItem[] {
  const fmt = format || detectFormat(content);

  switch (fmt) {
    case 'json': return parseJSON(content);
    case 'jsonl': return parseJSONL(content);
    case 'csv': return parseCSV(content);
    case 'tsv': return parseTSV(content);
    default: throw new Error(`Formato no soportado: ${fmt}`);
  }
}
