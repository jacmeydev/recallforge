'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BookOpen,
  Plus,
  TrendingUp,
  AlertTriangle,
  Clock,
  Flame,
  Target,
  Brain,
  Calendar,
  BarChart3,
  Zap,
  Trophy,
  Shield,
  GraduationCap,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/db';
import type { DeckWithCounts, DailySummary, Quest } from '@/types';
import { formatDuration } from '@/lib/utils';
import { DailyHabitCard } from '@/components/dashboard/daily-habit';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { CopilotBriefCard } from '@/components/dashboard/copilot-brief';

export default function DashboardPage() {
  const { decks, setDecks, user } = useAppStore();
  const [todayStats, setTodayStats] = useState({
    due: 0,
    newCards: 0,
    learning: 0,
    reviews: 0,
    studied: 0,
    timeMs: 0,
    streak: 0,
    retention: 0,
  });
  const [gamStats, setGamStats] = useState<{ level: number; totalXP: number; todayXP: number; quests: Quest[] } | null>(null);
  const [loading, setLoading] = useState(true);

  // Reload decks AND stats from Dexie when sync pull completes
  useEffect(() => {
    const onSyncCompleted = async () => {
      if (!user) return;
      try {
        const { getDecksWithCounts } = await import('@/lib/services/deck-service');
        const freshDecks = await getDecksWithCounts(user.id);
        setDecks(freshDecks);
        // decks change will trigger loadDashboard via the [user, decks] dependency
      } catch (err) {
        console.error('Dashboard sync refresh error:', err);
      }
    };
    window.addEventListener('recallforge:sync-pull-completed', onSyncCompleted);
    return () => window.removeEventListener('recallforge:sync-pull-completed', onSyncCompleted);
  }, [user, setDecks]);

  useEffect(() => {
    async function loadDashboard() {
      if (!user) return;

      try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Count due cards
        const allCards = await db.cards
          .where('userId')
          .equals(user.id)
          .filter(c => !c.suspended)
          .toArray();

        const dueCards = allCards.filter(
          c => new Date(c.dueAt) <= today && c.state !== 'new'
        );
        const newCards = allCards.filter(c => c.state === 'new');
        const learningCards = allCards.filter(
          c => (c.state === 'learning' || c.state === 'relearning')
        );

        // Today's reviews
        const startOfDay = `${todayStr}T00:00:00.000Z`;
        const endOfDay = `${todayStr}T23:59:59.999Z`;
        const todayLogs = await db.reviewLogs
          .where('[userId+reviewedAt]')
          .between([user.id, startOfDay], [user.id, endOfDay])
          .toArray();

        const correctCount = todayLogs.filter(
          l => l.rating === 'good' || l.rating === 'easy'
        ).length;

        // Get streak
        const { getCurrentStreak } = await import('@/lib/services/analytics-service');
        const streak = await getCurrentStreak(user.id);

        setTodayStats({
          due: dueCards.length,
          newCards: newCards.length,
          learning: learningCards.length,
          reviews: dueCards.length,
          studied: todayLogs.length,
          timeMs: todayLogs.reduce((sum, l) => sum + l.responseTimeMs, 0),
          streak,
          retention: todayLogs.length > 0 ? correctCount / todayLogs.length : 0,
        });

        // Load gamification data
        try {
          const { getGamification, getTodayXP } = await import('@/lib/services/gamification-service');
          const { getActiveQuests, generateDailyQuests } = await import('@/lib/services/quest-service');
          const [gam, txp] = await Promise.all([
            getGamification(user.id),
            getTodayXP(user.id),
          ]);
          // Auto-generate daily quests
          await generateDailyQuests(user.id);
          const quests = await getActiveQuests(user.id);
          setGamStats({ level: gam.level, totalXP: gam.totalXP, todayXP: txp, quests });
        } catch {
          // Gamification is non-critical
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user, decks]);

  const totalDue = todayStats.due + todayStats.learning;
  const totalStudyable = totalDue + todayStats.newCards;

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-7">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Inicio</h1>
          <p className="text-muted-foreground">
            {new Date().toLocaleDateString('es-PY', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex gap-2 self-start md:self-auto">
          <Link href="/notes/add">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Agregar Nota</span>
              <span className="sm:hidden">Nota</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Actions — Mobile-friendly action bar */}
      <QuickActions totalStudyable={totalStudyable} hasDecks={decks.length > 0} decks={decks} />

      {/* Daily Habit + Copilot Brief — side by side on desktop */}
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <DailyHabitCard />
        <CopilotBriefCard />
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-4">
        <Card className={totalStudyable > 0 ? 'border-primary/30' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Para Estudiar Hoy</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStudyable}</div>
            <p className="text-xs text-muted-foreground">
              {todayStats.reviews > 0 && <>{todayStats.reviews} repasos</>}
              {todayStats.learning > 0 && <>{todayStats.reviews > 0 ? ' · ' : ''}{todayStats.learning} aprendiendo</>}
              {todayStats.newCards > 0 && <>{(todayStats.reviews > 0 || todayStats.learning > 0) ? ' · ' : ''}{todayStats.newCards} nuevas</>}
              {totalStudyable === 0 && '¡Todo al día!'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estudiado Hoy</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayStats.studied}</div>
            <p className="text-xs text-muted-foreground">
              {formatDuration(todayStats.timeMs)} dedicados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retención</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {todayStats.studied > 0
                ? `${(todayStats.retention * 100).toFixed(0)}%`
                : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              Precisión de hoy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Racha</CardTitle>
            <Flame className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayStats.streak}</div>
            <p className="text-xs text-muted-foreground">
              días consecutivos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gamification Quick Bar */}
      {gamStats && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="flex items-center gap-3 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
                <Zap className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium">Nivel {gamStats.level}</p>
                <p className="text-xs text-muted-foreground">{gamStats.totalXP.toLocaleString()} XP total · +{gamStats.todayXP} hoy</p>
              </div>
              <Link href="/gamification" className="ml-auto">
                <Button variant="ghost" size="sm"><Trophy className="h-4 w-4" /></Button>
              </Link>
            </CardContent>
          </Card>

          {gamStats.quests.length > 0 && (
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Misiones</span>
                </div>
                {gamStats.quests.slice(0, 2).map(q => (
                  <div key={q.id} className="flex items-center gap-2 text-xs mt-1">
                    <span className="truncate flex-1">{q.name}</span>
                    <span className="text-muted-foreground">{q.progress}/{q.target}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Link href="/rescue">
            <Card className="cursor-pointer hover:border-red-300 transition-colors h-full">
              <CardContent className="flex items-center gap-3 py-3 h-full">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                  <Shield className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Rescate Rápido</p>
                  <p className="text-xs text-muted-foreground">Sesiones cortas para días difíciles</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Deck List with Study Buttons */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Tus Mazos</CardTitle>
            <Link href="/decks">
              <Button variant="ghost" size="sm">Ver todos</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {decks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center md:py-12">
              <Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Sin mazos aún</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Creá tu primer mazo para empezar a estudiar
              </p>
              <Link href="/decks">
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Crear Mazo
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {decks.map((deck) => (
                <DeckRow key={deck.id} deck={deck} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Academic Study — with useful empty state */}
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="py-4">
          <Link href="/study/academic" className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
              <GraduationCap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Estudio por Materia</p>
              <p className="text-sm text-muted-foreground">
                Estudia por materia, capítulo, prioridad o dificultad
              </p>
            </div>
          </Link>
          {/* Show a hint if there are no academic notes yet */}
          {todayStats.newCards + totalDue > 0 && decks.length > 0 && (
            <div className="mt-3 ml-14 text-xs text-muted-foreground">
              <span className="opacity-70">
                Tip: Importa tarjetas con metadata académica desde{' '}
                <Link href="/ai-import" className="text-primary hover:underline">Importar IA</Link>
                {' '}o vinculalas en{' '}
                <Link href="/curriculum" className="text-primary hover:underline">Currículo</Link>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeckRow({ deck }: { deck: DeckWithCounts }) {
  const totalDue = deck.newCount + deck.learningCount + deck.reviewCount;

  return (
    <div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <Link href={`/decks/${deck.id}`} className="font-medium text-sm hover:underline truncate block">
          {deck.name}
        </Link>
        <div className="flex items-center gap-3 mt-1">
          {deck.newCount > 0 && (
            <Badge variant="info" className="text-xs">{deck.newCount} nuevas</Badge>
          )}
          {deck.learningCount > 0 && (
            <Badge variant="warning" className="text-xs">{deck.learningCount} aprendiendo</Badge>
          )}
          {deck.reviewCount > 0 && (
            <Badge variant="success" className="text-xs">{deck.reviewCount} repaso</Badge>
          )}
          {totalDue === 0 && (
            <span className="text-xs text-muted-foreground">¡Al día!</span>
          )}
        </div>
      </div>
      {totalDue > 0 && (
        <Link href={`/study/${deck.id}`}>
          <Button size="sm" className="gap-1.5 ml-3">
            <BookOpen className="h-3.5 w-3.5" />
            Estudiar
          </Button>
        </Link>
      )}
    </div>
  );
}
