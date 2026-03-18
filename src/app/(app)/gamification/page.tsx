'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Flame,
  Zap,
  Trophy,
  Target,
  Star,
  Shield,
  TrendingUp,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import {
  getGamification,
  getTodayXP,
  getXPHistory,
  xpProgressInLevel,
  ACHIEVEMENTS,
} from '@/lib/services/gamification-service';
import { getActiveQuests, getCompletedQuests } from '@/lib/services/quest-service';
import { getAllDeckMastery, getSubjectsSummary } from '@/lib/services/mastery-service';
import { getRescueStats } from '@/lib/services/rescue-service';
import type { UserGamification, Quest, MasteryScore } from '@/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function GamificationPage() {
  const { user } = useAppStore();
  const [gam, setGam] = useState<UserGamification | null>(null);
  const [todayXP, setTodayXP] = useState(0);
  const [xpHistory, setXpHistory] = useState<{ date: string; xp: number }[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [completedQuests, setCompletedQuests] = useState<Quest[]>([]);
  const [mastery, setMastery] = useState<MasteryScore[]>([]);
  const [subjects, setSubjects] = useState<Array<{ subject: string; score: number; decks: number; totalCards: number }>>([]);
  const [rescueStats, setRescueStats] = useState({ highRisk: 0, overdue: 0, dueNow: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) return;
      try {
        const [g, txp, hist, aq, cq, m, sub, rs] = await Promise.all([
          getGamification(user.id),
          getTodayXP(user.id),
          getXPHistory(user.id, 14),
          getActiveQuests(user.id),
          getCompletedQuests(user.id),
          getAllDeckMastery(user.id),
          getSubjectsSummary(user.id),
          getRescueStats(user.id),
        ]);
        setGam(g);
        setTodayXP(txp);
        setXpHistory(hist);
        setQuests(aq);
        setCompletedQuests(cq);
        setMastery(m.slice(0, 10));
        setSubjects(sub);
        setRescueStats(rs);
      } catch (err) {
        console.error('Gamification load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  if (loading || !gam) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const xpProgress = xpProgressInLevel(gam.totalXP);
  const xpPercent = Math.round((xpProgress.current / xpProgress.needed) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Progreso</h1>
        <p className="text-muted-foreground">Tu avance basado en aprendizaje real</p>
      </div>

      {/* Top Stats Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* XP & Level */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-xs">Nivel {gam.level}</span>
            </div>
            <p className="text-3xl font-bold">{gam.totalXP.toLocaleString()} XP</p>
            <div className="mt-2">
              <Progress value={xpPercent} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {xpProgress.current} / {xpProgress.needed} XP para nivel {gam.level + 1}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Streak */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-xs">Racha</span>
            </div>
            <p className="text-3xl font-bold">{gam.currentStreak} días</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-muted-foreground">
                Mejor: {gam.longestStreak}d
              </p>
              {gam.streakFreezes > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  {gam.streakFreezes} congelados
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Today XP */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="text-xs">XP Hoy</span>
            </div>
            <p className="text-3xl font-bold">{todayXP}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Meta diaria: {gam.dailyGoal} repasos
            </p>
          </CardContent>
        </Card>

        {/* Rescue Quick Access */}
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-4 w-4 text-red-500" />
              <span className="text-xs">Rescate Rápido</span>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">{rescueStats.highRisk}</p>
              <span className="text-xs text-muted-foreground">en riesgo</span>
            </div>
            <Link href="/rescue">
              <Button size="sm" className="mt-2 w-full gap-1">
                Rescatar <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Quests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Misiones Activas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay misiones activas. Se generarán automáticamente.
            </p>
          ) : (
            <div className="space-y-3">
              {quests.map((quest) => (
                <div key={quest.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{quest.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {quest.frequency === 'daily' ? 'Diaria' : 'Semanal'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        +{quest.xpReward} XP
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{quest.description}</p>
                    <div className="mt-1.5">
                      <Progress value={Math.min(100, (quest.progress / quest.target) * 100)} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {quest.progress} / {quest.target}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {completedQuests.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3 text-center">
              {completedQuests.length} misiones completadas
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* XP History Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">XP Últimos 14 Días</CardTitle>
          </CardHeader>
          <CardContent>
            {xpHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={xpHistory}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value) => [`${value} XP`, 'XP']}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Bar dataKey="xp" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sin datos aún</p>
            )}
          </CardContent>
        </Card>

        {/* Achievements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Logros
            </CardTitle>
            <CardDescription>
              {gam.achievements.length} / {ACHIEVEMENTS.length} desbloqueados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {ACHIEVEMENTS.map((ach) => {
                const unlocked = gam.achievements.includes(ach.id);
                return (
                  <div
                    key={ach.id}
                    className={`rounded-lg border p-2 text-center transition-opacity ${
                      unlocked ? '' : 'opacity-40'
                    }`}
                  >
                    <div className="text-2xl">{ach.icon}</div>
                    <p className="text-xs font-medium mt-1">{ach.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ach.description}</p>
                    {unlocked && (
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        +{ach.xpReward} XP
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mastery by Subject */}
      {subjects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Dominio por Materia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {subjects.map((s) => (
                <div key={s.subject} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{s.subject}</span>
                    <span className={s.score >= 80 ? 'text-emerald-500' : s.score >= 50 ? 'text-amber-500' : 'text-red-500'}>
                      {s.score}%
                    </span>
                  </div>
                  <Progress value={s.score} className="h-2" />
                  <p className="text-[10px] text-muted-foreground">
                    {s.decks} mazos · {s.totalCards} tarjetas
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deck Mastery */}
      {mastery.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dominio por Mazo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mastery.map((m) => (
                <div key={m.deckId} className="flex items-center gap-3 rounded-lg border p-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium truncate">{m.deckName}</span>
                      <span className={`text-sm font-bold ${
                        m.score >= 80 ? 'text-emerald-500' : m.score >= 50 ? 'text-amber-500' : 'text-red-500'
                      }`}>
                        {m.score}%
                      </span>
                    </div>
                    <Progress value={m.score} className="h-1.5 mt-1" />
                    <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span>R: {(m.retrievability * 100).toFixed(0)}%</span>
                      <span>Cob: {(m.coverage * 100).toFixed(0)}%</span>
                      <span>{m.matureCards}/{m.totalCards} maduras</span>
                      {m.riskCards > 0 && (
                        <span className="text-red-500">{m.riskCards} en riesgo</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Curriculum Link */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Plan Curricular</p>
              <p className="text-sm text-muted-foreground">
                Gestiona programas, materias, módulos, capítulos y temas
              </p>
            </div>
            <Link href="/curriculum">
              <Button size="sm" className="gap-1">
                Ver Currículo <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
