'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Brain,
  Shield,
  AlertTriangle,
  TrendingDown,
  Layers,
  Map,
  Activity,
  Calculator,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import {
  getRetrievabilityDistribution,
  getStabilityMap,
  getForgettingRisk,
  getKnowledgeCoverage,
  getProblemCards,
  simulateLoad,
  type RetrievabilityBucket,
  type StabilityGroup,
  type ForgettingRiskItem,
  type CoverageStats,
  type ProblemCard,
} from '@/lib/services/analytics-service';
import { formatInterval } from '@/lib/utils';

interface AtlasData {
  retrievability: RetrievabilityBucket[];
  stability: StabilityGroup[];
  risk: ForgettingRiskItem[];
  coverage: CoverageStats[];
  problems: ProblemCard[];
  forecast: { date: string; dueCards: number }[];
}

export default function AtlasPage() {
  const { user, decks } = useAppStore();
  const [data, setData] = useState<AtlasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulateDays, setSimulateDays] = useState(30);
  const [simulateNewPerDay, setSimulateNewPerDay] = useState(10);

  useEffect(() => {
    async function loadAtlas() {
      if (!user) return;
      setLoading(true);

      try {
        const [retrievability, stability, risk, coverage, problems, loadSim] =
          await Promise.all([
            getRetrievabilityDistribution(user.id),
            getStabilityMap(user.id),
            getForgettingRisk(user.id),
            getKnowledgeCoverage(user.id),
            getProblemCards(user.id, 20),
            simulateLoad(user.id, { forecastDays: simulateDays, newPerDay: simulateNewPerDay }),
          ]);

        setData({ retrievability, stability, risk, coverage, problems, forecast: loadSim.forecast });
      } catch (err) {
        console.error('Failed to load atlas data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadAtlas();
  }, [user, simulateDays, simulateNewPerDay]);

  if (loading || !data) {
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
          <Map className="h-6 w-6" />
          Recall Atlas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Análisis profundo de tu paisaje de memoria
        </p>
      </div>

      {/* Retrievability Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Distribución de Recuperabilidad
          </CardTitle>
          <CardDescription>
            Qué tan bien puedes recordar tus tarjetas ahora mismo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.retrievability.map((bucket) => {
              const colors: Record<string, string> = {
                '90-100%': 'bg-emerald-500',
                '75-89%': 'bg-blue-500',
                '50-74%': 'bg-amber-500',
                '<50%': 'bg-red-500',
              };
              const totalCards = data.retrievability.reduce((s, b) => s + b.count, 0);
              const pct = totalCards > 0 ? (bucket.count / totalCards) * 100 : 0;
              return (
                <div key={bucket.range} className="text-center space-y-2">
                  <div className="text-3xl font-bold">{bucket.count}</div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${colors[bucket.range] || 'bg-muted-foreground'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bucket.range}
                    <br />
                    {pct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stability Map */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Estabilidad de Memoria
            </CardTitle>
            <CardDescription>Qué tan duraderos son tus recuerdos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.stability.map((group) => {
                const groupColors: Record<string, string> = {
                  'Muy Frágil (<1d)': 'bg-red-500',
                  'Frágil (1-7d)': 'bg-orange-500',
                  'En Desarrollo (7-30d)': 'bg-amber-500',
                  'Estable (30-90d)': 'bg-blue-500',
                  'Fuerte (90-365d)': 'bg-emerald-500',
                  'Consolidada (>365d)': 'bg-emerald-700',
                };
                return (
                  <div key={group.label} className="flex items-center gap-3">
                    <span className="text-sm w-28 shrink-0">{group.label}</span>
                    <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${groupColors[group.label] || 'bg-muted-foreground'}`}
                        style={{
                          width: `${Math.max(
                            2,
                            (group.count / Math.max(1, data.stability.reduce((s, g) => s + g.count, 0))) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-10 text-right">
                      {group.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Forgetting Risk */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Riesgo de Olvido
            </CardTitle>
            <CardDescription>Tarjetas en riesgo de ser olvidadas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(() => {
                const grouped: Record<string, number> = {};
                for (const item of data.risk) {
                  grouped[item.riskLevel] = (grouped[item.riskLevel] || 0) + 1;
                }
                const riskColors: Record<string, { bg: string; text: string }> = {
                  critical: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
                  high: { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400' },
                  moderate: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
                  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
                };
                const riskLabels: Record<string, string> = {
                  critical: 'Riesgo Crítico',
                  high: 'Riesgo Alto',
                  moderate: 'Riesgo Moderado',
                  low: 'Riesgo Bajo',
                };
                return Object.entries(grouped).map(([level, count]) => {
                  const colors = riskColors[level] || riskColors.low;
                  return (
                    <div key={level} className={`p-3 rounded-lg ${colors.bg}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${colors.text}`}>
                          {riskLabels[level] || level}
                        </span>
                        <Badge variant="outline">{count} tarjetas</Badge>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Knowledge Coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Cobertura de Conocimiento
          </CardTitle>
          <CardDescription>Progreso de aprendizaje por mazo</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.coverage.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin mazos aún</p>
            ) : (
              data.coverage.map((deck) => {
                const learned = deck.learningCount + deck.reviewCount + deck.matureCount;
                const learnedPct = deck.totalCount > 0 ? (learned / deck.totalCount) * 100 : 0;
                const maturePct = deck.totalCount > 0 ? (deck.matureCount / deck.totalCount) * 100 : 0;
                return (
                  <div key={deck.deckId} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{deck.deckName}</span>
                      <span className="text-muted-foreground">
                        {learned}/{deck.totalCount} aprendidas · {deck.matureCount} maduras
                      </span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${maturePct}%` }}
                      />
                      <div
                        className="h-full bg-blue-400"
                        style={{ width: `${learnedPct - maturePct}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" /> Maduras
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-400" /> Aprendiendo
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Problem Cards (Leeches) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Tarjetas Problemáticas
          </CardTitle>
          <CardDescription>Tarjetas con muchos fallos que pueden necesitar atención</CardDescription>
        </CardHeader>
        <CardContent>
          {data.problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">¡Sin tarjetas problemáticas detectadas!</p>
          ) : (
            <div className="space-y-2">
              {data.problems.map((card) => (
                <div
                  key={card.cardId}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{card.reason}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                      <span>Fallos: {card.lapses}</span>
                      <span>Estabilidad: {card.stability.toFixed(1)}d</span>
                    </div>
                  </div>
                  <Badge variant="destructive" className="ml-3 shrink-0">
                    {card.isLeech ? 'Sanguijuela' : 'Problema'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workload Simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Simulador de Carga
          </CardTitle>
          <CardDescription>
            Pronostica tu carga diaria de repasos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Días a pronosticar</Label>
              <Input
                type="number"
                value={simulateDays}
                onChange={(e) => setSimulateDays(Math.max(7, parseInt(e.target.value) || 30))}
                className="w-24"
                min={7}
                max={365}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nuevas tarjetas/día</Label>
              <Input
                type="number"
                value={simulateNewPerDay}
                onChange={(e) => setSimulateNewPerDay(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-24"
                min={0}
                max={999}
              />
            </div>
          </div>

          {data.forecast.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-end gap-0.5 h-32">
                {data.forecast.map((day, i) => {
                  const maxCount = Math.max(1, ...data.forecast.map((d) => d.dueCards));
                  const height = (day.dueCards / maxCount) * 100;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 bg-primary/60 hover:bg-primary rounded-t transition-colors"
                      style={{ height: `${Math.max(2, height)}%` }}
                      title={`${day.date}: ~${day.dueCards} repasos`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{data.forecast[0]?.date}</span>
                <span>{data.forecast[data.forecast.length - 1]?.date}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Prom: ~{Math.round(data.forecast.reduce((s, d) => s + d.dueCards, 0) / data.forecast.length)} repasos/día
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Curriculum Mastery */}
      <CurriculumAtlasSection userId={user?.id} />
    </div>
  );
}

// Curriculum Atlas Section
function CurriculumAtlasSection({ userId }: { userId?: string }) {
  const [subjects, setSubjects] = useState<Array<{
    name: string;
    masteryScore: number;
    coverage: number;
    totalCards: number;
    riskCards: number;
    highPriority: number;
  }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { getPrograms, getSubjects, getSubjectProgress } = await import('@/lib/services/curriculum-service');
        const progs = await getPrograms(userId);
        const allSubjects: typeof subjects = [];

        for (const prog of progs) {
          const subs = await getSubjects(userId, prog.id);
          for (const sub of subs) {
            const progress = await getSubjectProgress(userId, sub.id);
            allSubjects.push({
              name: sub.name,
              masteryScore: progress.masteryScore,
              coverage: progress.coverage,
              totalCards: progress.totalCards,
              riskCards: progress.riskCards,
              highPriority: progress.highPriorityPending,
            });
          }
        }

        setSubjects(allSubjects);
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
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Atlas Curricular
        </CardTitle>
        <CardDescription>Dominio y cobertura por materia</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {subjects.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{s.name}</span>
                <div className="flex items-center gap-3">
                  {s.riskCards > 0 && (
                    <span className="text-xs text-red-500">
                      <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                      {s.riskCards} riesgo
                    </span>
                  )}
                  {s.highPriority > 0 && (
                    <span className="text-xs text-amber-500">{s.highPriority} prioridad</span>
                  )}
                  <span className={`font-bold ${s.masteryScore >= 80 ? 'text-emerald-500' : s.masteryScore >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                    {s.masteryScore}%
                  </span>
                </div>
              </div>
              <Progress value={s.masteryScore} className="h-2" />
              <p className="text-[10px] text-muted-foreground">
                Cobertura: {(s.coverage * 100).toFixed(0)}% · {s.totalCards} tarjetas
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
