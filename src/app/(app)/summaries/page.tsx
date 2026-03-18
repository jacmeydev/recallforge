'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileBarChart,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Brain,
  Zap,
  Target,
  BookOpen,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { PersonalSummary } from '@/types';

export default function SummariesPage() {
  const { user } = useAppStore();
  const [summaries, setSummaries] = useState<PersonalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const loadSummaries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { getPersonalSummaries } = await import('@/lib/services/personal-summary-service');
      const data = await getPersonalSummaries(user.id, { period, limit: 30 });
      setSummaries(data);
    } catch (err) {
      console.error('Failed to load summaries:', err);
    } finally {
      setLoading(false);
    }
  }, [user, period]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const { generatePersonalSummary } = await import('@/lib/services/personal-summary-service');
      const today = new Date().toISOString().split('T')[0];
      await generatePersonalSummary(user.id, period, today);
      await loadSummaries();
    } catch (err) {
      console.error('Failed to generate summary:', err);
    } finally {
      setGenerating(false);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="h-6 w-6" />
            Resúmenes Personales
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tu progreso académico consolidado por período
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          <RefreshCw className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generando...' : 'Generar Ahora'}
        </Button>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as 'daily' | 'weekly' | 'monthly')}>
        <TabsList>
          <TabsTrigger value="daily">Diario</TabsTrigger>
          <TabsTrigger value="weekly">Semanal</TabsTrigger>
          <TabsTrigger value="monthly">Mensual</TabsTrigger>
        </TabsList>

        <TabsContent value={period} className="mt-4">
          {summaries.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileBarChart className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Sin resúmenes {period === 'daily' ? 'diarios' : period === 'weekly' ? 'semanales' : 'mensuales'} aún.</p>
                <p className="text-sm mt-1">Haz clic en &quot;Generar Ahora&quot; o completa una sesión de estudio.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {summaries.map((s) => (
                <SummaryCard key={s.id} summary={s} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ summary }: { summary: PersonalSummary }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {summary.date}
          </CardTitle>
          <Badge variant="secondary">
            {summary.period === 'daily' ? 'Diario' : summary.period === 'weekly' ? 'Semanal' : 'Mensual'}
          </Badge>
        </div>
        <CardDescription>
          Generado: {new Date(summary.generatedAt).toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Key metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricBox icon={Zap} label="XP Ganado" value={summary.xpEarned} color="text-yellow-500" />
          <MetricBox icon={Target} label="Racha" value={`${summary.streakDays} días`} color="text-emerald-500" />
          <MetricBox icon={CheckCircle} label="Quests Completados" value={summary.questsCompleted} color="text-blue-500" />
          <MetricBox icon={AlertTriangle} label="Prioridad Alta" value={summary.highPriorityPending} color="text-red-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Subjects */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              Materias Avanzadas
            </h4>
            {summary.subjectsAdvanced.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {summary.subjectsAdvanced.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Ninguna</p>
            )}

            {summary.subjectsAbandoned.length > 0 && (
              <>
                <h4 className="text-sm font-medium flex items-center gap-1 mt-3">
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                  Materias sin Actividad
                </h4>
                <div className="flex flex-wrap gap-1">
                  {summary.subjectsAbandoned.map((s) => (
                    <Badge key={s} variant="destructive" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Chapters & Topics */}
          <div className="space-y-2">
            {summary.chaptersConsolidated.length > 0 && (
              <>
                <h4 className="text-sm font-medium flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5 text-purple-500" />
                  Capítulos Consolidados
                </h4>
                <div className="flex flex-wrap gap-1">
                  {summary.chaptersConsolidated.map((c) => (
                    <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                  ))}
                </div>
              </>
            )}

            <h4 className="text-sm font-medium flex items-center gap-1 mt-3">
              <Brain className="h-3.5 w-3.5 text-amber-500" />
              Temas Difíciles
            </h4>
            <p className="text-sm">{summary.hardTopicsCount} temas difíciles pendientes</p>
          </div>
        </div>

        {/* Bottom stats */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t text-xs text-muted-foreground">
          <span>IA pendiente: {summary.aiCardsPendingReview}</span>
          <span>Cobertura syllabus: {(summary.syllabusCoverageDelta * 100).toFixed(0)}%</span>
          {summary.topMasteryGains.length > 0 && (
            <span>Top dominio: {summary.topMasteryGains[0].deck} ({summary.topMasteryGains[0].change}%)</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricBox({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/50">
      <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
