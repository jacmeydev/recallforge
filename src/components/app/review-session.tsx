'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, formatDue } from '@/lib/api/client';
import type { NextCardResult, RevealResult } from '@/lib/core/study';
import type { Rating } from '@/lib/core/types';

const RATINGS: Array<{ rating: Rating; label: string; key: string; variant: 'again' | 'hard' | 'good' | 'easy' }> = [
  { rating: 'again', label: 'Otra vez', key: '1', variant: 'again' },
  { rating: 'hard', label: 'Difícil', key: '2', variant: 'hard' },
  { rating: 'good', label: 'Bien', key: '3', variant: 'good' },
  { rating: 'easy', label: 'Fácil', key: '4', variant: 'easy' },
];

export function ReviewSession({ deck, tag, mode }: { deck?: string; tag?: string; mode?: 'exam' }) {
  const [queue, setQueue] = useState<NextCardResult | null>(null);
  const [revealed, setRevealed] = useState<RevealResult | null>(null);
  const [answer, setAnswer] = useState('');
  const [reviewed, setReviewed] = useState(0);
  const [lastGraded, setLastGraded] = useState<{ id: string; rating: Rating } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shownAt = useRef(Date.now());

  const filterQuery = new URLSearchParams({ ...(deck ? { deck } : {}), ...(tag ? { tag } : {}), ...(mode ? { mode } : {}) }).toString();

  useEffect(() => {
    api<NextCardResult>(`/api/v1/study/next${filterQuery ? `?${filterQuery}` : ''}`)
      .then((data) => {
        setQueue(data);
        shownAt.current = Date.now();
      })
      .catch((err) => setError(err.message));
  }, [filterQuery]);

  const reveal = useCallback(async () => {
    if (!queue?.card || revealed || busy) return;
    setBusy(true);
    try {
      setRevealed(await api<RevealResult>('/api/v1/study/reveal', { method: 'POST', body: { cardId: queue.card.id } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }, [queue, revealed, busy]);

  const grade = useCallback(
    async (rating: Rating) => {
      if (!queue?.card || !revealed || busy) return;
      setBusy(true);
      try {
        const data = await api<{ next: NextCardResult }>('/api/v1/study/grade', {
          method: 'POST',
          body: {
            cardId: queue.card.id,
            rating,
            answer: answer.trim() || undefined,
            durationMs: Date.now() - shownAt.current,
            deck,
            tag,
            mode,
          },
        });
        setQueue(data.next);
        setRevealed(null);
        setAnswer('');
        setReviewed((n) => n + 1);
        setLastGraded({ id: queue.card.id, rating });
        shownAt.current = Date.now();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setBusy(false);
      }
    },
    [queue, revealed, busy, answer, deck, tag, mode]
  );

  const undo = useCallback(async () => {
    if (!lastGraded || busy) return;
    setBusy(true);
    try {
      const data = await api<{ card: NonNullable<NextCardResult['card']> }>('/api/v1/study/undo', {
        method: 'POST',
        body: { cardId: lastGraded.id },
      });
      setQueue((current) => (current ? { ...current, card: data.card } : current));
      setRevealed(null);
      setAnswer('');
      setReviewed((n) => Math.max(0, n - 1));
      setLastGraded(null);
      shownAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }, [lastGraded, busy]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.key === 'z' || event.key === 'Z') && !(event.target instanceof HTMLTextAreaElement)) {
        void undo();
        return;
      }
      const typing = event.target instanceof HTMLTextAreaElement;
      if (!revealed && event.key === 'Enter' && (event.ctrlKey || event.metaKey || !typing)) {
        event.preventDefault();
        void reveal();
      } else if (!revealed && event.key === ' ' && !typing) {
        event.preventDefault();
        void reveal();
      } else if (revealed && !typing) {
        const option = RATINGS.find((r) => r.key === event.key);
        if (option) void grade(option.rating);
        if (event.key === ' ') {
          event.preventDefault();
          void grade('good');
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, reveal, grade, undo]);

  if (error) return <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!queue) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const remaining = queue.remaining.learning + queue.remaining.review + queue.remaining.new;

  if (!queue.card) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold">{reviewed > 0 ? `¡Listo! ${reviewed} tarjetas repasadas` : 'Nada pendiente'}</h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'exam'
            ? queue.message
            : queue.nextDueAt
              ? `La próxima tarjeta vence ${formatDue(queue.nextDueAt)}.`
              : 'No hay tarjetas programadas.'}
          {mode !== 'exam' && queue.message?.includes('limit')
            ? ' Alcanzaste el límite diario de tarjetas nuevas (ajústalo en Agentes y ajustes).'
            : ''}
        </p>
        <div className="flex justify-center gap-2">
          {lastGraded && (
            <Button variant="ghost" onClick={() => void undo()} disabled={busy}>
              Deshacer la última
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    );
  }

  const card = queue.card;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {card.deck.name}
          {card.tags.length > 0 && ` · ${card.tags.join(', ')}`}
        </span>
        <span className="tabular-nums">
          <span className="text-red-600">{queue.remaining.learning}</span> ·{' '}
          <span className="text-emerald-600">{queue.remaining.review}</span> ·{' '}
          <span className="text-blue-600">{queue.remaining.new}</span> ({remaining} restantes)
          {mode === 'exam' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">modo examen</span>}
          {lastGraded && (
            <button className="ml-3 underline hover:text-foreground" onClick={() => void undo()} disabled={busy} title="Tecla Z">
              Deshacer
            </button>
          )}
        </span>
      </div>

      <div className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="whitespace-pre-wrap text-center text-xl leading-relaxed">{card.front}</p>

        {!revealed ? (
          <div className="space-y-3">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Escribe tu respuesta de memoria (opcional) y pulsa Ctrl+Enter"
              rows={3}
              autoFocus
            />
            <Button className="w-full" size="lg" onClick={() => void reveal()} disabled={busy}>
              Mostrar respuesta
            </Button>
          </div>
        ) : (
          <div className="space-y-4 border-t pt-6">
            {answer.trim() && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="text-xs text-muted-foreground">Tu respuesta</div>
                <p className="whitespace-pre-wrap">{answer}</p>
              </div>
            )}
            <p className="whitespace-pre-wrap text-center text-lg font-medium text-primary">{revealed.card.back}</p>
            {revealed.card.explanation && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{revealed.card.explanation}</p>
            )}
            {revealed.card.source && <p className="text-xs text-muted-foreground">Fuente: {revealed.card.source}</p>}
            {revealed.recentAttempts.some((a) => a.rating === 'again' && a.answer) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Errores anteriores:{' '}
                {revealed.recentAttempts
                  .filter((a) => a.rating === 'again' && a.answer)
                  .map((a) => `“${a.answer}”`)
                  .join(', ')}
              </div>
            )}
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ rating, label, key, variant }) => (
                <Button key={rating} variant={variant} className="h-auto flex-col py-2" onClick={() => void grade(rating)} disabled={busy}>
                  <span>{label}</span>
                  <span className="text-[11px] font-normal opacity-80">
                    {revealed.outcomes[rating].interval} · {key}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
