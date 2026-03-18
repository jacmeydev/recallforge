'use client';
/* eslint-disable react-hooks/exhaustive-deps */

import React, { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  SkipForward,
  Ban,
  RotateCcw,
  Eye,
  EyeOff,
  Trophy,
  Zap,
  Clock,
  ChevronDown,
  GraduationCap,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, useStudyStore } from '@/lib/store';
import { buildStudyQueue, startStudySession, answerCard, finishStudySession, previewIntervals } from '@/lib/services/study-service';
import { buryCard, suspendCard } from '@/lib/services/card-service';
import { renderTemplate, processCloze, processClozeAnswer, sanitizeHtml, formatDuration, processIOFront, processIOBack } from '@/lib/utils';
import type { StudyQueueCard, IntervalPreview, ReviewRating, AcademicMeta } from '@/types';

interface StudyPageProps {
  params: Promise<{ deckId: string }>;
}

export default function StudyPage({ params }: StudyPageProps) {
  const { deckId } = use(params);
  const router = useRouter();
  const { user, getPresetForDeck } = useAppStore();
  const {
    session, setSession,
    preloadedQueue, setPreloadedQueue,
    showAnswer, setShowAnswer,
    cardStartTime, setCardStartTime,
    focusMode, setFocusMode,
    isFinished, setIsFinished,
  } = useStudyStore();

  const [queue, setQueue] = useState<StudyQueueCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previews, setPreviews] = useState<IntervalPreview | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [showTypedResult, setShowTypedResult] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cardAnim, setCardAnim] = useState<'enter' | 'exit' | 'idle'>('idle');
  const [answerAnim, setAnswerAnim] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    studied: 0, again: 0, hard: 0, good: 0, easy: 0, totalTimeMs: 0,
  });

  const cardRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [initialQueueSize, setInitialQueueSize] = useState(0);
  const currentCard = queue[currentIndex];
  const preset = getPresetForDeck(deckId);

  // Initialize study session
  useEffect(() => {
    async function init() {
      if (!user) return;
      setIsFinished(false);

      try {
        let studyQueue: StudyQueueCard[];
        let existingSession = session;

        if (preloadedQueue && preloadedQueue.length > 0) {
          studyQueue = preloadedQueue;
          setPreloadedQueue(null);
        } else {
          studyQueue = await buildStudyQueue(user.id, deckId, preset.dailyLimits);
          existingSession = null;
        }

        if (studyQueue.length === 0) {
          // No due cards — let the !currentCard branch render "Sin tarjetas"
          setIsFinished(false);
          setQueue([]);
          setLoading(false);
          return;
        }

        if (!existingSession) {
          const newSession = await startStudySession(user.id, [deckId]);
          setSession(newSession);
        }
        setQueue(studyQueue);
        setInitialQueueSize(studyQueue.length);
        setCurrentIndex(0);
        setShowAnswer(false);
        setCardStartTime(Date.now());
        setIsFinished(false);
        setCardAnim('enter');

        const firstPreviews = previewIntervals(studyQueue[0].card, preset);
        setPreviews(firstPreviews);
      } catch (err) {
        console.error('Failed to start study session:', err);
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      setSession(null);
      setShowAnswer(false);
      setIsFinished(false);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [deckId, user]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (!showAnswer) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleShowAnswer();
        }
      } else {
        switch (e.key) {
          case '1': handleAnswer('again'); break;
          case '2': handleAnswer('hard'); break;
          case '3': handleAnswer('good'); break;
          case '4': handleAnswer('easy'); break;
          case ' ':
          case 'Enter':
            e.preventDefault();
            handleAnswer('good');
            break;
        }
      }

      if (e.key === 'f') setFocusMode(!focusMode);
      if (e.key === 'b' && currentCard) handleBury();
      if (e.key === '@' && currentCard) handleSuspend();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAnswer, currentCard, focusMode]);

  const handleShowAnswer = () => {
    if (currentCard?.noteType.kind === 'type_answer' && !showTypedResult) {
      setShowTypedResult(true);
      setShowAnswer(true);
      setAnswerAnim(true);
      return;
    }
    setShowAnswer(true);
    setAnswerAnim(true);
  };

  const handleAnswer = useCallback(async (rating: ReviewRating) => {
    if (!currentCard || !session || !user || processingRef.current) return;
    processingRef.current = true;

    const responseTimeMs = Date.now() - cardStartTime;

    try {
      const { updatedCard } = await answerCard(
        user.id,
        currentCard.card,
        rating,
        responseTimeMs,
        session.id,
        preset
      );

      setSessionStats(prev => ({
        studied: prev.studied + 1,
        again: prev.again + (rating === 'again' ? 1 : 0),
        hard: prev.hard + (rating === 'hard' ? 1 : 0),
        good: prev.good + (rating === 'good' ? 1 : 0),
        easy: prev.easy + (rating === 'easy' ? 1 : 0),
        totalTimeMs: prev.totalTimeMs + responseTimeMs,
      }));

      // Re-queue learning/relearning cards (like Anki) so they appear again this session
      const requeue = updatedCard.state === 'learning' || updatedCard.state === 'relearning';

      // Use functional updater to get latest queue length (avoids stale closure)
      let shouldFinish = false;
      const nextIndex = currentIndex + 1;

      setQueue(prev => {
        const updated = requeue ? [...prev, { ...currentCard, card: updatedCard }] : prev;
        if (nextIndex >= updated.length) {
          shouldFinish = true;
        }
        return updated;
      });

      // React processes the setState synchronously in the same microtask,
      // so shouldFinish is set correctly by now
      if (shouldFinish) {
        await finishStudySession(user.id, session.id);
        setIsFinished(true);
        processingRef.current = false;
      } else {
        // Animate out, then in
        setCardAnim('exit');
        animTimerRef.current = setTimeout(() => {
          setCurrentIndex(nextIndex);
          setShowAnswer(false);
          setShowTypedResult(false);
          setTypedAnswer('');
          setAnswerAnim(false);
          setCardStartTime(Date.now());
          setCardAnim('enter');

          setQueue(latestQueue => {
            if (latestQueue[nextIndex]) {
              const nextPreviews = previewIntervals(latestQueue[nextIndex].card, preset);
              setPreviews(nextPreviews);
            }
            return latestQueue;
          });
          processingRef.current = false;
        }, 200);
      }
    } catch (err) {
      console.error('Failed to answer card:', err);
      processingRef.current = false;
    }
  }, [currentCard, session, user, cardStartTime, currentIndex, preset]);

  const handleBury = async () => {
    if (!currentCard || !user) return;
    await buryCard(user.id, currentCard.card.id);
    skipToNext();
  };

  const handleSuspend = async () => {
    if (!currentCard || !user) return;
    await suspendCard(user.id, currentCard.card.id);
    skipToNext();
  };

  const skipToNext = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (session && user) {
        await finishStudySession(user.id, session.id);
      }
      setIsFinished(true);
    } else {
      setCardAnim('exit');
      animTimerRef.current = setTimeout(() => {
        setCurrentIndex(nextIndex);
        setShowAnswer(false);
        setShowTypedResult(false);
        setTypedAnswer('');
        setAnswerAnim(false);
        setCardStartTime(Date.now());
        setCardAnim('enter');
        const nextPreviews = previewIntervals(queue[nextIndex].card, preset);
        setPreviews(nextPreviews);
      }, 200);
    }
  };

  // Render card content
  const renderFront = () => {
    if (!currentCard) return '';
    const { note, noteType, template } = currentCard;

    if (noteType.kind === 'image_occlusion') {
      const maskIndex = (currentCard.card.customData as Record<string, number>)?.maskIndex ?? 0;
      const header = note.fieldValues['Header'] || '';
      const headerHtml = header ? `<div class="io-header">${sanitizeHtml(header)}</div>` : '';
      return headerHtml + processIOFront(note.fieldValues['Image'] || '', note.fieldValues['Masks'] || '[]', maskIndex);
    }

    let html = renderTemplate(template.frontTemplate, note.fieldValues);

    if (noteType.kind === 'cloze') {
      const clozeIndex = (currentCard.card.customData as Record<string, number>)?.clozeIndex || 1;
      html = processCloze(html, clozeIndex);
    }

    if (noteType.kind === 'type_answer') {
      html = html.replace('{{type:Answer}}', '');
    }

    return sanitizeHtml(html);
  };

  const renderBack = () => {
    if (!currentCard) return '';
    const { note, noteType, template } = currentCard;

    if (noteType.kind === 'image_occlusion') {
      const maskIndex = (currentCard.card.customData as Record<string, number>)?.maskIndex ?? 0;
      const header = note.fieldValues['Header'] || '';
      const extra = note.fieldValues['Extra'] || '';
      const headerHtml = header ? `<div class="io-header">${sanitizeHtml(header)}</div>` : '';
      const extraHtml = extra ? `<div class="extra">${sanitizeHtml(extra)}</div>` : '';
      return headerHtml + processIOBack(note.fieldValues['Image'] || '', note.fieldValues['Masks'] || '[]', maskIndex) + extraHtml;
    }

    let html = template.backTemplate;

    // Remove {{FrontSide}} — the study UI already shows the front separately
    html = html.replace('{{FrontSide}}', '');
    html = renderTemplate(html, note.fieldValues);

    if (noteType.kind === 'cloze') {
      const clozeIndex = (currentCard.card.customData as Record<string, number>)?.clozeIndex || 1;
      html = processClozeAnswer(html, clozeIndex);
    }

    return sanitizeHtml(html);
  };

  // ─── Loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-muted-foreground animate-pulse">Preparando sesión...</p>
        </div>
      </div>
    );
  }

  // ─── Finished ─────────────────────────────────────────────────────────

  if (isFinished) {
    const accuracy = sessionStats.studied > 0
      ? ((sessionStats.good + sessionStats.easy) / sessionStats.studied * 100).toFixed(0)
      : '0';

    return (
      <div className="max-w-md mx-auto mt-8 px-4 animate-[fadeInUp_0.5s_ease-out]">
        <div className="rounded-2xl border bg-card shadow-lg overflow-hidden">
          {/* Gradient header */}
          <div className="bg-linear-to-br from-emerald-500 via-emerald-600 to-teal-600 px-6 py-8 text-center text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.1),transparent)]" />
            <div className="relative">
              <div className="text-5xl mb-3 animate-[bounceIn_0.6s_ease-out_0.2s_both]">🎉</div>
              <h2 className="text-2xl font-bold">¡Sesión Completada!</h2>
              <p className="text-emerald-100 text-sm mt-1">Buen trabajo, sigue así</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={<Zap className="h-4 w-4 text-amber-500" />} label="Estudiadas" value={sessionStats.studied} />
              <StatCard icon={<Clock className="h-4 w-4 text-blue-500" />} label="Tiempo" value={formatDuration(sessionStats.totalTimeMs)} />
              <StatCard icon={<Trophy className="h-4 w-4 text-emerald-500" />} label="Precisión" value={`${accuracy}%`} />
              <StatCard
                icon={<RotateCcw className="h-4 w-4 text-purple-500" />}
                label="T. Promedio"
                value={sessionStats.studied > 0 ? formatDuration(sessionStats.totalTimeMs / sessionStats.studied) : '—'}
              />
            </div>

            {/* Rating breakdown */}
            <div className="flex justify-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> {sessionStats.again}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500" /> {sessionStats.hard}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> {sessionStats.good}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> {sessionStats.easy}
              </span>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => router.push('/dashboard')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Inicio
              </Button>
              <Button className="flex-1" onClick={() => router.push('/decks')}>
                Seguir Estudiando
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── No cards ─────────────────────────────────────────────────────────

  if (!currentCard) {
    return (
      <div className="text-center py-16 animate-[fadeIn_0.3s_ease-out]">
        <div className="text-4xl mb-4">📭</div>
        <p className="text-muted-foreground text-lg">Sin tarjetas para estudiar</p>
        <Button variant="outline" className="mt-6" onClick={() => router.push('/decks')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a Mazos
        </Button>
      </div>
    );
  }

  // ─── Study UI ─────────────────────────────────────────────────────────

  const progressPercent = initialQueueSize > 0
    ? Math.min(((currentIndex) / initialQueueSize) * 100, 100)
    : 0;

  const stateConfig = {
    new: { label: 'Nueva', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
    learning: { label: 'Aprendiendo', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
    relearning: { label: 'Re-aprendiendo', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
    review: { label: 'Repaso', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  };

  const state = stateConfig[currentCard.card.state as keyof typeof stateConfig] || stateConfig.new;

  return (
    <div className={cn(
      'flex flex-col',
      focusMode
        ? 'fixed inset-0 z-50 bg-background'
        : 'max-w-3xl mx-auto min-h-[calc(100vh-4rem)]'
    )}>
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center justify-between py-3',
        focusMode ? 'px-6 border-b bg-card/50 backdrop-blur-sm' : ''
      )}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/decks')}
            className="p-2 -ml-2 rounded-lg hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{currentCard.deck.name}</h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {Math.min(currentIndex + 1, initialQueueSize)} / {initialQueueSize}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border',
            state.color
          )}>
            {state.label}
          </span>
          <button
            onClick={() => setFocusMode(!focusMode)}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Progress Bar ────────────────────────────────────────── */}
      <div className="h-1 bg-muted/50 relative overflow-hidden rounded-full mx-1">
        <div
          className="absolute inset-y-0 left-0 bg-linear-to-r from-primary/80 to-primary rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* ── Academic Metadata Chips ─────────────────────────────── */}
      <AcademicChips note={currentCard.note} />

      {/* ── Card ────────────────────────────────────────────────── */}
      <div className={cn('flex-1 flex items-center justify-center py-6', focusMode ? 'px-6' : 'px-2')}>
        <div
          ref={cardRef}
          className={cn(
            'study-card-wrapper w-full max-w-2xl',
            'transition-all duration-300 ease-out',
            cardAnim === 'enter' && 'animate-[cardIn_0.3s_ease-out]',
            cardAnim === 'exit' && 'animate-[cardOut_0.2s_ease-in_forwards]',
          )}
        >
          <div className="p-8 md:p-10 study-card">
            {/* Front — when answer is shown, render as subdued reference */}
            <div
              className={cn(
                'prose prose-lg dark:prose-invert max-w-none prose-p:leading-relaxed',
                showAnswer && 'opacity-60 text-sm',
              )}
              dangerouslySetInnerHTML={{ __html: renderFront() }}
            />
            {showAnswer && (
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1 mb-0">Pregunta</div>
            )}

            {/* Type Answer Input */}
            {currentCard.noteType.kind === 'type_answer' && !showAnswer && (
              <div className="mt-6">
                <Input
                  placeholder="Escribe tu respuesta..."
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleShowAnswer()}
                  className="text-center text-lg rounded-xl h-12 border-2 focus:border-primary"
                  autoFocus
                />
              </div>
            )}

            {/* Show Answer Button or Answer Content */}
            {!showAnswer ? (
              <div className="mt-10 text-center">
                <button
                  onClick={handleShowAnswer}
                  className={cn(
                    'group relative inline-flex items-center gap-2 px-8 py-3.5 rounded-xl',
                    'bg-primary text-primary-foreground font-semibold text-base',
                    'shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35',
                    'hover:scale-[1.03] active:scale-[0.97]',
                    'transition-all duration-200',
                    'animate-[subtlePulse_2.5s_ease-in-out_infinite]',
                  )}
                >
                  <Eye className="h-4.5 w-4.5" />
                  Mostrar Respuesta
                  <ChevronDown className="h-4 w-4 opacity-50 group-hover:translate-y-0.5 transition-transform" />
                </button>
                <p className="text-xs text-muted-foreground mt-3 opacity-60">
                  Espacio o Enter
                </p>
              </div>
            ) : (
              <div className={cn(
                answerAnim && 'animate-[revealAnswer_0.35s_ease-out]',
              )}>
                {/* Divider */}
                <div className="my-8 flex items-center gap-3">
                  <div className="flex-1 h-px bg-linear-to-r from-transparent via-border to-transparent" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Respuesta</span>
                  <div className="flex-1 h-px bg-linear-to-r from-transparent via-border to-transparent" />
                </div>

                {/* Type answer comparison */}
                {currentCard.noteType.kind === 'type_answer' && (
                  <TypeAnswerResult
                    typed={typedAnswer}
                    correct={currentCard.note.fieldValues['Answer'] || ''}
                  />
                )}

                {/* Back */}
                <div
                  className="prose prose-lg dark:prose-invert max-w-none prose-p:leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderBack() }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Answer Buttons ──────────────────────────────────────── */}
      {showAnswer && (
        <div className={cn(
          'pb-6 animate-[slideUp_0.3s_ease-out]',
          focusMode ? 'px-6' : '',
        )}>
          <div className="flex flex-col items-center gap-3 max-w-2xl mx-auto w-full">
            <div className="grid grid-cols-4 gap-2.5 w-full">
              <AnswerButton
                rating="again"
                label="Otra vez"
                interval={previews?.again.interval}
                shortcut="1"
                onClick={() => handleAnswer('again')}
              />
              <AnswerButton
                rating="hard"
                label="Difícil"
                interval={previews?.hard.interval}
                shortcut="2"
                onClick={() => handleAnswer('hard')}
              />
              <AnswerButton
                rating="good"
                label="Bien"
                interval={previews?.good.interval}
                shortcut="3"
                onClick={() => handleAnswer('good')}
              />
              <AnswerButton
                rating="easy"
                label="Fácil"
                interval={previews?.easy.interval}
                shortcut="4"
                onClick={() => handleAnswer('easy')}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handleBury}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Enterrar (b)"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Enterrar
              </button>
              <span className="text-muted-foreground/30">·</span>
              <button
                onClick={handleSuspend}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Suspender (@)"
              >
                <Ban className="h-3.5 w-3.5" />
                Suspender
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Answer Button Component ────────────────────────────────────────────

const ratingConfig = {
  again: {
    emoji: '❌',
    border: 'border-red-500/30 hover:border-red-500/60',
    badgeBg: 'bg-red-500/20 text-red-400',
    glow: 'hover:shadow-red-500/10',
  },
  hard: {
    emoji: '😬',
    border: 'border-orange-500/30 hover:border-orange-500/60',
    badgeBg: 'bg-orange-500/20 text-orange-400',
    glow: 'hover:shadow-orange-500/10',
  },
  good: {
    emoji: '😊',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    badgeBg: 'bg-emerald-500/20 text-emerald-400',
    glow: 'hover:shadow-emerald-500/10',
  },
  easy: {
    emoji: '👑',
    border: 'border-blue-500/30 hover:border-blue-500/60',
    badgeBg: 'bg-blue-500/20 text-blue-400',
    glow: 'hover:shadow-blue-500/10',
  },
};

function AnswerButton({
  rating,
  label,
  interval,
  shortcut,
  onClick,
}: {
  rating: ReviewRating;
  label: string;
  interval?: string;
  shortcut: string;
  onClick: () => void;
}) {
  const config = ratingConfig[rating];

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center rounded-xl py-4 px-3',
        'bg-card border-2 shadow-sm',
        'hover:scale-[1.04] active:scale-[0.96]',
        'hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'transition-all duration-150',
        config.border,
        config.glow,
      )}
    >
      <span className="text-2xl mb-1.5 select-none">{config.emoji}</span>
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <span className={cn(
        'mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums',
        config.badgeBg,
      )}>
        {interval || '—'}
      </span>
      <span className="absolute top-1 right-1.5 text-[9px] text-muted-foreground/40 font-mono">{shortcut}</span>
    </button>
  );
}

// ─── Stat Card (Finish Screen) ──────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-muted/50 border p-3.5 flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <p className="text-xl font-bold tabular-nums tracking-tight">{value}</p>
      </div>
    </div>
  );
}

// ─── Type Answer Result ─────────────────────────────────────────────────

function TypeAnswerResult({ typed, correct }: { typed: string; correct: string }) {
  const isCorrect = typed.trim().toLowerCase() === correct.trim().toLowerCase();

  return (
    <div className={cn(
      'my-4 p-4 rounded-xl border-2 transition-colors',
      isCorrect
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-red-500/30 bg-red-500/5',
    )}>
      <div className="text-xs font-medium text-muted-foreground mb-1.5">Tu respuesta:</div>
      <div className={cn(
        'text-lg font-semibold',
        isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
      )}>
        {typed || '(vacío)'}
      </div>
      {!isCorrect && (
        <>
          <div className="text-xs font-medium text-muted-foreground mt-3 mb-1.5">Respuesta correcta:</div>
          <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{correct}</div>
        </>
      )}
    </div>
  );
}

// ─── Academic Metadata Chips ────────────────────────────────────────────

const priorityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: 'Crítica', color: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  high: { label: 'Alta', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  medium: { label: 'Media', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  low: { label: 'Baja', color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
};

const difficultyConfig: Record<string, { label: string; color: string }> = {
  very_hard: { label: 'Muy difícil', color: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  hard: { label: 'Difícil', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  medium: { label: 'Media', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  easy: { label: 'Fácil', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
};

const aiReviewConfig: Record<string, { label: string; color: string }> = {
  'pending-review': { label: 'Pendiente revisión', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  'reviewed': { label: 'Revisada', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'corrected': { label: 'Corregida', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
};

function AcademicChips({ note }: { note: { sourceMetadata?: Record<string, unknown> | null } }) {
  const acad = (note.sourceMetadata as Record<string, unknown>)?.academic as AcademicMeta | undefined;
  if (!acad) return null;

  const chips: React.ReactNode[] = [];

  // Subject / Chapter / Topic breadcrumb
  const breadcrumb = [acad.subject, acad.chapter, acad.topic].filter(Boolean);
  if (breadcrumb.length > 0) {
    chips.push(
      <span key="breadcrumb" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[11px] font-medium">
        <GraduationCap className="h-3 w-3" />
        {breadcrumb.join(' › ')}
      </span>
    );
  }

  // Priority
  const prio = acad.priority && priorityConfig[acad.priority];
  if (prio) {
    chips.push(
      <span key="prio" className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium', prio.color)}>
        P: {prio.label}
      </span>
    );
  }

  // Conceptual difficulty
  const diff = acad.conceptualDifficulty && difficultyConfig[acad.conceptualDifficulty];
  if (diff) {
    chips.push(
      <span key="diff" className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium', diff.color)}>
        D: {diff.label}
      </span>
    );
  }

  // AI generated badge
  if (acad.aiGenerated) {
    chips.push(
      <span key="ai" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11px] font-medium">
        <Sparkles className="h-3 w-3" />
        IA
      </span>
    );
  }

  // AI review status
  const aiReview = acad.aiReviewStatus && aiReviewConfig[acad.aiReviewStatus];
  if (aiReview) {
    chips.push(
      <span key="aiReview" className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium', aiReview.color)}>
        <AlertCircle className="h-3 w-3" />
        {aiReview.label}
      </span>
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2">
      {chips}
    </div>
  );
}
