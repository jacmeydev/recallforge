'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  ClipboardList,
  Activity,
  Clock,
  TrendingUp,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Link as LinkIcon,
} from 'lucide-react';

interface Recommendation {
  type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  data: Record<string, unknown>;
}

interface StudyPlanEntry {
  order: number;
  action: string;
  deckName?: string;
  cardCount: number;
  reason: string;
  estimatedMinutes: number;
}

interface AgentEvent {
  id: string;
  ts: string;
  type: string;
  entity_type: string;
  entity_id: string;
  source: string;
  payload: string;
}

interface AcademicBreakdownItem {
  id: string;
  name: string;
  totalCards: number;
  newCards: number;
  matureCards: number;
  overdueCards: number;
  masteryPercent: number;
  riskLevel: string;
  program?: string | null;
  subjectName?: string;
  moduleName?: string;
  chapterName?: string;
  examScope?: string | null;
  priorityDefault?: string | null;
  conceptualDifficultyDefault?: string | null;
}

interface CoverageBreakdownItem {
  id: string;
  name: string;
  subjectName?: string;
  moduleName?: string;
  chapterName?: string;
  totalCards: number;
  newCards: number;
  matureCards: number;
  overdueCards: number;
  masteryPercent: number;
  riskLevel: string;
  coveragePercent: number;
  overdueRatioPercent: number;
}

interface CoverageSnapshot {
  overall: {
    totalCards: number;
    newCards: number;
    matureCards: number;
    overdueCards: number;
    highRiskCards: number;
    pendingAiReviewCards: number;
    studiedCoveragePercent: number;
    overdueRatioPercent: number;
    curriculumLinkedCards: number;
    curriculumLinkedPercent: number;
    unlinkedCards: number;
  };
  atRisk: {
    subjects: CoverageBreakdownItem[];
    topics: CoverageBreakdownItem[];
  };
  subjects: CoverageBreakdownItem[];
  modules: CoverageBreakdownItem[];
  chapters: CoverageBreakdownItem[];
  topics: CoverageBreakdownItem[];
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
};

const actionLabels: Record<string, string> = {
  rescue: '🚨 Rescate',
  review: '📖 Repaso',
  learn_new: '🆕 Nuevas',
};

function asAcademicItems(value: unknown): AcademicBreakdownItem[] {
  return Array.isArray(value) ? value as AcademicBreakdownItem[] : [];
}

function renderBadge(value: string | null | undefined, fallback: string) {
  return value ? <Badge variant="outline">{value}</Badge> : <Badge variant="secondary">{fallback}</Badge>;
}

export default function AgentConsolePage() {
  const [activeTab, setActiveTab] = useState('recommendations');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [studyPlan, setStudyPlan] = useState<{ entries: StudyPlanEntry[]; totalMinutes: number; totalCards: number } | null>(null);
  const [academicSummary, setAcademicSummary] = useState<Record<string, unknown> | null>(null);
  const [coverageSnapshot, setCoverageSnapshot] = useState<CoverageSnapshot | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const subjectItems = asAcademicItems(academicSummary?.subjects);
  const moduleItems = asAcademicItems(academicSummary?.modules);
  const chapterItems = asAcademicItems(academicSummary?.chapters);
  const topicItems = asAcademicItems(academicSummary?.topics);

  const fetchData = useCallback(async (tab: string) => {
    setLoading(true);
    setError('');
    try {
      switch (tab) {
        case 'recommendations': {
          const res = await fetch('/api/agent/recommendations');
          if (!res.ok) throw new Error('Error cargando recomendaciones');
          const data = await res.json();
          setRecommendations(data.recommendations);
          break;
        }
        case 'study-plan': {
          const res = await fetch('/api/agent/study-plan?maxMinutes=60');
          if (!res.ok) throw new Error('Error cargando plan de estudio');
          const data = await res.json();
          setStudyPlan({ entries: data.entries, totalMinutes: data.totalMinutes, totalCards: data.totalCards });
          break;
        }
        case 'academic': {
          const [summaryRes, coverageRes] = await Promise.all([
            fetch('/api/agent/academic-summary'),
            fetch('/api/agent/coverage'),
          ]);
          if (!summaryRes.ok) throw new Error('Error cargando resumen académico');
          if (!coverageRes.ok) throw new Error('Error cargando coverage/risk académico');
          const summaryData = await summaryRes.json();
          const coverageData = await coverageRes.json();
          setAcademicSummary(summaryData);
          setCoverageSnapshot(coverageData);
          break;
        }
        case 'coverage': {
          const res = await fetch('/api/agent/coverage');
          if (!res.ok) throw new Error('Error cargando resumen académico');
          const data = await res.json();
          setCoverageSnapshot(data);
          break;
        }
        case 'audit': {
          const res = await fetch('/api/agent/events?type=agent_&limit=50');
          if (!res.ok) throw new Error('Error cargando eventos');
          const data = await res.json();
          setAgentEvents(data.events || []);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Bot className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Consola de Agente</h1>
          <p className="text-sm text-muted-foreground">
            Recomendaciones, plan de estudio, resumen académico y auditoría de acciones del agente.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 gap-2 sm:grid-cols-5">
          <TabsTrigger value="recommendations" className="gap-1">
            <AlertTriangle className="h-4 w-4" /> Recomendaciones
          </TabsTrigger>
          <TabsTrigger value="study-plan" className="gap-1">
            <ClipboardList className="h-4 w-4" /> Plan de Estudio
          </TabsTrigger>
          <TabsTrigger value="academic" className="gap-1">
            <TrendingUp className="h-4 w-4" /> Resumen Académico
          </TabsTrigger>
          <TabsTrigger value="coverage" className="gap-1">
            <ShieldAlert className="h-4 w-4" /> Coverage y Riesgo
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1">
            <Activity className="h-4 w-4" /> Auditoría
          </TabsTrigger>
        </TabsList>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        {/* ─── Recommendations ──────────────────────────────────── */}
        <TabsContent value="recommendations" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recomendaciones Inteligentes</h2>
            <Button variant="outline" size="sm" onClick={() => fetchData('recommendations')} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
          </div>

          {loading && recommendations.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recommendations.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                🎉 ¡No hay recomendaciones pendientes! Estás al día.
              </CardContent>
            </Card>
          ) : (
            recommendations.map((rec, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${priorityColors[rec.priority]}`}>
                      {rec.priority}
                    </span>
                    <CardTitle className="text-base">{rec.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{rec.description}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ─── Study Plan ───────────────────────────────────────── */}
        <TabsContent value="study-plan" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Plan de Estudio para Hoy</h2>
            <Button variant="outline" size="sm" onClick={() => fetchData('study-plan')} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
          </div>

          {loading && !studyPlan ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !studyPlan || studyPlan.entries.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                📚 No hay tarjetas pendientes. ¡Buen trabajo!
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex gap-4 text-sm">
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" /> {studyPlan.totalMinutes} min estimados
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <BookOpen className="h-3 w-3" /> {studyPlan.totalCards} tarjetas
                </Badge>
              </div>

              {studyPlan.entries.map((entry) => (
                <Card key={entry.order}>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {entry.order}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{actionLabels[entry.action] || entry.action}</span>
                        {entry.deckName && (
                          <span className="truncate text-sm text-muted-foreground">— {entry.deckName}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{entry.reason}</p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div className="font-medium">{entry.cardCount} tarjetas</div>
                      <div className="text-muted-foreground">~{entry.estimatedMinutes} min</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ─── Academic Summary ─────────────────────────────────── */}
        <TabsContent value="academic" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Resumen Académico</h2>
            <Button variant="outline" size="sm" onClick={() => fetchData('academic')} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
          </div>

          {loading && !academicSummary ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !academicSummary ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Sin datos académicos disponibles.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Card stats */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total', value: (academicSummary.cards as Record<string, number>)?.total ?? 0 },
                  { label: 'Nuevas', value: (academicSummary.cards as Record<string, number>)?.new ?? 0 },
                  { label: 'Maduras', value: (academicSummary.cards as Record<string, number>)?.mature ?? 0 },
                  { label: 'Vencidas', value: (academicSummary.cards as Record<string, number>)?.overdue ?? 0 },
                ].map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="py-3 text-center">
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {coverageSnapshot && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Salud Académica</CardTitle>
                    <CardDescription>Snapshot rápido de coverage, riesgo y densidad curricular.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MetricCard
                      label="Coverage estudiado"
                      value={`${coverageSnapshot.overall.studiedCoveragePercent.toFixed(1)}%`}
                      helper={`${coverageSnapshot.overall.matureCards} maduras`}
                    />
                    <MetricCard
                      label="Riesgo overdue"
                      value={`${coverageSnapshot.overall.overdueRatioPercent.toFixed(1)}%`}
                      helper={`${coverageSnapshot.overall.overdueCards} vencidas`}
                      tone={coverageSnapshot.overall.overdueRatioPercent > 25 ? 'alert' : 'default'}
                    />
                    <MetricCard
                      label="Cards linkeadas"
                      value={`${coverageSnapshot.overall.curriculumLinkedPercent.toFixed(1)}%`}
                      helper={`${coverageSnapshot.overall.curriculumLinkedCards}/${coverageSnapshot.overall.totalCards}`}
                      tone={coverageSnapshot.overall.curriculumLinkedPercent < 70 ? 'alert' : 'default'}
                    />
                    <MetricCard
                      label="Alto riesgo"
                      value={coverageSnapshot.overall.highRiskCards}
                      helper={`${coverageSnapshot.overall.pendingAiReviewCards} IA pendientes`}
                      tone={coverageSnapshot.overall.highRiskCards > 0 ? 'alert' : 'success'}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Activity */}
              {academicSummary.activity && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Actividad Reciente</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium">Últimos 7 días</div>
                      <div className="text-muted-foreground">
                        {(academicSummary.activity as Record<string, Record<string, number>>).last7Days?.reviews ?? 0} repasos
                        · {(academicSummary.activity as Record<string, Record<string, number>>).last7Days?.correctRate ?? 0}% correctos
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Últimos 30 días</div>
                      <div className="text-muted-foreground">
                        {(academicSummary.activity as Record<string, Record<string, number>>).last30Days?.reviews ?? 0} repasos
                        · {(academicSummary.activity as Record<string, Record<string, number>>).last30Days?.correctRate ?? 0}% correctos
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Gamification */}
              {academicSummary.gamification && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Gamificación</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-3 text-sm">
                    <Badge variant="outline">Nivel {(academicSummary.gamification as Record<string, number>).level}</Badge>
                    <Badge variant="outline">{(academicSummary.gamification as Record<string, number>).totalXP} XP</Badge>
                    <Badge variant="outline">🔥 Racha: {(academicSummary.gamification as Record<string, number>).currentStreak} días</Badge>
                    <Badge variant="outline">🏆 Mejor: {(academicSummary.gamification as Record<string, number>).longestStreak} días</Badge>
                  </CardContent>
                </Card>
              )}

              {/* Subjects */}
              {subjectItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Materias</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {subjectItems.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                        <div>
                          <span className="font-medium">{sub.name}</span>
                          {sub.program ? <span className="ml-2 text-xs text-muted-foreground">({sub.program})</span> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={sub.riskLevel === 'high' ? 'destructive' : 'outline'} className="text-xs">
                            {sub.masteryPercent}% dominio
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {sub.overdueCards} vencidas / {sub.totalCards}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {moduleItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Módulos</CardTitle>
                    <CardDescription>Profundidad curricular disponible para planificación e integraciones.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {moduleItems.slice(0, 10).map((module) => (
                      <div key={module.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{module.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{module.subjectName}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant={module.riskLevel === 'high' ? 'destructive' : 'outline'}>
                              {module.masteryPercent}% dominio
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {module.overdueCards} vencidas / {module.totalCards}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {chapterItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Capítulos</CardTitle>
                    <CardDescription>Resumen por capítulo para exámenes y cobertura académica.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {chapterItems.slice(0, 10).map((chapter) => (
                      <div key={chapter.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{chapter.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {chapter.subjectName} · {chapter.moduleName}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {renderBadge(chapter.examScope, 'Sin examScope')}
                            <Badge variant={chapter.riskLevel === 'high' ? 'destructive' : 'outline'}>
                              {chapter.masteryPercent}% dominio
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {chapter.overdueCards} vencidas / {chapter.totalCards} tarjetas
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {topicItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Temas</CardTitle>
                    <CardDescription>Temas listos para recomendaciones y study plan con grano fino.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {topicItems.slice(0, 12).map((topic) => (
                      <div key={topic.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{topic.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {topic.subjectName} · {topic.moduleName} · {topic.chapterName}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {renderBadge(topic.priorityDefault, 'Sin prioridad')}
                            {renderBadge(topic.conceptualDifficultyDefault, 'Sin dificultad')}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{topic.overdueCards} vencidas / {topic.totalCards} tarjetas</span>
                          <span>{topic.masteryPercent}% dominio</span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Decks */}
              {Array.isArray(academicSummary.decks) && (academicSummary.decks as Array<Record<string, unknown>>).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Mazos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {(academicSummary.decks as Array<Record<string, unknown>>).slice(0, 10).map((deck: Record<string, unknown>) => (
                      <div key={deck.id as string} className="flex items-center justify-between text-sm">
                        <span className="truncate">{deck.name as string}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {deck.totalCards as number} total · {deck.overdueCards as number} vencidas
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Coverage & Risk ─────────────────────────────────── */}
        <TabsContent value="coverage" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Coverage y Riesgo Académico</h2>
            <Button variant="outline" size="sm" onClick={() => fetchData('coverage')} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
          </div>

          {loading && !coverageSnapshot ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !coverageSnapshot ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Sin snapshot de coverage disponible.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard
                  label="Coverage estudiado"
                  value={`${coverageSnapshot.overall.studiedCoveragePercent.toFixed(1)}%`}
                  helper={`${coverageSnapshot.overall.newCards} nuevas`}
                />
                <MetricCard
                  label="Riesgo overdue"
                  value={`${coverageSnapshot.overall.overdueRatioPercent.toFixed(1)}%`}
                  helper={`${coverageSnapshot.overall.overdueCards} vencidas`}
                  tone={coverageSnapshot.overall.overdueRatioPercent > 25 ? 'alert' : 'default'}
                />
                <MetricCard
                  label="Link curricular"
                  value={`${coverageSnapshot.overall.curriculumLinkedPercent.toFixed(1)}%`}
                  helper={`${coverageSnapshot.overall.unlinkedCards} sin link`}
                  tone={coverageSnapshot.overall.curriculumLinkedPercent < 70 ? 'alert' : 'success'}
                />
                <MetricCard
                  label="Cards alto riesgo"
                  value={coverageSnapshot.overall.highRiskCards}
                  helper={`${coverageSnapshot.overall.pendingAiReviewCards} IA pendientes`}
                  tone={coverageSnapshot.overall.highRiskCards > 0 ? 'alert' : 'success'}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <CoveragePanel
                  title="Materias más en riesgo"
                  icon={ShieldAlert}
                  items={coverageSnapshot.atRisk.subjects}
                  emptyLabel="No hay materias críticas ahora mismo."
                />
                <CoveragePanel
                  title="Temas más en riesgo"
                  icon={ShieldCheck}
                  items={coverageSnapshot.atRisk.topics}
                  emptyLabel="No hay temas críticos ahora mismo."
                />
              </div>

              <CoveragePanel
                title="Coverage por tema"
                icon={LinkIcon}
                items={coverageSnapshot.topics.slice(0, 12)}
                emptyLabel="Todavía no hay topics con coverage calculado."
                showPath
              />
            </>
          )}
        </TabsContent>

        {/* ─── Audit Trail ──────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Auditoría de Acciones del Agente</h2>
            <Button variant="outline" size="sm" onClick={() => fetchData('audit')} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
          </div>

          {loading && agentEvents.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agentEvents.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No hay eventos de agente registrados aún.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="divide-y p-0">
                {agentEvents.map((evt) => {
                  let payload: Record<string, unknown> = {};
                  try { payload = JSON.parse(evt.payload); } catch { /* ignore */ }
                  return (
                    <div key={evt.id} className="flex items-start gap-3 p-3 text-sm">
                      <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{evt.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(evt.ts).toLocaleString()}
                          </span>
                        </div>
                        {Object.keys(payload).length > 0 && (
                          <pre className="mt-1 max-h-20 overflow-auto rounded bg-muted/50 p-1 text-xs">
                            {JSON.stringify(payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: 'default' | 'alert' | 'success';
}) {
  const toneClass =
    tone === 'alert'
      ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
        : '';

  return (
    <Card className={toneClass}>
      <CardContent className="py-3 text-center">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {helper ? <div className="mt-1 text-[11px] text-muted-foreground">{helper}</div> : null}
      </CardContent>
    </Card>
  );
}

function CoveragePanel({
  title,
  icon: Icon,
  items,
  emptyLabel,
  showPath = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: CoverageBreakdownItem[];
  emptyLabel: string;
  showPath?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.name}</div>
                  {showPath ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {[item.subjectName, item.moduleName, item.chapterName].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                </div>
                <Badge variant={item.riskLevel === 'high' ? 'destructive' : item.riskLevel === 'medium' ? 'outline' : 'secondary'}>
                  {item.riskLevel}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Coverage: {item.coveragePercent.toFixed(1)}%</span>
                <span>Overdue: {item.overdueRatioPercent.toFixed(1)}%</span>
                <span>Dominio: {item.masteryPercent}%</span>
                <span>{item.overdueCards}/{item.totalCards} vencidas</span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
