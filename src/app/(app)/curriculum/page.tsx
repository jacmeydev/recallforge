'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  GraduationCap,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  BookOpen,
  Layers,
  FileText,
  Target,
  BarChart3,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { CurriculumProgram, CurriculumSubject, CurriculumModule, CurriculumChapter, CurriculumTopic, CurriculumProgress } from '@/types';

interface ProgramWithProgress extends CurriculumProgram {
  progress: CurriculumProgress;
  subjects: SubjectNode[];
}

interface SubjectNode extends CurriculumSubject {
  progress: CurriculumProgress;
  modules: ModuleNode[];
}

interface ModuleNode extends CurriculumModule {
  progress: CurriculumProgress;
  chapters: ChapterNode[];
}

interface ChapterNode extends CurriculumChapter {
  progress: CurriculumProgress;
  topics: TopicNode[];
}

interface TopicNode extends CurriculumTopic {
  progress: CurriculumProgress;
}

export default function CurriculumPage() {
  const { user } = useAppStore();
  const [programs, setPrograms] = useState<ProgramWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [newProgramName, setNewProgramName] = useState('');
  const [addingTo, setAddingTo] = useState<{ type: string; parentId: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [editing, setEditing] = useState<{ type: string; id: string; name: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const {
        getPrograms, getSubjects, getModules, getChapters, getTopics,
        getProgramProgress, getSubjectProgress, getModuleProgress, getChapterProgress, getTopicProgress,
      } = await import('@/lib/services/curriculum-service');

      const progs = await getPrograms(user.id);
      const programNodes: ProgramWithProgress[] = [];

      for (const prog of progs) {
        const progProgress = await getProgramProgress(user.id, prog.id);
        const subjects = await getSubjects(user.id, prog.id);
        const subjectNodes: SubjectNode[] = [];

        for (const subj of subjects) {
          const subjProgress = await getSubjectProgress(user.id, subj.id);
          const modules = await getModules(user.id, subj.id);
          const moduleNodes: ModuleNode[] = [];

          for (const mod of modules) {
            const modProgress = await getModuleProgress(user.id, mod.id);
            const chapters = await getChapters(user.id, mod.id);
            const chapterNodes: ChapterNode[] = [];

            for (const chap of chapters) {
              const chapProgress = await getChapterProgress(user.id, chap.id);
              const topics = await getTopics(user.id, chap.id);
              const topicNodes: TopicNode[] = [];

              for (const topic of topics) {
                const topicProgress = await getTopicProgress(user.id, topic.id);
                topicNodes.push({ ...topic, progress: topicProgress });
              }

              chapterNodes.push({ ...chap, progress: chapProgress, topics: topicNodes });
            }

            moduleNodes.push({ ...mod, progress: modProgress, chapters: chapterNodes });
          }

          subjectNodes.push({ ...subj, progress: subjProgress, modules: moduleNodes });
        }

        programNodes.push({ ...prog, progress: progProgress, subjects: subjectNodes });
      }

      setPrograms(programNodes);
    } catch (err) {
      console.error('Failed to load curriculum:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateProgram = async () => {
    if (!user || !newProgramName.trim()) return;
    const { createProgram } = await import('@/lib/services/curriculum-service');
    await createProgram(user.id, { name: newProgramName.trim() });
    setNewProgramName('');
    loadData();
  };

  const handleCreateChild = async () => {
    if (!user || !addingTo || !newItemName.trim()) return;
    const cs = await import('@/lib/services/curriculum-service');
    const name = newItemName.trim();

    switch (addingTo.type) {
      case 'subject':
        await cs.createSubject(user.id, { name, programId: addingTo.parentId });
        break;
      case 'module':
        await cs.createModule(user.id, { name, subjectId: addingTo.parentId });
        break;
      case 'chapter':
        await cs.createChapter(user.id, { name, moduleId: addingTo.parentId });
        break;
      case 'topic':
        await cs.createTopic(user.id, { name, chapterId: addingTo.parentId });
        break;
    }

    setNewItemName('');
    setAddingTo(null);
    loadData();
  };

  const handleDelete = async (type: string, id: string) => {
    if (!user) return;
    const cs = await import('@/lib/services/curriculum-service');
    switch (type) {
      case 'program': await cs.deleteProgram(user.id, id); break;
      case 'subject': await cs.deleteSubject(user.id, id); break;
      case 'module': await cs.deleteModule(user.id, id); break;
      case 'chapter': await cs.deleteChapter(user.id, id); break;
      case 'topic': await cs.deleteTopic(user.id, id); break;
    }
    loadData();
  };

  const handleEdit = async () => {
    if (!user || !editing || !editing.name.trim()) return;
    const cs = await import('@/lib/services/curriculum-service');
    const name = editing.name.trim();
    switch (editing.type) {
      case 'program': await cs.updateProgram(editing.id, { name }); break;
      case 'subject': await cs.updateSubject(editing.id, { name }); break;
      case 'module': await cs.updateModule(editing.id, { name }); break;
      case 'chapter': await cs.updateChapter(editing.id, { name }); break;
      case 'topic': await cs.updateTopic(editing.id, { name }); break;
    }
    setEditing(null);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="h-6 w-6" />
          Currículo Académico
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona tu plan de estudios: programas, materias, módulos, capítulos y temas
        </p>
      </div>

      {/* Create Program */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del programa (ej. Medicina 2025)"
              value={newProgramName}
              onChange={(e) => setNewProgramName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProgram()}
            />
            <Button onClick={handleCreateProgram} disabled={!newProgramName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Crear Programa
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Inline add form */}
      {addingTo && (
        <Card className="border-primary/50">
          <CardContent className="pt-6">
            <div className="flex gap-2 items-center">
              <span className="text-sm text-muted-foreground">
                Nuevo {addingTo.type === 'subject' ? 'materia' : addingTo.type === 'module' ? 'módulo' : addingTo.type === 'chapter' ? 'capítulo' : 'tema'}:
              </span>
              <Input
                placeholder="Nombre..."
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateChild()}
                autoFocus
              />
              <Button size="sm" onClick={handleCreateChild} disabled={!newItemName.trim()}>
                Crear
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddingTo(null); setNewItemName(''); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Programs tree */}
      {programs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Sin programas académicos aún.</p>
            <p className="text-sm">Crea un programa o importa tarjetas con información curricular.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {programs.map((prog) => (
            <Card key={prog.id}>
              <CardContent className="pt-4 pb-3">
                {/* Program header */}
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleExpand(prog.id)} className="p-1">
                    {expandedNodes.has(prog.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <GraduationCap className="h-4 w-4 text-primary" />
                  {editing?.id === prog.id ? (
                    <InlineEdit value={editing.name} onChange={(name) => setEditing({ ...editing, name })} onSave={handleEdit} onCancel={() => setEditing(null)} />
                  ) : (
                    <span className="font-semibold flex-1">{prog.name}</span>
                  )}
                  {editing?.id !== prog.id && <ProgressBadge progress={prog.progress} />}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing({ type: 'program', id: prog.id, name: prog.name })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAddingTo({ type: 'subject', parentId: prog.id })}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => handleDelete('program', prog.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Subjects */}
                {expandedNodes.has(prog.id) && (
                  <div className="ml-6 mt-2 space-y-2">
                    {prog.subjects.map((subj) => (
                      <div key={subj.id}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleExpand(subj.id)} className="p-1">
                            {expandedNodes.has(subj.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                          {editing?.id === subj.id ? (
                            <InlineEdit value={editing.name} onChange={(name) => setEditing({ ...editing, name })} onSave={handleEdit} onCancel={() => setEditing(null)} />
                          ) : (
                            <span className="text-sm font-medium flex-1">{subj.name}</span>
                          )}
                          {editing?.id !== subj.id && <ProgressBadge progress={subj.progress} small />}
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing({ type: 'subject', id: subj.id, name: subj.name })}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingTo({ type: 'module', parentId: subj.id })}>
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => handleDelete('subject', subj.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Modules */}
                        {expandedNodes.has(subj.id) && (
                          <div className="ml-6 mt-1 space-y-1">
                            {subj.modules.map((mod) => (
                              <div key={mod.id}>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => toggleExpand(mod.id)} className="p-1">
                                    {expandedNodes.has(mod.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  </button>
                                  <Layers className="h-3 w-3 text-purple-500" />
                                  {editing?.id === mod.id ? (
                                    <InlineEdit value={editing.name} onChange={(name) => setEditing({ ...editing, name })} onSave={handleEdit} onCancel={() => setEditing(null)} />
                                  ) : (
                                    <span className="text-sm flex-1">{mod.name}</span>
                                  )}
                                  {editing?.id !== mod.id && <ProgressBadge progress={mod.progress} small />}
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing({ type: 'module', id: mod.id, name: mod.name })}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingTo({ type: 'chapter', parentId: mod.id })}>
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => handleDelete('module', mod.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>

                                {/* Chapters */}
                                {expandedNodes.has(mod.id) && (
                                  <div className="ml-6 mt-1 space-y-1">
                                    {mod.chapters.map((chap) => (
                                      <div key={chap.id}>
                                        <div className="flex items-center gap-2">
                                          <button onClick={() => toggleExpand(chap.id)} className="p-1">
                                            {expandedNodes.has(chap.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                          </button>
                                          <FileText className="h-3 w-3 text-green-500" />
                                          {editing?.id === chap.id ? (
                                            <InlineEdit value={editing.name} onChange={(name) => setEditing({ ...editing, name })} onSave={handleEdit} onCancel={() => setEditing(null)} />
                                          ) : (
                                            <span className="text-sm flex-1">{chap.name}</span>
                                          )}
                                          {editing?.id !== chap.id && <ProgressBadge progress={chap.progress} small />}
                                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing({ type: 'chapter', id: chap.id, name: chap.name })}>
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingTo({ type: 'topic', parentId: chap.id })}>
                                            <Plus className="h-3 w-3" />
                                          </Button>
                                          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => handleDelete('chapter', chap.id)}>
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>

                                        {/* Topics */}
                                        {expandedNodes.has(chap.id) && (
                                          <div className="ml-6 mt-1 space-y-0.5">
                                            {chap.topics.map((topic) => (
                                              <div key={topic.id} className="flex items-center gap-2 py-0.5">
                                                <Target className="h-3 w-3 text-amber-500" />
                                                {editing?.id === topic.id ? (
                                                  <InlineEdit value={editing.name} onChange={(name) => setEditing({ ...editing, name })} onSave={handleEdit} onCancel={() => setEditing(null)} />
                                                ) : (
                                                  <span className="text-xs flex-1">{topic.name}</span>
                                                )}
                                                {editing?.id !== topic.id && <ProgressBadge progress={topic.progress} small />}
                                                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditing({ type: 'topic', id: topic.id, name: topic.name })}>
                                                  <Pencil className="h-2.5 w-2.5" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-5 w-5 text-red-500" onClick={() => handleDelete('topic', topic.id)}>
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </Button>
                                              </div>
                                            ))}
                                            {chap.topics.length === 0 && (
                                              <p className="text-[10px] text-muted-foreground pl-5">Sin temas</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {mod.chapters.length === 0 && (
                                      <p className="text-xs text-muted-foreground pl-5">Sin capítulos</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                            {subj.modules.length === 0 && (
                              <p className="text-xs text-muted-foreground pl-5">Sin módulos</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {prog.subjects.length === 0 && (
                      <p className="text-xs text-muted-foreground pl-5">Sin materias</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Bootstrap section */}
      <BootstrapSection userId={user?.id} onBootstrap={loadData} />
    </div>
  );
}

function ProgressBadge({ progress, small }: { progress: CurriculumProgress; small?: boolean }) {
  const scoreColor = progress.masteryScore >= 80 ? 'text-emerald-500' : progress.masteryScore >= 50 ? 'text-amber-500' : 'text-red-500';
  if (small) {
    return (
      <span className={`text-[10px] font-bold ${scoreColor}`}>
        {progress.masteryScore}%
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {progress.highPriorityPending > 0 && (
        <Badge variant="destructive" className="text-[10px] px-1 py-0">{progress.highPriorityPending} prioridad</Badge>
      )}
      {progress.aiPendingReview > 0 && (
        <Badge variant="secondary" className="text-[10px] px-1 py-0">{progress.aiPendingReview} IA</Badge>
      )}
      <span className={`text-sm font-bold ${scoreColor}`}>{progress.masteryScore}%</span>
    </div>
  );
}

function InlineEdit({ value, onChange, onSave, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
        className="h-7 text-sm"
        autoFocus
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onSave}>
        <Check className="h-3 w-3" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function BootstrapSection({ userId, onBootstrap }: { userId?: string; onBootstrap: () => void }) {
  const [bootstrapping, setBootstrapping] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleBootstrap = async () => {
    if (!userId) return;
    setBootstrapping(true);
    try {
      const { bootstrapFromAcademicMeta } = await import('@/lib/services/curriculum-service');
      const count = await bootstrapFromAcademicMeta(userId);
      setResult(`Se migraron ${count} nodos de tus datos académicos existentes.`);
      onBootstrap();
    } catch (err) {
      setResult('Error al migrar: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setBootstrapping(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Migrar desde AcademicMeta
        </CardTitle>
        <CardDescription>
          Si ya tienes tarjetas con materia/capítulo en sus metadatos académicos, puedes migrarlos automáticamente al currículo normalizado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleBootstrap} disabled={bootstrapping}>
          {bootstrapping ? 'Migrando...' : 'Migrar Datos Existentes'}
        </Button>
        {result && (
          <p className="text-sm text-muted-foreground mt-2">{result}</p>
        )}
      </CardContent>
    </Card>
  );
}
