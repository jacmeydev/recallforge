'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, formatDue } from '@/lib/api/client';
import type { QuestionFormat } from '@/lib/core/formats';
import type { GradeResult, NextCardResult, RevealResult } from '@/lib/core/study';
import type { Rating } from '@/lib/core/types';
import { CardSource, ExplainButton } from './card-source';

const RATINGS: Array<{ rating: Rating; label: string; key: string; variant: 'again' | 'hard' | 'good' | 'easy' }> = [
  { rating: 'again', label: 'Otra vez', key: '1', variant: 'again' },
  { rating: 'hard', label: 'Difícil', key: '2', variant: 'hard' },
  { rating: 'good', label: 'Bien', key: '3', variant: 'good' },
  { rating: 'easy', label: 'Fácil', key: '4', variant: 'easy' },
];

const RATING_LABEL: Record<Rating, string> = { again: 'Otra vez', hard: 'Difícil', good: 'Bien', easy: 'Fácil' };

export type SessionMode = 'normal' | 'exam' | 'quick';

/** Cards in a quick session. */
export const QUICK_SIZE = 10;

const MODES: Array<{ mode: SessionMode; label: string; hint: string }> = [
  { mode: 'normal', label: 'Repaso', hint: 'Repetición espaciada con tus límites diarios' },
  { mode: 'quick', label: 'Rápida', hint: `Solo lo pendiente, ${QUICK_SIZE} tarjetas como máximo` },
  { mode: 'exam', label: 'Examen', hint: 'Lo que más riesgo tiene de olvidarse el día del examen' },
];

const FORMATS: Array<{ format: QuestionFormat; label: string; hint: string }> = [
  { format: 'recall', label: 'Recordar', hint: 'Respondes de memoria y te autoevalúas' },
  { format: 'typing', label: 'Escribir', hint: 'Escribes la respuesta y la comparas' },
  { format: 'multiple_choice', label: 'Opción múltiple', hint: 'Práctica: no cambia la programación' },
  { format: 'true_false', label: 'Verdadero/falso', hint: 'Práctica: no cambia la programación' },
];

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

interface Props {
  deck?: string;
  tag?: string;
  mode?: SessionMode;
  format?: QuestionFormat;
}

export function ReviewSession({ deck, tag, mode = 'normal', format = 'recall' }: Props) {
  const practice = format === 'multiple_choice' || format === 'true_false';
  const [queue, setQueue] = useState<NextCardResult | null>(null);
  const [revealed, setRevealed] = useState<RevealResult | null>(null);
  /** Practice formats: the objective result of the last answer, shown before moving on. */
  const [checked, setChecked] = useState<{ result: GradeResult; next: NextCardResult } | null>(null);
  const [answer, setAnswer] = useState('');
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [lastGraded, setLastGraded] = useState<{ id: string; rating: Rating; front: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shownAt = useRef(Date.now());

  const filter = { deck, tag, mode: mode === 'normal' ? undefined : mode, format: format === 'recall' ? undefined : format };
  const filterQuery = new URLSearchParams(
    Object.entries(filter).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  ).toString();

  useEffect(() => {
    api<NextCardResult>(`/api/v1/study/next${filterQuery ? `?${filterQuery}` : ''}`)
      .then((data) => {
        setQueue(data);
        shownAt.current = Date.now();
      })
      .catch((err) => setError(err.message));
  }, [filterQuery]);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Error');

  const reveal = useCallback(async () => {
    if (!queue?.card || revealed || busy || practice) return;
    setBusy(true);
    try {
      setRevealed(await api<RevealResult>('/api/v1/study/reveal', { method: 'POST', body: { cardId: queue.card.id } }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [queue, revealed, busy, practice]);

  const advance = (next: NextCardResult) => {
    setQueue(next);
    setRevealed(null);
    setChecked(null);
    setAnswer('');
    setNotice('');
    shownAt.current = Date.now();
  };

  const grade = useCallback(
    async (rating: Rating) => {
      if (!queue?.card || !revealed || busy) return;
      setBusy(true);
      try {
        const data = await api<{ result: GradeResult; next: NextCardResult }>('/api/v1/study/grade', {
          method: 'POST',
          body: {
            cardId: queue.card.id,
            rating,
            answer: answer.trim() || undefined,
            durationMs: Date.now() - shownAt.current,
            ...filter,
          },
        });
        setReviewed((n) => n + 1);
        if (rating !== 'again') setCorrect((n) => n + 1);
        setLastGraded({ id: queue.card.id, rating, front: queue.card.front });
        advance(data.next);
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, revealed, busy, answer, filterQuery]
  );

  /** Multiple choice / true-false: the server checks the answer; nothing is rescheduled. */
  const answerPractice = async (input: { choice?: string; answerTrue?: boolean }) => {
    if (!queue?.card || checked || busy) return;
    setBusy(true);
    try {
      const [details, data] = await Promise.all([
        api<RevealResult>('/api/v1/study/reveal', { method: 'POST', body: { cardId: queue.card.id } }),
        api<{ result: GradeResult; next: NextCardResult }>('/api/v1/study/grade', {
          method: 'POST',
          body: {
            cardId: queue.card.id,
            ...input,
            statement: queue.presentation?.statement,
            durationMs: Date.now() - shownAt.current,
            ...filter,
          },
        }),
      ]);
      setRevealed(details);
      setChecked(data);
      setReviewed((n) => n + 1);
      if (data.result.check?.correct) setCorrect((n) => n + 1);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const undo = useCallback(async () => {
    if (!lastGraded || busy) return;
    setBusy(true);
    try {
      const data = await api<{ card: NonNullable<NextCardResult['card']> }>('/api/v1/study/undo', {
        method: 'POST',
        body: { cardId: lastGraded.id },
      });
      advance({ ...(queue as NextCardResult), card: data.card, presentation: undefined });
      setReviewed((n) => Math.max(0, n - 1));
      if (lastGraded.rating !== 'again') setCorrect((n) => Math.max(0, n - 1));
      setLastGraded(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [lastGraded, busy, queue]);

  /** "Mi respuesta era correcta": the learner overrules the grade; the card is rescheduled as "good". */
  const overrule = async () => {
    if (!lastGraded || busy) return;
    setBusy(true);
    try {
      const data = await api<{ result: GradeResult }>('/api/v1/study/correct', {
        method: 'POST',
        body: { cardId: lastGraded.id, rating: 'good', reason: 'El estudiante indicó que su respuesta era correcta' },
      });
      setCorrect((n) => n + 1);
      setNotice(`Corregido a “Bien”: vuelve ${formatDue(data.result.dueAt)}.`);
      setLastGraded({ ...lastGraded, rating: 'good' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (practice) {
        if (checked && (event.key === 'Enter' || event.key === ' ') && !typing) {
          event.preventDefault();
          advance(checked.next);
        }
        return;
      }
      if ((event.key === 'z' || event.key === 'Z') && !typing) {
        void undo();
        return;
      }
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
  }, [revealed, reveal, grade, undo, practice, checked]);

  const options = <SessionOptions deck={deck} tag={tag} mode={mode} format={format} />;

  if (error) return <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!queue) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const quickDone = mode === 'quick' && reviewed >= QUICK_SIZE && !checked;
  const remaining = queue.remaining.learning + queue.remaining.review + queue.remaining.new;

  if ((!queue.card && !checked) || quickDone) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {options}
        <div className="space-y-4 rounded-xl border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">
            {reviewed > 0 ? `Sesión terminada: ${reviewed} ${reviewed === 1 ? 'tarjeta' : 'tarjetas'}` : 'Nada pendiente'}
          </h2>
          {reviewed > 0 && (
            <p className="text-sm">
              {correct} de {reviewed} {practice ? 'acertadas' : 'recordadas'} ({Math.round((correct / reviewed) * 100)}%)
              {practice && ' · práctica: tu programación no cambia'}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {quickDone
              ? `Quedan ${remaining} pendientes para otra sesión.`
              : mode === 'exam' || practice
                ? queue.message
                : queue.nextDueAt
                  ? `La próxima tarjeta vence ${formatDue(queue.nextDueAt)}.`
                  : 'No hay tarjetas programadas.'}
            {mode === 'normal' && !practice && queue.message?.includes('limit')
              ? ' Alcanzaste el límite diario de tarjetas nuevas (ajústalo en Agentes y ajustes).'
              : ''}
          </p>
          {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {lastGraded && !practice && (
              <Button variant="ghost" onClick={() => void undo()} disabled={busy}>
                Deshacer la última
              </Button>
            )}
            {lastGraded && !practice && (lastGraded.rating === 'again' || lastGraded.rating === 'hard') && (
              <Button variant="ghost" onClick={() => void overrule()} disabled={busy}>
                Mi respuesta era correcta
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/">Volver al inicio</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const card = checked ? revealed!.card : queue.card!;
  const presentation = queue.presentation;
  const typedMatches = revealed && answer.trim() ? normalize(answer) === normalize(revealed.card.back) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {options}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {card.deck.name}
          {card.tags.length > 0 && ` · ${card.tags.join(', ')}`}
        </span>
        <span className="tabular-nums">
          {mode === 'quick' ? (
            `${Math.min(reviewed + 1, QUICK_SIZE)} de ${Math.min(QUICK_SIZE, reviewed + remaining)}`
          ) : (
            <>
              <span className="text-red-600 dark:text-red-400">{queue.remaining.learning}</span> ·{' '}
              <span className="text-emerald-600 dark:text-emerald-400">{queue.remaining.review}</span> ·{' '}
              <span className="text-blue-600 dark:text-blue-400">{queue.remaining.new}</span> ({remaining} restantes)
            </>
          )}
          {lastGraded && !practice && (
            <button className="ml-3 underline hover:text-foreground" onClick={() => void undo()} disabled={busy} title="Tecla Z">
              Deshacer
            </button>
          )}
        </span>
      </div>

      {lastGraded && !practice && (lastGraded.rating === 'again' || lastGraded.rating === 'hard') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            Anterior: “{lastGraded.front}” → {RATING_LABEL[lastGraded.rating]}
          </span>
          <button className="underline hover:text-foreground" onClick={() => void overrule()} disabled={busy}>
            Mi respuesta era correcta
          </button>
        </div>
      )}
      {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <div className="space-y-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
        <p className="whitespace-pre-wrap text-center text-xl leading-relaxed">{card.front}</p>

        {practice ? (
          <PracticeQuestion
            format={format}
            presentation={presentation}
            checked={checked?.result ?? null}
            busy={busy}
            onAnswer={(input) => void answerPractice(input)}
          />
        ) : !revealed ? (
          <div className="space-y-3">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={
                format === 'typing'
                  ? 'Escribe la respuesta y pulsa Ctrl+Enter'
                  : 'Escribe tu respuesta de memoria (opcional) y pulsa Ctrl+Enter'
              }
              rows={3}
              autoFocus
            />
            <Button className="w-full" size="lg" onClick={() => void reveal()} disabled={busy || (format === 'typing' && !answer.trim())}>
              {format === 'typing' ? 'Comprobar' : 'Mostrar respuesta'}
            </Button>
          </div>
        ) : null}

        {revealed && (
          <div className="space-y-4 border-t pt-6">
            {answer.trim() && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                  <span>Tu respuesta</span>
                  {typedMatches !== null && (
                    <span>{typedMatches ? '✓ coincide' : 'no coincide literalmente: juzga el significado'}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{answer}</p>
              </div>
            )}
            <p className="whitespace-pre-wrap text-center text-lg font-medium text-primary">{revealed.card.back}</p>
            {revealed.card.explanation && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{revealed.card.explanation}</p>}
            <CardSource card={revealed.card} />
            {revealed.recentAttempts.some((a) => a.rating === 'again' && a.answer) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                Errores anteriores:{' '}
                {revealed.recentAttempts
                  .filter((a) => a.rating === 'again' && a.answer)
                  .map((a) => `“${a.answer}”`)
                  .join(', ')}
              </div>
            )}
            <ExplainButton key={card.id} cardId={card.id} />
            {checked ? (
              <Button className="w-full" size="lg" onClick={() => advance(checked.next)}>
                Siguiente
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {RATINGS.map(({ rating, label, key, variant }) => (
                  <Button
                    key={rating}
                    variant={variant}
                    className="h-auto flex-col px-1 py-2"
                    onClick={() => void grade(rating)}
                    disabled={busy}
                  >
                    <span>{label}</span>
                    <span className="text-[11px] font-normal opacity-80">
                      {revealed.outcomes[rating].interval}
                      <span className="hidden sm:inline"> · {key}</span>
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PracticeQuestion({
  format,
  presentation,
  checked,
  busy,
  onAnswer,
}: {
  format: QuestionFormat;
  presentation: NextCardResult['presentation'];
  checked: GradeResult | null;
  busy: boolean;
  onAnswer: (input: { choice?: string; answerTrue?: boolean }) => void;
}) {
  const verdict = checked?.check && (
    <p
      className={`rounded-lg p-3 text-center text-sm font-medium ${
        checked.check.correct
          ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
      }`}
      role="status"
    >
      {checked.check.correct ? '✓ Correcto' : '✗ Incorrecto'}
    </p>
  );

  if (format === 'multiple_choice') {
    const choices = presentation?.choices ?? [];
    return (
      <div className="space-y-2">
        {choices.length < 2 && (
          <p className="text-xs text-muted-foreground">No hay suficientes respuestas en esta materia para generar opciones.</p>
        )}
        {choices.map((choice, i) => {
          const isAnswer = checked?.check && choice === checked.check.expected;
          const picked = checked?.check && choice === checked.check.given;
          return (
            <button
              key={choice}
              onClick={() => onAnswer({ choice })}
              disabled={busy || !!checked}
              className={`flex w-full items-start gap-3 rounded-lg border-2 p-3 text-left text-sm transition-colors enabled:hover:bg-accent ${
                isAnswer
                  ? 'border-emerald-600 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-950'
                  : picked
                    ? 'border-red-600 bg-red-100 dark:border-red-400 dark:bg-red-950'
                    : 'border-border'
              }`}
            >
              <span className="font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1 whitespace-pre-wrap">{choice}</span>
              {isAnswer && <span aria-label="respuesta correcta">✓</span>}
              {picked && !isAnswer && <span aria-label="tu elección">✗</span>}
            </button>
          );
        })}
        {verdict}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-center">
        <div className="text-xs text-muted-foreground">¿Es correcta esta respuesta?</div>
        <p className="mt-1 whitespace-pre-wrap font-medium">{presentation?.statement}</p>
      </div>
      {!checked && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="good" onClick={() => onAnswer({ answerTrue: true })} disabled={busy}>
            Verdadero
          </Button>
          <Button variant="again" onClick={() => onAnswer({ answerTrue: false })} disabled={busy}>
            Falso
          </Button>
        </div>
      )}
      {verdict}
    </div>
  );
}

function SessionOptions({ deck, tag, mode, format }: Required<Pick<Props, 'mode' | 'format'>> & Pick<Props, 'deck' | 'tag'>) {
  const href = (next: { mode?: SessionMode; format?: QuestionFormat }) => {
    const params = new URLSearchParams();
    if (deck) params.set('deck', deck);
    if (tag) params.set('tag', tag);
    const m = next.mode ?? mode;
    const f = next.format ?? format;
    if (m !== 'normal') params.set('mode', m);
    if (f !== 'recall') params.set('format', f);
    const query = params.toString();
    return `/review${query ? `?${query}` : ''}`;
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`;
  return (
    <nav className="space-y-2" aria-label="Tipo de sesión">
      <div className="flex flex-wrap gap-1.5">
        {MODES.filter((m) => m.mode !== 'exam' || deck).map((m) => (
          <Link key={m.mode} href={href({ mode: m.mode })} className={chip(mode === m.mode)} title={m.hint} aria-current={mode === m.mode}>
            {m.label}
          </Link>
        ))}
        <span className="mx-1 self-center text-muted-foreground">·</span>
        {FORMATS.map((f) => (
          <Link
            key={f.format}
            href={href({ format: f.format })}
            className={chip(format === f.format)}
            title={f.hint}
            aria-current={format === f.format}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {(format === 'multiple_choice' || format === 'true_false') && (
        <p className="text-xs text-muted-foreground">Práctica: se corrige al momento y no cambia cuándo vuelve cada tarjeta.</p>
      )}
    </nav>
  );
}
