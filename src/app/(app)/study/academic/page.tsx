'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  GraduationCap,
  BookOpen,
  Layers,
  FileText,
  Target,
  AlertTriangle,
  Play,
  ArrowLeft,
} from 'lucide-react';
import { useAppStore, useStudyStore } from '@/lib/store';
import type { StudyScope, CurriculumProgram, CurriculumSubject, CurriculumModule, CurriculumChapter } from '@/types';

export default function AcademicStudyPage() {
  const router = useRouter();
  const { user } = useAppStore();
  const [programs, setPrograms] = useState<CurriculumProgram[]>([]);
  const [subjects, setSubjects] = useState<CurriculumSubject[]>([]);
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [chapters, setChapters] = useState<CurriculumChapter[]>([]);
  const [selectedScope, setSelectedScope] = useState<StudyScope | null>(null);
  const [cardCount, setCardCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  // Selected hierarchy
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [scopeType, setScopeType] = useState<StudyScope['type'] | ''>('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const { getPrograms } = await import('@/lib/services/curriculum-service');
        const progs = await getPrograms(user.id);
        setPrograms(progs);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user || !selectedProgramId) { setSubjects([]); return; }
    (async () => {
      const { getSubjects } = await import('@/lib/services/curriculum-service');
      setSubjects(await getSubjects(user.id, selectedProgramId));
    })();
  }, [user, selectedProgramId]);

  useEffect(() => {
    if (!user || !selectedSubjectId) { setModules([]); return; }
    (async () => {
      const { getModules } = await import('@/lib/services/curriculum-service');
      setModules(await getModules(user.id, selectedSubjectId));
    })();
  }, [user, selectedSubjectId]);

  useEffect(() => {
    if (!user || !selectedModuleId) { setChapters([]); return; }
    (async () => {
      const { getChapters } = await import('@/lib/services/curriculum-service');
      setChapters(await getChapters(user.id, selectedModuleId));
    })();
  }, [user, selectedModuleId]);

  // Preview card count for selected scope
  useEffect(() => {
    if (!user || !selectedScope) { setCardCount(0); return; }
    (async () => {
      const { getCardIdsByScope } = await import('@/lib/services/curriculum-service');
      const ids = await getCardIdsByScope(user.id, selectedScope);
      setCardCount(ids.length);
    })();
  }, [user, selectedScope]);

  const selectScopeFromHierarchy = useCallback(() => {
    if (scopeType === 'priority') {
      setSelectedScope({ type: 'priority', priority: 'high' });
    } else if (scopeType === 'ai_pending') {
      setSelectedScope({ type: 'ai_pending' });
    } else if (scopeType === 'curriculum_gap') {
      setSelectedScope({ type: 'curriculum_gap' });
    } else if (selectedChapterId) {
      setSelectedScope({ type: 'chapter', id: selectedChapterId });
    } else if (selectedModuleId) {
      setSelectedScope({ type: 'module', id: selectedModuleId });
    } else if (selectedSubjectId) {
      setSelectedScope({ type: 'subject', id: selectedSubjectId });
    } else {
      setSelectedScope(null);
    }
  }, [scopeType, selectedChapterId, selectedModuleId, selectedSubjectId]);

  useEffect(() => {
    selectScopeFromHierarchy();
  }, [selectScopeFromHierarchy]);

  const startStudy = async () => {
    if (!user || !selectedScope) return;
    setStarting(true);
    try {
      const { buildAcademicStudyQueue, startAcademicStudySession } = await import('@/lib/services/study-service');
      const queue = await buildAcademicStudyQueue(user.id, selectedScope, { newCards: 20, reviews: 100 });
      if (queue.length === 0) {
        alert('No hay tarjetas para estudiar con este alcance.');
        setStarting(false);
        return;
      }
      const session = await startAcademicStudySession(user.id, selectedScope);
      // Store session and queue in study store
      const studyStore = useStudyStore.getState();
      studyStore.setSession(session);
      studyStore.setPreloadedQueue(queue);
      // Navigate to the actual study UI — use first card's deck as fallback route
      router.push(`/study/${queue[0].deck.id}?sessionId=${session.id}`);
    } catch (err) {
      console.error('Failed to start academic study:', err);
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="h-6 w-6" />
            Estudio Académico
          </h1>
          <p className="text-sm text-muted-foreground">Selecciona el alcance de tu sesión</p>
        </div>
      </div>

      {/* Special scopes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modos Especiales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={scopeType === 'priority' ? 'default' : 'outline'}
              className="justify-start gap-2"
              onClick={() => { setScopeType(scopeType === 'priority' ? '' : 'priority'); setSelectedScope(scopeType === 'priority' ? null : { type: 'priority', priority: 'high' }); }}
            >
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Alta Prioridad
            </Button>
            <Button
              variant={scopeType === 'ai_pending' ? 'default' : 'outline'}
              className="justify-start gap-2"
              onClick={() => { setScopeType(scopeType === 'ai_pending' ? '' : 'ai_pending'); setSelectedScope(scopeType === 'ai_pending' ? null : { type: 'ai_pending' }); }}
            >
              <Target className="h-4 w-4 text-amber-500" />
              IA Pendiente
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hierarchy selection */}
      {programs.length > 0 && scopeType !== 'priority' && scopeType !== 'ai_pending' && scopeType !== 'curriculum_gap' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por Currículo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Program */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Programa</label>
              <div className="flex gap-1 flex-wrap mt-1">
                {programs.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={selectedProgramId === p.id ? 'default' : 'outline'}
                    onClick={() => { setSelectedProgramId(p.id); setSelectedSubjectId(''); setSelectedModuleId(''); setSelectedChapterId(''); setScopeType(''); }}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Subject */}
            {subjects.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3" /> Materia
                </label>
                <div className="flex gap-1 flex-wrap mt-1">
                  {subjects.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant={selectedSubjectId === s.id ? 'default' : 'outline'}
                      onClick={() => { setSelectedSubjectId(s.id); setSelectedModuleId(''); setSelectedChapterId(''); setScopeType(''); }}
                    >
                      {s.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Module */}
            {modules.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Módulo
                </label>
                <div className="flex gap-1 flex-wrap mt-1">
                  {modules.map((m) => (
                    <Button
                      key={m.id}
                      size="sm"
                      variant={selectedModuleId === m.id ? 'default' : 'outline'}
                      onClick={() => { setSelectedModuleId(m.id); setSelectedChapterId(''); setScopeType(''); }}
                    >
                      {m.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Chapter */}
            {chapters.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Capítulo
                </label>
                <div className="flex gap-1 flex-wrap mt-1">
                  {chapters.map((c) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant={selectedChapterId === c.id ? 'default' : 'outline'}
                      onClick={() => { setSelectedChapterId(c.id); setScopeType(''); }}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Start button */}
      {selectedScope && (
        <Card className="border-primary/50">
          <CardContent className="pt-6 text-center space-y-3">
            <p className="text-lg font-semibold">
              {cardCount} tarjeta{cardCount !== 1 ? 's' : ''} disponible{cardCount !== 1 ? 's' : ''}
            </p>
            <Button
              size="lg"
              className="gap-2"
              onClick={startStudy}
              disabled={cardCount === 0 || starting}
            >
              <Play className="h-5 w-5" />
              {starting ? 'Iniciando...' : 'Comenzar Sesión'}
            </Button>
          </CardContent>
        </Card>
      )}

      {programs.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Sin programas académicos.</p>
            <p className="text-sm mt-1">
              <Link href="/curriculum" className="text-primary hover:underline">Crea tu currículo</Link> o importa tarjetas con datos académicos.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
