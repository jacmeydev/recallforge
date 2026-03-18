'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  type PieLabelRenderProps,
} from 'recharts';
import {
  BarChart3,
  Calendar,
  Target,
  TrendingUp,
  Clock,
  Zap,
  Award,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import {
  getReviewHeatmap,
  getRetentionMap,
  getCurrentStreak,
  type HeatmapDay,
} from '@/lib/services/analytics-service';
import { db } from '@/lib/db';
import { formatDuration, formatInterval, today } from '@/lib/utils';
import type { DailySummary } from '@/types';

interface StatsData {
  totalReviews: number;
  totalCards: number;
  matureCards: number;
  youngCards: number;
  newCards: number;
  avgRetention: number;
  streak: number;
  heatmap: HeatmapDay[];
  retentionByDeck: { deckName: string; desired: number; actual: number }[];
  reviewsByDay: { date: string; count: number; avgTimeMs: number }[];
  ratingDistribution: { again: number; hard: number; good: number; easy: number };
}

export default function StatsPage() {
  const { user, decks } = useAppStore();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'30d' | '90d' | '1y' | 'all'>('30d');

  useEffect(() => {
    async function loadStats() {
      if (!user) return;
      setLoading(true);

      try {
        const [heatmap, retentionMap, streak] = await Promise.all([
          getReviewHeatmap(user.id, 365),
          getRetentionMap(user.id),
          getCurrentStreak(user.id),
        ]);

        // Get card counts
        const allCards = await db.cards.where('userId').equals(user.id).toArray();
        const totalCards = allCards.length;
        const matureCards = allCards.filter(
          (c) => c.state === 'review' && c.scheduledDays >= 21
        ).length;
        const youngCards = allCards.filter(
          (c) => c.state === 'review' && c.scheduledDays < 21
        ).length;
        const newCards = allCards.filter((c) => c.state === 'new').length;

        // Get review logs
        const cutoff = getCutoffDate(timeRange);
        const reviews = await db.reviewLogs
          .where('[userId+reviewedAt]')
          .between([user.id, cutoff], [user.id, '\uffff'])
          .toArray();

        const totalReviews = reviews.length;

        // Avg retention (correct answers / total)
        const correctAnswers = reviews.filter(
          (r) => r.rating === 'good' || r.rating === 'easy'
        ).length;
        const avgRetention = totalReviews > 0
          ? (correctAnswers / totalReviews) * 100
          : 0;

        // Rating distribution
        const ratingDistribution = { again: 0, hard: 0, good: 0, easy: 0 };
        for (const r of reviews) {
          if (r.rating in ratingDistribution) {
            ratingDistribution[r.rating as keyof typeof ratingDistribution]++;
          }
        }

        // Reviews by day
        const byDay: Record<string, { count: number; totalTimeMs: number }> = {};
        for (const r of reviews) {
          const day = new Date(r.reviewedAt).toISOString().slice(0, 10);
          if (!byDay[day]) byDay[day] = { count: 0, totalTimeMs: 0 };
          byDay[day].count++;
          byDay[day].totalTimeMs += r.responseTimeMs || 0;
        }

        const reviewsByDay = Object.entries(byDay)
          .map(([date, data]) => ({
            date,
            count: data.count,
            avgTimeMs: data.count > 0 ? data.totalTimeMs / data.count : 0,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        // Retention by deck
        const deckMap = new Map(decks.map((d) => [d.id, d.name]));
        const retentionByDeck = retentionMap.map((r) => ({
          deckName: deckMap.get(r.deckId) || 'Unknown',
          desired: r.desiredRetention * 100,
          actual: r.actualRetention * 100,
        }));

        setStats({
          totalReviews,
          totalCards,
          matureCards,
          youngCards,
          newCards,
          avgRetention,
          streak,
          heatmap,
          retentionByDeck,
          reviewsByDay,
          ratingDistribution,
        });
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [user, timeRange, decks]);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Estadísticas</h1>
        <div className="flex gap-1">
          {(['30d', '90d', '1y', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 text-sm rounded-md ${
                timeRange === range
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {range === 'all' ? 'Todo' : range}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <BarChart3 className="h-4 w-4" />
              <span className="text-xs">Repasos Totales</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalReviews.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-4 w-4" />
              <span className="text-xs">Retención</span>
            </div>
            <p className="text-3xl font-bold">{stats.avgRetention.toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="h-4 w-4" />
              <span className="text-xs">Racha Actual</span>
            </div>
            <p className="text-3xl font-bold">{stats.streak} días</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Award className="h-4 w-4" />
              <span className="text-xs">Total Tarjetas</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalCards.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Card State Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Madurez de Tarjetas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Maduras</span>
              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${stats.totalCards > 0 ? (stats.matureCards / stats.totalCards) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-16 text-right">{stats.matureCards}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Jóvenes</span>
              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${stats.totalCards > 0 ? (stats.youngCards / stats.totalCards) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-16 text-right">{stats.youngCards}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-16">Nuevas</span>
              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${stats.totalCards > 0 ? (stats.newCards / stats.totalCards) * 100 : 0}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-16 text-right">{stats.newCards}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Rating Distribution — Recharts PieChart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribución de Respuestas</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.totalReviews > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Otra vez', value: stats.ratingDistribution.again, fill: '#ef4444' },
                      { name: 'Difícil', value: stats.ratingDistribution.hard, fill: '#f97316' },
                      { name: 'Bien', value: stats.ratingDistribution.good, fill: '#10b981' },
                      { name: 'Fácil', value: stats.ratingDistribution.easy, fill: '#3b82f6' },
                    ].filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={(props: PieLabelRenderProps) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {[
                      { fill: '#ef4444' },
                      { fill: '#f97316' },
                      { fill: '#10b981' },
                      { fill: '#3b82f6' },
                    ].filter((_, i) => [
                      stats.ratingDistribution.again,
                      stats.ratingDistribution.hard,
                      stats.ratingDistribution.good,
                      stats.ratingDistribution.easy,
                    ][i] > 0).map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} repasos`, '']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sin datos aún</p>
            )}
          </CardContent>
        </Card>

        {/* Retention by Deck */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Retención por Mazo</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.retentionByDeck.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos aún</p>
            ) : (
              <div className="space-y-3">
                {stats.retentionByDeck.map((d) => (
                  <div key={d.deckName} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{d.deckName}</span>
                      <span className={d.actual >= d.desired ? 'text-emerald-500' : 'text-amber-500'}>
                        {d.actual.toFixed(1)}% / {d.desired.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d.actual >= d.desired ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(d.actual, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mapa de Calor de Repasos</CardTitle>
          <CardDescription>Actividad diaria de repasos en el último año</CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewHeatmap data={stats.heatmap} />
        </CardContent>
      </Card>

      {/* Daily Reviews — Recharts BarChart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actividad Diaria</CardTitle>
          <CardDescription>Repasos por día (últimos 14 días)</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.reviewsByDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.reviewsByDay.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  className="text-muted-foreground"
                />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <Tooltip
                  formatter={(value) => [`${value} repasos`, 'Repasos']}
                  labelFormatter={(label) => `Fecha: ${label}`}
                />
                <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Sin repasos aún</p>
          )}
        </CardContent>
      </Card>

      {/* Academic Stats */}
      <AcademicStatsSection userId={user?.id} />

      {/* Priority & Difficulty Distribution */}
      <PriorityDifficultySection userId={user?.id} />

      {/* Curriculum Progress */}
      <CurriculumProgressSection userId={user?.id} />
    </div>
  );
}

// Academic Stats Section
function AcademicStatsSection({ userId }: { userId?: string }) {
  const [subjects, setSubjects] = useState<Array<{ subject: string; score: number; decks: number; totalCards: number; riskCards: number; backlog: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { getSubjectsSummary } = await import('@/lib/services/mastery-service');
        const data = await getSubjectsSummary(userId);
        setSubjects(data);
      } catch {
        // Non-critical
      } finally {
        setLoaded(true);
      }
    })();
  }, [userId]);

  if (!loaded || subjects.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Dominio por Materia</CardTitle>
        <CardDescription>Métricas académicas basadas en FSRS</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {subjects.map((s) => (
            <div key={s.subject} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{s.subject}</span>
                <div className="flex items-center gap-3">
                  {s.riskCards > 0 && (
                    <span className="text-xs text-red-500">{s.riskCards} en riesgo</span>
                  )}
                  {s.backlog > 0 && (
                    <span className="text-xs text-amber-500">{s.backlog} atrasadas</span>
                  )}
                  <span className={`font-bold ${s.score >= 80 ? 'text-emerald-500' : s.score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                    {s.score}%
                  </span>
                </div>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.score >= 80 ? 'bg-emerald-500' : s.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${s.score}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">{s.decks} mazos · {s.totalCards} tarjetas</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Curriculum Progress Section
function CurriculumProgressSection({ userId }: { userId?: string }) {
  const [programs, setPrograms] = useState<Array<{ id: string; name: string; progress: { masteryScore: number; coverage: number; highPriorityPending: number; aiPendingReview: number } }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { getPrograms, getProgramProgress } = await import('@/lib/services/curriculum-service');
        const progs = await getPrograms(userId);
        const withProgress = await Promise.all(
          progs.map(async (p) => {
            const progress = await getProgramProgress(userId, p.id);
            return { id: p.id, name: p.name, progress };
          })
        );
        setPrograms(withProgress);
      } catch {
        // Non-critical
      } finally {
        setLoaded(true);
      }
    })();
  }, [userId]);

  if (!loaded || programs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Progreso Curricular</CardTitle>
        <CardDescription>Avance por programa académico</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {programs.map((p) => (
            <div key={p.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-3">
                  {p.progress.highPriorityPending > 0 && (
                    <span className="text-xs text-red-500">{p.progress.highPriorityPending} prioridad alta</span>
                  )}
                  {p.progress.aiPendingReview > 0 && (
                    <span className="text-xs text-amber-500">{p.progress.aiPendingReview} IA pendiente</span>
                  )}
                  <span className={`font-bold ${p.progress.masteryScore >= 80 ? 'text-emerald-500' : p.progress.masteryScore >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                    {p.progress.masteryScore}%
                  </span>
                </div>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${p.progress.masteryScore >= 80 ? 'bg-emerald-500' : p.progress.masteryScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${p.progress.masteryScore}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Cobertura: {(p.progress.coverage * 100).toFixed(0)}%
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Review Heatmap Component (GitHub-style)
function ReviewHeatmap({ data }: { data: HeatmapDay[] }) {
  const dataMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of data) {
      map[d.date] = d.count;
    }
    return map;
  }, [data]);

  const weeks = useMemo(() => {
    const result: { date: string; count: number }[][] = [];
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);

    let currentWeek: { date: string; count: number }[] = [];
    const current = new Date(start);

    // Align to Sunday
    while (current.getDay() !== 0) {
      current.setDate(current.getDate() + 1);
    }

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      currentWeek.push({ date: dateStr, count: dataMap[dateStr] || 0 });

      if (currentWeek.length === 7) {
        result.push(currentWeek);
        currentWeek = [];
      }

      current.setDate(current.getDate() + 1);
    }

    if (currentWeek.length > 0) result.push(currentWeek);
    return result;
  }, [dataMap]);

  const maxCount = useMemo(() => {
    return Math.max(1, ...Object.values(dataMap));
  }, [dataMap]);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-muted';
    const intensity = count / maxCount;
    if (intensity > 0.75) return 'bg-emerald-600 dark:bg-emerald-500';
    if (intensity > 0.5) return 'bg-emerald-500 dark:bg-emerald-400';
    if (intensity > 0.25) return 'bg-emerald-400 dark:bg-emerald-600';
    return 'bg-emerald-300 dark:bg-emerald-700';
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-0.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day) => (
              <div
                key={day.date}
                className={`w-3 h-3 rounded-sm ${getColor(day.count)}`}
                title={`${day.date}: ${day.count} repasos`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <span>Menos</span>
        <div className="w-3 h-3 rounded-sm bg-muted" />
        <div className="w-3 h-3 rounded-sm bg-emerald-300 dark:bg-emerald-700" />
        <div className="w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-600" />
        <div className="w-3 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-400" />
        <div className="w-3 h-3 rounded-sm bg-emerald-600 dark:bg-emerald-500" />
        <span>Más</span>
      </div>
    </div>
  );
}

function getCutoffDate(range: '30d' | '90d' | '1y' | 'all'): string {
  const now = Date.now();
  switch (range) {
    case '30d': return new Date(now - 30 * 86400000).toISOString();
    case '90d': return new Date(now - 90 * 86400000).toISOString();
    case '1y': return new Date(now - 365 * 86400000).toISOString();
    case 'all': return '';
  }
}

// Priority & Difficulty Distribution Section
function PriorityDifficultySection({ userId }: { userId?: string }) {
  const [data, setData] = useState<{
    priority: { name: string; value: number; fill: string }[];
    difficulty: { name: string; value: number; fill: string }[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const notes = await db.notes.where('userId').equals(userId).toArray();
        const priorityCounts = { low: 0, medium: 0, high: 0, critical: 0, none: 0 };
        const difficultyCounts = { easy: 0, medium: 0, hard: 0, very_hard: 0, none: 0 };

        for (const note of notes) {
          const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
          const p = (acad?.priority as string) || 'none';
          const d = (acad?.conceptualDifficulty as string) || 'none';
          if (p in priorityCounts) priorityCounts[p as keyof typeof priorityCounts]++;
          else priorityCounts.none++;
          if (d in difficultyCounts) difficultyCounts[d as keyof typeof difficultyCounts]++;
          else difficultyCounts.none++;
        }

        setData({
          priority: [
            { name: 'Baja', value: priorityCounts.low, fill: '#3b82f6' },
            { name: 'Media', value: priorityCounts.medium, fill: '#f59e0b' },
            { name: 'Alta', value: priorityCounts.high, fill: '#f97316' },
            { name: 'Crítica', value: priorityCounts.critical, fill: '#ef4444' },
            { name: 'Sin asignar', value: priorityCounts.none, fill: '#94a3b8' },
          ].filter(d => d.value > 0),
          difficulty: [
            { name: 'Fácil', value: difficultyCounts.easy, fill: '#10b981' },
            { name: 'Media', value: difficultyCounts.medium, fill: '#3b82f6' },
            { name: 'Difícil', value: difficultyCounts.hard, fill: '#f97316' },
            { name: 'Muy Difícil', value: difficultyCounts.very_hard, fill: '#ef4444' },
            { name: 'Sin asignar', value: difficultyCounts.none, fill: '#94a3b8' },
          ].filter(d => d.value > 0),
        });
      } catch {
        // Non-critical
      } finally {
        setLoaded(true);
      }
    })();
  }, [userId]);

  if (!loaded || !data || (data.priority.length === 0 && data.difficulty.length === 0)) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {data.priority.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribución por Prioridad</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.priority}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={(props: PieLabelRenderProps) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.priority.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value} notas`, '']} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {data.difficulty.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribución por Dificultad</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.difficulty}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={(props: PieLabelRenderProps) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.difficulty.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value} notas`, '']} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
