// ============================================================================
// RecallForge — Curriculum Service (Phase 2 Academic)
// ============================================================================
// CRUD for normalized curriculum structure + progress calculation.
// Coexists with AcademicMeta (free-form) — this is the structured layer.
// ============================================================================

import { db } from '@/lib/db';
import { generateId, now } from '@/lib/utils';
import { calculateRetrievability } from '@/lib/fsrs';
import { EventEmitters } from '@/lib/events';
import type {
  CurriculumProgram,
  CurriculumSubject,
  CurriculumModule,
  CurriculumChapter,
  CurriculumTopic,
  CurriculumLink,
  CurriculumProgress,
  Card,
  Note,
  AcademicMeta,
  JSONObject,
  ConceptualPriority,
  ConceptualDifficulty,
} from '@/types';
import type {
  CreateProgramInput,
  CreateSubjectInput,
  CreateModuleInput,
  CreateChapterInput,
  CreateTopicInput,
} from '@/lib/validation/schemas';

// ============================================================================
// CRUD — Programs
// ============================================================================

export async function createProgram(
  userId: string,
  input: CreateProgramInput
): Promise<CurriculumProgram> {
  const program: CurriculumProgram = {
    id: generateId(),
    userId,
    name: input.name,
    description: input.description || '',
    career: input.career,
    year: input.year,
    semester: input.semester,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.curriculumPrograms.add(program);
  await EventEmitters.curriculumProgramCreated(userId, program.id, { name: input.name });
  return program;
}

export async function getPrograms(userId: string): Promise<CurriculumProgram[]> {
  return db.curriculumPrograms.where('userId').equals(userId).toArray();
}

export async function getProgram(programId: string): Promise<CurriculumProgram | undefined> {
  return db.curriculumPrograms.get(programId);
}

export async function updateProgram(
  programId: string,
  updates: Partial<Pick<CurriculumProgram, 'name' | 'description' | 'career' | 'year' | 'semester'>>
): Promise<void> {
  await db.curriculumPrograms.update(programId, { ...updates, updatedAt: now() });
}

export async function deleteProgram(userId: string, programId: string): Promise<void> {
  const subjects = await db.curriculumSubjects.where('[userId+programId]').equals([userId, programId]).toArray();
  for (const subject of subjects) {
    await deleteSubject(userId, subject.id);
  }
  await db.curriculumLinks.where('userId').equals(userId).filter(l => l.programId === programId).delete();
  await db.curriculumPrograms.delete(programId);
}

// ============================================================================
// CRUD — Subjects
// ============================================================================

export async function createSubject(
  userId: string,
  input: CreateSubjectInput
): Promise<CurriculumSubject> {
  const subject: CurriculumSubject = {
    id: generateId(),
    userId,
    programId: input.programId,
    name: input.name,
    code: input.code,
    description: input.description,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.curriculumSubjects.add(subject);
  await EventEmitters.curriculumSubjectCreated(userId, subject.id, {
    name: input.name,
    programId: input.programId,
  });
  return subject;
}

export async function getSubjects(userId: string, programId: string): Promise<CurriculumSubject[]> {
  return db.curriculumSubjects
    .where('[userId+programId]')
    .equals([userId, programId])
    .sortBy('sortOrder');
}

export async function getAllSubjects(userId: string): Promise<CurriculumSubject[]> {
  return db.curriculumSubjects.where('userId').equals(userId).toArray();
}

export async function updateSubject(
  subjectId: string,
  updates: Partial<Pick<CurriculumSubject, 'name' | 'code' | 'description' | 'sortOrder'>>
): Promise<void> {
  await db.curriculumSubjects.update(subjectId, { ...updates, updatedAt: now() });
}

export async function deleteSubject(userId: string, subjectId: string): Promise<void> {
  const modules = await db.curriculumModules.where('[userId+subjectId]').equals([userId, subjectId]).toArray();
  for (const mod of modules) {
    await deleteModule(userId, mod.id);
  }
  await db.curriculumLinks.where('[userId+subjectId]').equals([userId, subjectId]).delete();
  await db.curriculumSubjects.delete(subjectId);
}

// ============================================================================
// CRUD — Modules
// ============================================================================

export async function createModule(
  userId: string,
  input: CreateModuleInput
): Promise<CurriculumModule> {
  const mod: CurriculumModule = {
    id: generateId(),
    userId,
    subjectId: input.subjectId,
    name: input.name,
    description: input.description,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.curriculumModules.add(mod);
  await EventEmitters.curriculumModuleCreated(userId, mod.id, {
    name: input.name,
    subjectId: input.subjectId,
  });
  return mod;
}

export async function getModules(userId: string, subjectId: string): Promise<CurriculumModule[]> {
  return db.curriculumModules
    .where('[userId+subjectId]')
    .equals([userId, subjectId])
    .sortBy('sortOrder');
}

export async function updateModule(
  moduleId: string,
  updates: Partial<Pick<CurriculumModule, 'name' | 'description' | 'sortOrder'>>
): Promise<void> {
  await db.curriculumModules.update(moduleId, { ...updates, updatedAt: now() });
}

export async function deleteModule(userId: string, moduleId: string): Promise<void> {
  const chapters = await db.curriculumChapters.where('[userId+moduleId]').equals([userId, moduleId]).toArray();
  for (const ch of chapters) {
    await deleteChapter(userId, ch.id);
  }
  await db.curriculumLinks.where('[userId+moduleId]').equals([userId, moduleId]).delete();
  await db.curriculumModules.delete(moduleId);
}

// ============================================================================
// CRUD — Chapters
// ============================================================================

export async function createChapter(
  userId: string,
  input: CreateChapterInput
): Promise<CurriculumChapter> {
  const chapter: CurriculumChapter = {
    id: generateId(),
    userId,
    moduleId: input.moduleId,
    name: input.name,
    description: input.description,
    examScope: input.examScope,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.curriculumChapters.add(chapter);
  await EventEmitters.curriculumChapterCreated(userId, chapter.id, {
    name: input.name,
    moduleId: input.moduleId,
  });
  return chapter;
}

export async function getChapters(userId: string, moduleId: string): Promise<CurriculumChapter[]> {
  return db.curriculumChapters
    .where('[userId+moduleId]')
    .equals([userId, moduleId])
    .sortBy('sortOrder');
}

export async function updateChapter(
  chapterId: string,
  updates: Partial<Pick<CurriculumChapter, 'name' | 'description' | 'examScope' | 'sortOrder'>>
): Promise<void> {
  await db.curriculumChapters.update(chapterId, { ...updates, updatedAt: now() });
}

export async function deleteChapter(userId: string, chapterId: string): Promise<void> {
  const topics = await db.curriculumTopics.where('[userId+chapterId]').equals([userId, chapterId]).toArray();
  for (const t of topics) {
    await deleteTopic(userId, t.id);
  }
  await db.curriculumLinks.where('[userId+chapterId]').equals([userId, chapterId]).delete();
  await db.curriculumChapters.delete(chapterId);
}

// ============================================================================
// CRUD — Topics
// ============================================================================

export async function createTopic(
  userId: string,
  input: CreateTopicInput
): Promise<CurriculumTopic> {
  const topic: CurriculumTopic = {
    id: generateId(),
    userId,
    chapterId: input.chapterId,
    name: input.name,
    description: input.description,
    priorityDefault: input.priorityDefault,
    conceptualDifficultyDefault: input.conceptualDifficultyDefault,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.curriculumTopics.add(topic);
  await EventEmitters.curriculumTopicCreated(userId, topic.id, {
    name: input.name,
    chapterId: input.chapterId,
  });
  return topic;
}

export async function getTopics(userId: string, chapterId: string): Promise<CurriculumTopic[]> {
  return db.curriculumTopics
    .where('[userId+chapterId]')
    .equals([userId, chapterId])
    .sortBy('sortOrder');
}

export async function updateTopic(
  topicId: string,
  updates: Partial<Pick<CurriculumTopic, 'name' | 'description' | 'priorityDefault' | 'conceptualDifficultyDefault' | 'sortOrder'>>
): Promise<void> {
  await db.curriculumTopics.update(topicId, { ...updates, updatedAt: now() });
}

export async function deleteTopic(userId: string, topicId: string): Promise<void> {
  await db.curriculumLinks.where('[userId+topicId]').equals([userId, topicId]).delete();
  await db.curriculumTopics.delete(topicId);
}

// ============================================================================
// Curriculum Links
// ============================================================================

export async function createLink(
  userId: string,
  input: {
    noteId?: string;
    cardId?: string;
    deckId?: string;
    programId?: string;
    subjectId?: string;
    moduleId?: string;
    chapterId?: string;
    topicId?: string;
  }
): Promise<CurriculumLink> {
  const link: CurriculumLink = {
    id: generateId(),
    userId,
    noteId: input.noteId,
    cardId: input.cardId,
    deckId: input.deckId,
    programId: input.programId,
    subjectId: input.subjectId,
    moduleId: input.moduleId,
    chapterId: input.chapterId,
    topicId: input.topicId,
    createdAt: now(),
  };
  await db.curriculumLinks.add(link);
  await EventEmitters.curriculumLinked(userId, link.id, {
    noteId: input.noteId || '',
    deckId: input.deckId || '',
    topicId: input.topicId || '',
    subjectId: input.subjectId || '',
  });
  return link;
}

export async function getLinksForNote(userId: string, noteId: string): Promise<CurriculumLink[]> {
  return db.curriculumLinks.where('[userId+noteId]').equals([userId, noteId]).toArray();
}

export async function getLinksForDeck(userId: string, deckId: string): Promise<CurriculumLink[]> {
  return db.curriculumLinks.where('[userId+deckId]').equals([userId, deckId]).toArray();
}

export async function getLinksForSubject(userId: string, subjectId: string): Promise<CurriculumLink[]> {
  return db.curriculumLinks.where('[userId+subjectId]').equals([userId, subjectId]).toArray();
}

export async function getLinksForTopic(userId: string, topicId: string): Promise<CurriculumLink[]> {
  return db.curriculumLinks.where('[userId+topicId]').equals([userId, topicId]).toArray();
}

export async function getAllLinks(userId: string): Promise<CurriculumLink[]> {
  return db.curriculumLinks.where('userId').equals(userId).toArray();
}

export async function deleteLink(linkId: string): Promise<void> {
  await db.curriculumLinks.delete(linkId);
}

// ============================================================================
// Resolve or Create curriculum nodes from AcademicMeta
// ============================================================================

export async function resolveOrCreateCurriculumNodes(
  userId: string,
  meta: {
    program?: string;
    subject?: string;
    module?: string;
    chapter?: string;
    topic?: string;
    examScope?: string;
    priorityDefault?: ConceptualPriority;
    conceptualDifficultyDefault?: ConceptualDifficulty;
  }
): Promise<{
  programId?: string;
  subjectId?: string;
  moduleId?: string;
  chapterId?: string;
  topicId?: string;
}> {
  const result: {
    programId?: string;
    subjectId?: string;
    moduleId?: string;
    chapterId?: string;
    topicId?: string;
  } = {};

  if (!meta.subject) return result;

  // Find or create program
  let programId: string | undefined;
  if (meta.program) {
    const programs = await db.curriculumPrograms.where('userId').equals(userId).toArray();
    const existing = programs.find(p => p.name.toLowerCase() === meta.program!.toLowerCase());
    if (existing) {
      programId = existing.id;
    } else {
      const prog = await createProgram(userId, { name: meta.program, description: '' });
      programId = prog.id;
    }
  } else {
    // Use default program or first available
    const programs = await db.curriculumPrograms.where('userId').equals(userId).toArray();
    if (programs.length > 0) {
      programId = programs[0].id;
    } else {
      const prog = await createProgram(userId, { name: 'Mi Programa', description: 'Programa por defecto' });
      programId = prog.id;
    }
  }
  result.programId = programId;

  // Find or create subject
  if (meta.subject && programId) {
    const subjects = await db.curriculumSubjects.where('[userId+programId]').equals([userId, programId]).toArray();
    const existing = subjects.find(s => s.name.toLowerCase() === meta.subject!.toLowerCase());
    if (existing) {
      result.subjectId = existing.id;
    } else {
      const subj = await createSubject(userId, { programId, name: meta.subject, sortOrder: subjects.length });
      result.subjectId = subj.id;
    }
  }

  // Find or create module
  if (meta.module && result.subjectId) {
    const modules = await db.curriculumModules.where('[userId+subjectId]').equals([userId, result.subjectId]).toArray();
    const existing = modules.find(m => m.name.toLowerCase() === meta.module!.toLowerCase());
    if (existing) {
      result.moduleId = existing.id;
    } else {
      const mod = await createModule(userId, { subjectId: result.subjectId, name: meta.module, sortOrder: modules.length });
      result.moduleId = mod.id;
    }
  }

  // Find or create chapter
  if (meta.chapter && result.moduleId) {
    const chapters = await db.curriculumChapters.where('[userId+moduleId]').equals([userId, result.moduleId]).toArray();
    const existing = chapters.find(c => c.name.toLowerCase() === meta.chapter!.toLowerCase());
    if (existing) {
      result.chapterId = existing.id;
    } else {
      const ch = await createChapter(userId, {
        moduleId: result.moduleId,
        name: meta.chapter,
        examScope: meta.examScope,
        sortOrder: chapters.length,
      });
      result.chapterId = ch.id;
    }
  }

  // Find or create topic
  if (meta.topic && result.chapterId) {
    const topics = await db.curriculumTopics.where('[userId+chapterId]').equals([userId, result.chapterId]).toArray();
    const existing = topics.find(t => t.name.toLowerCase() === meta.topic!.toLowerCase());
    if (existing) {
      result.topicId = existing.id;
    } else {
      const t = await createTopic(userId, {
        chapterId: result.chapterId,
        name: meta.topic,
        priorityDefault: meta.priorityDefault,
        conceptualDifficultyDefault: meta.conceptualDifficultyDefault,
        sortOrder: topics.length,
      });
      result.topicId = t.id;
    }
  }

  return result;
}

// ============================================================================
// Bootstrap from existing AcademicMeta
// ============================================================================

export async function bootstrapFromAcademicMeta(userId: string): Promise<{
  linksCreated: number;
  nodesCreated: number;
}> {
  let linksCreated = 0;
  let nodesCreated = 0;

  // Process decks with academic metadata
  const decks = await db.decks.where('userId').equals(userId).toArray();
  for (const deck of decks) {
    const meta = deck.metadata as Record<string, unknown>;
    if (!meta?.subject) continue;

    // Check if deck already has a curriculum link
    const existingLinks = await db.curriculumLinks.where('[userId+deckId]').equals([userId, deck.id]).toArray();
    if (existingLinks.length > 0) continue;

    const nodesBefore = await countAllNodes(userId);
    const resolved = await resolveOrCreateCurriculumNodes(userId, {
      subject: meta.subject as string,
      module: meta.module as string | undefined,
      chapter: meta.chapter as string | undefined,
    });
    const nodesAfter = await countAllNodes(userId);
    nodesCreated += nodesAfter - nodesBefore;

    await createLink(userId, {
      deckId: deck.id,
      ...resolved,
    });
    linksCreated++;
  }

  // Process notes with academic sourceMetadata
  const notes = await db.notes.where('userId').equals(userId).toArray();
  for (const note of notes) {
    const academic = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    if (!academic?.subject) continue;

    const existingLinks = await db.curriculumLinks.where('[userId+noteId]').equals([userId, note.id]).toArray();
    if (existingLinks.length > 0) continue;

    const nodesBefore = await countAllNodes(userId);
    const resolved = await resolveOrCreateCurriculumNodes(userId, {
      subject: academic.subject as string,
      module: academic.module as string | undefined,
      chapter: academic.chapter as string | undefined,
      topic: academic.topic as string | undefined,
      examScope: academic.examScope as string | undefined,
    });
    const nodesAfter = await countAllNodes(userId);
    nodesCreated += nodesAfter - nodesBefore;

    await createLink(userId, {
      noteId: note.id,
      ...resolved,
    });
    linksCreated++;
  }

  return { linksCreated, nodesCreated };
}

async function countAllNodes(userId: string): Promise<number> {
  const [p, s, m, c, t] = await Promise.all([
    db.curriculumPrograms.where('userId').equals(userId).count(),
    db.curriculumSubjects.where('userId').equals(userId).count(),
    db.curriculumModules.where('userId').equals(userId).count(),
    db.curriculumChapters.where('userId').equals(userId).count(),
    db.curriculumTopics.where('userId').equals(userId).count(),
  ]);
  return p + s + m + c + t;
}

// ============================================================================
// Progress Calculation
// ============================================================================

async function getCardsForNoteIds(noteIds: Set<string>): Promise<Card[]> {
  if (noteIds.size === 0) return [];
  const allCards: Card[] = [];
  for (const noteId of noteIds) {
    const cards = await db.cards.where('noteId').equals(noteId).toArray();
    allCards.push(...cards);
  }
  return allCards;
}

export function computeProgressFromCards(
  entityId: string,
  entityName: string,
  cards: Card[],
  notes: Note[],
  childCount: number
): CurriculumProgress {
  const activeCards = cards.filter(c => !c.suspended);
  const total = activeCards.length;

  if (total === 0) {
    return {
      entityId, entityName, totalCards: 0, newCards: 0, matureCards: 0,
      overdueCards: 0, riskCards: 0, highPriorityPending: 0,
      aiPendingReview: 0, coverage: 0, masteryScore: 0,
      avgRetrievability: 0, childCount,
    };
  }

  const nowStr = new Date().toISOString();
  const nonNew = activeCards.filter(c => c.state !== 'new');
  const avgR = nonNew.length > 0
    ? nonNew.reduce((sum, c) => sum + calculateRetrievability(c), 0) / nonNew.length
    : 0;
  const coverage = nonNew.length / total;
  const mature = activeCards.filter(c => c.state === 'review' && c.stability >= 21).length;
  const maturityRatio = mature / total;
  const riskCards = nonNew.filter(c => calculateRetrievability(c) < 0.7).length;
  const riskRatio = nonNew.length > 0 ? riskCards / nonNew.length : 0;
  const overdueCards = activeCards.filter(c => c.state !== 'new' && c.dueAt < nowStr).length;

  const score = Math.min(100, Math.max(0, Math.round(
    avgR * 40 + coverage * 25 + maturityRatio * 20 + (1 - riskRatio) * 15
  )));

  // Count high-priority pending
  const noteAcademicMap = new Map<string, Record<string, unknown>>();
  for (const note of notes) {
    const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
    if (acad) noteAcademicMap.set(note.id, acad);
  }

  let highPriorityPending = 0;
  let aiPendingReview = 0;
  for (const card of activeCards) {
    const note = notes.find(n => n.id === card.noteId);
    if (!note) continue;
    const acad = noteAcademicMap.get(note.id);
    const priority = acad?.priority as string | undefined;
    if ((priority === 'high' || priority === 'critical') && (card.state === 'new' || calculateRetrievability(card) < 0.7)) {
      highPriorityPending++;
    }
    if (acad?.aiReviewStatus === 'pending-review') {
      aiPendingReview++;
    }
  }

  return {
    entityId,
    entityName,
    totalCards: total,
    newCards: activeCards.filter(c => c.state === 'new').length,
    matureCards: mature,
    overdueCards,
    riskCards,
    highPriorityPending,
    aiPendingReview,
    coverage: Math.round(coverage * 100) / 100,
    masteryScore: score,
    avgRetrievability: Math.round(avgR * 100) / 100,
    childCount,
  };
}

export async function getProgramProgress(
  userId: string,
  programId: string
): Promise<CurriculumProgress> {
  const program = await db.curriculumPrograms.get(programId);
  if (!program) throw new Error('Programa no encontrado');

  const links = await db.curriculumLinks.where('userId').equals(userId)
    .filter(l => l.programId === programId)
    .toArray();

  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  // Also collect notes from linked decks
  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  const notes = await getNotesByIds(noteIds);
  const subjects = await db.curriculumSubjects.where('[userId+programId]').equals([userId, programId]).toArray();

  return computeProgressFromCards(programId, program.name, cards, notes, subjects.length);
}

export async function getSubjectProgress(
  userId: string,
  subjectId: string
): Promise<CurriculumProgress> {
  const subject = await db.curriculumSubjects.get(subjectId);
  if (!subject) throw new Error('Materia no encontrada');

  const links = await db.curriculumLinks.where('[userId+subjectId]').equals([userId, subjectId]).toArray();
  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  const notes = await getNotesByIds(noteIds);
  const modules = await db.curriculumModules.where('[userId+subjectId]').equals([userId, subjectId]).toArray();

  return computeProgressFromCards(subjectId, subject.name, cards, notes, modules.length);
}

export async function getModuleProgress(
  userId: string,
  moduleId: string
): Promise<CurriculumProgress> {
  const mod = await db.curriculumModules.get(moduleId);
  if (!mod) throw new Error('Módulo no encontrado');

  const links = await db.curriculumLinks.where('[userId+moduleId]').equals([userId, moduleId]).toArray();
  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  const notes = await getNotesByIds(noteIds);
  const chapters = await db.curriculumChapters.where('[userId+moduleId]').equals([userId, moduleId]).toArray();

  return computeProgressFromCards(moduleId, mod.name, cards, notes, chapters.length);
}

export async function getChapterProgress(
  userId: string,
  chapterId: string
): Promise<CurriculumProgress> {
  const chapter = await db.curriculumChapters.get(chapterId);
  if (!chapter) throw new Error('Capítulo no encontrado');

  const links = await db.curriculumLinks.where('[userId+chapterId]').equals([userId, chapterId]).toArray();
  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  const notes = await getNotesByIds(noteIds);
  const topics = await db.curriculumTopics.where('[userId+chapterId]').equals([userId, chapterId]).toArray();

  return computeProgressFromCards(chapterId, chapter.name, cards, notes, topics.length);
}

export async function getTopicProgress(
  userId: string,
  topicId: string
): Promise<CurriculumProgress> {
  const topic = await db.curriculumTopics.get(topicId);
  if (!topic) throw new Error('Tema no encontrado');

  const links = await db.curriculumLinks.where('[userId+topicId]').equals([userId, topicId]).toArray();
  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  const notes = await getNotesByIds(noteIds);

  return computeProgressFromCards(topicId, topic.name, cards, notes, 0);
}

async function getNotesByIds(ids: Set<string>): Promise<Note[]> {
  const notes: Note[] = [];
  for (const id of ids) {
    const note = await db.notes.get(id);
    if (note) notes.push(note);
  }
  return notes;
}

// ============================================================================
// Academic Study Queue — Build queue by academic scope
// ============================================================================

export async function getCardIdsByScope(
  userId: string,
  scope: {
    type: 'subject' | 'module' | 'chapter' | 'topic' | 'priority' | 'ai_pending' | 'curriculum_gap';
    id?: string;
    priority?: ConceptualPriority;
  }
): Promise<string[]> {
  if (scope.type === 'priority') {
    // Get all notes with the specified priority
    const notes = await db.notes.where('userId').equals(userId).toArray();
    const targetPriority = scope.priority || 'high';
    const matchingNoteIds = notes.filter(n => {
      const acad = (n.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
      const p = acad?.priority as string | undefined;
      if (targetPriority === 'high') return p === 'high' || p === 'critical';
      return p === targetPriority;
    }).map(n => n.id);

    const cards = await db.cards.where('userId').equals(userId)
      .filter(c => matchingNoteIds.includes(c.noteId) && !c.suspended)
      .toArray();
    return cards.map(c => c.id);
  }

  if (scope.type === 'ai_pending') {
    const notes = await db.notes.where('userId').equals(userId).toArray();
    const pendingNoteIds = notes.filter(n => {
      const acad = (n.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
      return acad?.aiReviewStatus === 'pending-review';
    }).map(n => n.id);

    const cards = await db.cards.where('userId').equals(userId)
      .filter(c => pendingNoteIds.includes(c.noteId) && !c.suspended)
      .toArray();
    return cards.map(c => c.id);
  }

  if (scope.type === 'curriculum_gap') {
    // Cards that have no curriculum link
    const allLinks = await db.curriculumLinks.where('userId').equals(userId).toArray();
    const linkedNoteIds = new Set(allLinks.filter(l => l.noteId).map(l => l.noteId!));
    const cards = await db.cards.where('userId').equals(userId)
      .filter(c => !linkedNoteIds.has(c.noteId) && !c.suspended)
      .toArray();
    return cards.map(c => c.id);
  }

  // Subject/module/chapter/topic — use curriculum links
  if (!scope.id) return [];

  let links: CurriculumLink[];
  switch (scope.type) {
    case 'subject':
      links = await db.curriculumLinks.where('[userId+subjectId]').equals([userId, scope.id]).toArray();
      break;
    case 'module':
      links = await db.curriculumLinks.where('[userId+moduleId]').equals([userId, scope.id]).toArray();
      break;
    case 'chapter':
      links = await db.curriculumLinks.where('[userId+chapterId]').equals([userId, scope.id]).toArray();
      break;
    case 'topic':
      links = await db.curriculumLinks.where('[userId+topicId]').equals([userId, scope.id]).toArray();
      break;
    default:
      return [];
  }

  const noteIds = new Set(links.filter(l => l.noteId).map(l => l.noteId!));
  const deckIds = new Set(links.filter(l => l.deckId).map(l => l.deckId!));

  // Also get notes from linked decks
  for (const deckId of deckIds) {
    const deckNotes = await db.notes.where('deckId').equals(deckId).toArray();
    deckNotes.forEach(n => noteIds.add(n.id));
  }

  const cards = await getCardsForNoteIds(noteIds);
  return cards.filter(c => !c.suspended).map(c => c.id);
}

// ============================================================================
// Full hierarchy for display
// ============================================================================

export interface CurriculumTree {
  program: CurriculumProgram;
  subjects: Array<{
    subject: CurriculumSubject;
    modules: Array<{
      module: CurriculumModule;
      chapters: Array<{
        chapter: CurriculumChapter;
        topics: CurriculumTopic[];
      }>;
    }>;
  }>;
}

export async function getProgramTree(userId: string, programId: string): Promise<CurriculumTree | null> {
  const program = await db.curriculumPrograms.get(programId);
  if (!program) return null;

  const subjects = await getSubjects(userId, programId);
  const tree: CurriculumTree = { program, subjects: [] };

  for (const subject of subjects) {
    const modules = await getModules(userId, subject.id);
    const subjectNode: CurriculumTree['subjects'][number] = { subject, modules: [] };

    for (const mod of modules) {
      const chapters = await getChapters(userId, mod.id);
      const moduleNode: typeof subjectNode.modules[number] = { module: mod, chapters: [] };

      for (const chapter of chapters) {
        const topics = await getTopics(userId, chapter.id);
        moduleNode.chapters.push({ chapter, topics });
      }

      subjectNode.modules.push(moduleNode);
    }

    tree.subjects.push(subjectNode);
  }

  return tree;
}
