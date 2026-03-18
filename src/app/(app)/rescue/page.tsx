'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft,
  AlertTriangle,
  Clock,
  Zap,
  Shield,
  Heart,
  Target,
} from 'lucide-react';
import { useAppStore, useStudyStore } from '@/lib/store';
import {
  buildRescueQueue,
  startRescueSession,
  finishRescueSession,
  getRescueStats,
  type RescueMode,
} from '@/lib/services/rescue-service';
import { answerCard, previewIntervals } from '@/lib/services/study-service';
import { renderTemplate, processCloze, processClozeAnswer, sanitizeHtml, formatDuration } from '@/lib/utils';
import type { StudyQueueCard, IntervalPreview, ReviewRating, StudySession } from '@/types';

export default function RescuePage() {
  const router = useRouter();
  const { user, getPresetForDeck } = useAppStore();

  const [phase, setPhase] = useState<'choose' | 'studying' | 'done'>('choose');
  const [rescueStats, setRescueStats] = useState({ highRisk: 0, overdue: 0, dueNow: 0 });
  const [queue, setQueue] = useState<StudyQueueCard[]>([]);
  const [session, setSession] = useState<StudySession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [cardStartTime, setCardStartTime] = useState(Date.now());
  const [previews, setPreviews] = useState<IntervalPreview | null>(null);
  const [stats, setStats] = useState({ studied: 0, again: 0, good: 0, totalTimeMs: 0 });
  const [xpAwarded, setXpAwarded] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const rs = await getRescueStats(user.id);
      setRescueStats(rs);
      setLoading(false);
    }
    load();
  }, [user]);

  const startRescue = async (mode: RescueMode) => {
    if (!user) return;
    setLoading(true);
    try {
      const { session: sess, queue: q } = await startRescueSession(user.id, mode);
      if (q.length === 0) {
        setLoading(false);
        return;
      }
      setSession(sess);
      setQueue(q);
      setCurrentIndex(0);
      setShowAnswer(false);
      setCardStartTime(Date.now());
      setPhase('studying');

      const first = q[0];
      const preset = getPresetForDeck(first.card.deckId);
      setPreviews(previewIntervals(first.card, preset));
    } catch (err) {
      console.error('Failed to start rescue:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentCard = queue[currentIndex];

  const handleShowAnswer = () => setShowAnswer(true);

  const handleAnswer = useCallback(async (rating: ReviewRating) => {
    if (!currentCard || !session || !user) return;
    const responseTimeMs = Date.now() - cardStartTime;
    const preset = getPresetForDeck(currentCard.card.deckId);

    try {
      await answerCard(user.id, currentCard.card, rating, responseTimeMs, session.id, preset);

      setStats(prev => ({
        studied: prev.studied + 1,
        again: prev.again + (rating === 'again' ? 1 : 0),
        good: prev.good + (rating === 'good' || rating === 'easy' ? 1 : 0),
        totalTimeMs: prev.totalTimeMs + responseTimeMs,
      }));

      const nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        const result = await finishRescueSession(user.id, session.id);
        setXpAwarded(result.xpAwarded);
        setPhase('done');
      } else {
        setCurrentIndex(nextIndex);
        setShowAnswer(false);
        setCardStartTime(Date.now());
        const nextPreset = getPresetForDeck(queue[nextIndex].card.deckId);
        setPreviews(previewIntervals(queue[nextIndex].card, nextPreset));
      }
    } catch (err) {
      console.error('Failed to answer card:', err);
    }
  }, [currentCard, session, user, cardStartTime, currentIndex, queue, getPresetForDeck]);

  // Keyboard shortcuts
  useEffect(() => {
    if (phase !== 'studying') return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!showAnswer) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleShowAnswer(); }
      } else {
        switch (e.key) {
          case '1': handleAnswer('again'); break;
          case '2': handleAnswer('hard'); break;
          case '3': handleAnswer('good'); break;
          case '4': handleAnswer('easy'); break;
          case ' ': case 'Enter': e.preventDefault(); handleAnswer('good'); break;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, showAnswer, handleAnswer]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ─── Choose mode ────────────────────────────────────────────────────
  if (phase === 'choose') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <h1 className="text-2xl font-bold">Rescate Rápido</h1>
          <p className="text-muted-foreground">Sesiones cortas para días difíciles</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="cursor-pointer hover:border-red-400 transition-colors" onClick={() => startRescue('high_risk')}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="font-medium">Alto Riesgo</p>
                  <p className="text-xs text-muted-foreground">{rescueStats.highRisk} tarjetas</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Tarjetas con R &lt; 50%. A punto de olvidarlas.
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-orange-400 transition-colors" onClick={() => startRescue('overdue')}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900">
                  <Clock className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium">Atrasadas</p>
                  <p className="text-xs text-muted-foreground">{rescueStats.overdue} tarjetas</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Tarjetas pasadas de fecha. Las más antiguas primero.
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-blue-400 transition-colors" onClick={() => startRescue('due_now')}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                  <Target className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Pendientes Ahora</p>
                  <p className="text-xs text-muted-foreground">{rescueStats.dueNow} tarjetas</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Todo lo que debería revisarse hoy.
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-emerald-400 transition-colors" onClick={() => startRescue('quick_5')}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
                  <Zap className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="font-medium">Rápido (5 tarjetas)</p>
                  <p className="text-xs text-muted-foreground">~2 minutos</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Mix de riesgo + atrasadas. Sesión ultra-rápida.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── Done ───────────────────────────────────────────────────────────
  if (phase === 'done') {
    const accuracy = stats.studied > 0 ? (stats.good / stats.studied) * 100 : 0;
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="text-5xl">🛟</div>
            <h2 className="text-2xl font-bold">¡Rescate Completado!</h2>
            <div className="grid grid-cols-2 gap-4 text-left">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Tarjetas Rescatadas</p>
                <p className="text-2xl font-bold">{stats.studied}</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Tiempo</p>
                <p className="text-2xl font-bold">{formatDuration(stats.totalTimeMs)}</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Precisión</p>
                <p className="text-2xl font-bold">{accuracy.toFixed(0)}%</p>
              </div>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950 p-3">
                <p className="text-xs text-muted-foreground">XP Ganado</p>
                <p className="text-2xl font-bold text-amber-600">+{xpAwarded}</p>
              </div>
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => { setPhase('choose'); setStats({ studied: 0, again: 0, good: 0, totalTimeMs: 0 }); }}>
                Otra Sesión
              </Button>
              <Button onClick={() => router.push('/dashboard')}>
                Ir al Inicio
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Studying ───────────────────────────────────────────────────────
  if (!currentCard) return null;

  const { note, noteType, template, card: studyCard } = currentCard;
  const progress = ((currentIndex + 1) / queue.length) * 100;

  const renderFront = () => {
    let html = renderTemplate(template.frontTemplate, note.fieldValues);
    if (noteType.kind === 'cloze') {
      const clozeIndex = (studyCard.customData as Record<string, number>)?.clozeIndex || 1;
      html = processCloze(html, clozeIndex);
    }
    return sanitizeHtml(html);
  };

  const renderBack = () => {
    let html = template.backTemplate;
    const frontHtml = renderTemplate(template.frontTemplate, note.fieldValues);
    html = html.replace('{{FrontSide}}', frontHtml);
    html = renderTemplate(html, note.fieldValues);
    if (noteType.kind === 'cloze') {
      const clozeIndex = (studyCard.customData as Record<string, number>)?.clozeIndex || 1;
      html = processClozeAnswer(html, clozeIndex);
    }
    return sanitizeHtml(html);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="gap-1">
          <Shield className="h-3 w-3" /> Rescate
        </Badge>
        <span className="text-sm text-muted-foreground">
          {currentIndex + 1} / {queue.length}
        </span>
      </div>

      <Progress value={progress} className="h-1.5" />

      {/* Card */}
      <Card className="min-h-75">
        <CardContent className="pt-6">
          {/* Front */}
          <div
            className="prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderFront() }}
          />

          {/* Divider + Back */}
          {showAnswer && (
            <>
              <hr className="my-6" />
              <div
                className="prose dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderBack() }}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Answer buttons */}
      {!showAnswer ? (
        <Button className="w-full" size="lg" onClick={handleShowAnswer}>
          Mostrar Respuesta
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <Button variant="destructive" onClick={() => handleAnswer('again')} className="flex flex-col h-auto py-2">
            <span className="text-xs">Otra vez</span>
            {previews && <span className="text-[10px] opacity-70">{previews.again.interval}</span>}
          </Button>
          <Button variant="outline" onClick={() => handleAnswer('hard')} className="flex flex-col h-auto py-2">
            <span className="text-xs">Difícil</span>
            {previews && <span className="text-[10px] opacity-70">{previews.hard.interval}</span>}
          </Button>
          <Button variant="default" onClick={() => handleAnswer('good')} className="flex flex-col h-auto py-2">
            <span className="text-xs">Bien</span>
            {previews && <span className="text-[10px] opacity-70">{previews.good.interval}</span>}
          </Button>
          <Button variant="secondary" onClick={() => handleAnswer('easy')} className="flex flex-col h-auto py-2">
            <span className="text-xs">Fácil</span>
            {previews && <span className="text-[10px] opacity-70">{previews.easy.interval}</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
