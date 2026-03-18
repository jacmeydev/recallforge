import type { AcademicMeta, JSONValue, JSONObject } from '@/types';

export interface CanonicalImportMetadataInput extends Partial<AcademicMeta> {
  source?: string;
  sourceMetadata?: Record<string, unknown>;
  importSource?: string;
  externalId?: string;
  duplicateKey?: string;
  agentId?: string;
}

export interface CardTemplateDescriptor {
  templateId: string;
  customData: JSONObject;
}

type LooseRecord = Record<string, unknown>;

function extractClozeIndices(text: string): number[] {
  const indices = new Set<number>();
  const regex = /\{\{c(\d+)::/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    indices.add(Number.parseInt(match[1], 10));
  }
  return [...indices].sort((a, b) => a - b);
}

function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toJsonRecord(value: unknown): JSONObject {
  if (!isRecord(value)) return {};
  return value as JSONObject;
}

export function serializeNoteFields(fieldValues: Record<string, string>): string {
  return Object.entries(fieldValues)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join('|||');
}

export function buildCanonicalSourceMetadata(input: CanonicalImportMetadataInput): JSONObject {
  const existing = isRecord(input.sourceMetadata) ? { ...input.sourceMetadata } : {};
  const existingAcademic = isRecord(existing.academic) ? existing.academic : {};

  const academic: Record<string, JSONValue> = {
    ...toJsonRecord(existingAcademic),
  };

  const academicFields = {
    subject: input.subject,
    module: input.module,
    chapter: input.chapter,
    topic: input.topic,
    subtopic: input.subtopic,
    lectureDate: input.lectureDate,
    professor: input.professor,
    sourcePage: input.sourcePage,
    book: input.book,
    className: input.className,
    examScope: input.examScope,
    aiGenerated: input.aiGenerated,
    aiReviewStatus: input.aiReviewStatus,
    priority: input.priority,
    conceptualDifficulty: input.conceptualDifficulty,
  };

  for (const [key, value] of Object.entries(academicFields)) {
    if (value !== undefined && value !== null && value !== '') {
      academic[key] = value as JSONValue;
    }
  }

  const result: JSONObject = {
    ...toJsonRecord(existing),
    importSource: (input.importSource ?? existing.importSource ?? input.source ?? 'manual') as JSONValue,
  };

  if (input.externalId ?? existing.externalId) {
    result.externalId = (input.externalId ?? existing.externalId) as JSONValue;
  }
  if (input.duplicateKey ?? existing.duplicateKey) {
    result.duplicateKey = (input.duplicateKey ?? existing.duplicateKey) as JSONValue;
  }
  if (input.agentId ?? existing.agentId) {
    result.agentId = (input.agentId ?? existing.agentId) as JSONValue;
  }
  if (Object.keys(academic).length > 0) {
    result.academic = academic;
  }

  delete result.subject;
  delete result.module;
  delete result.chapter;
  delete result.topic;
  delete result.subtopic;
  delete result.lectureDate;
  delete result.professor;
  delete result.sourcePage;
  delete result.book;
  delete result.className;
  delete result.examScope;
  delete result.aiGenerated;
  delete result.aiReviewStatus;
  delete result.priority;
  delete result.conceptualDifficulty;

  return result;
}

export function buildImportTags(tags: string[] = [], tagPrefix?: string): string[] {
  const next = new Set(tags);
  next.add('agent-import');
  if (tagPrefix) {
    next.add(tagPrefix);
  }
  return [...next];
}

export function getTemplateDescriptors(params: {
  noteTypeId: string;
  kind: string;
  templates: unknown;
  fieldValues: Record<string, string>;
}): CardTemplateDescriptor[] {
  const templates = Array.isArray(params.templates) ? params.templates : [];
  const activeTemplates = templates.filter((template) => !isRecord(template) || template.active !== false);
  const firstTemplate = activeTemplates[0];
  const baseTemplateId =
    (isRecord(firstTemplate) && typeof firstTemplate.id === 'string' && firstTemplate.id) ||
    `${params.noteTypeId}:tpl:0`;

  if (params.kind === 'cloze') {
    const indices = extractClozeIndices(Object.values(params.fieldValues).join(' '));
    return indices.map((index) => ({
      templateId: baseTemplateId,
      customData: { clozeIndex: index },
    }));
  }

  if (params.kind === 'image_occlusion' || params.kind === 'image-occlusion') {
    let maskCount = 1;
    const masksValue = params.fieldValues.Masks;
    if (masksValue) {
      try {
        const masks = JSON.parse(masksValue);
        if (Array.isArray(masks) && masks.length > 0) {
          maskCount = masks.length;
        }
      } catch {
        maskCount = 1;
      }
    }

    return Array.from({ length: maskCount }, (_, maskIndex) => ({
      templateId: baseTemplateId,
      customData: { maskIndex },
    }));
  }

  return activeTemplates.map((template, index) => ({
    templateId:
      (isRecord(template) && typeof template.id === 'string' && template.id) ||
      `${params.noteTypeId}:tpl:${index}`,
    customData: {},
  }));
}
