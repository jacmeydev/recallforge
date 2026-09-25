'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ProgressMap, Recommendation, SubjectProgress } from '@/lib/core/progress';

const pct = (value: number | null | undefined) => (value == null ? '—' : `${Math.round(value * 100)}%`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ProgressView() {
  const [map, setMap] = useState<ProgressMap | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ProgressMap>('/api/v1/progress?days=182')
      .then(setMap)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!map) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const exams = map.subjects.filter((subject) => subject.exam && subject.depth === minExamDepth(map.subjects));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mapa de progreso</h1>
        <p className="text-sm text-muted-foreground">
          Dominio = probabilidad media de recordar cada tarjeta ahora mismo, según FSRS (las no estudiadas cuentan como 0).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Dominio general" value={pct(map.overall.mastery)} hint={plural(map.overall.cards, 'tarjeta', 'tarjetas')} />
        <Tile label="Estudiado" value={pct(map.overall.coverage)} hint={`${map.overall.unseen} sin ver`} />
        <Tile label="Consolidadas" value={String(map.overall.mature)} hint="estabilidad ≥ 21 días" />
        <Tile
          label="Hoy"
          value={`${map.workload.minutesToday} min`}
          hint={`${plural(map.workload.dueToday, 'tarjeta pendiente', 'tarjetas pendientes')} · ~${map.workload.secondsPerCard} s c/u`}
        />
      </div>

      {map.recommendations.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Qué hacer ahora</h2>
          <ul className="space-y-2">
            {map.recommendations.slice(0, 6).map((item, i) => (
              <RecommendationRow key={i} item={item} minutes={map.workload.minutesToday} />
            ))}
          </ul>
        </section>
      )}

      {exams.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Exámenes</h2>
          {exams.map((subject) => (
            <ExamRow key={subject.id} subject={subject} />
          ))}
        </section>
      )}

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Materias</h2>
          <span className="text-xs text-muted-foreground">dominio<span className="hidden sm:inline"> · estudiado · débiles</span></span>
        </div>
        {map.subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay materias.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Dominio por materia</caption>
            <thead className="sr-only">
              <tr>
                <th>Materia</th>
                <th>Dominio</th>
                <th>Estudiado</th>
                <th>Débiles</th>
              </tr>
            </thead>
            <tbody>
              {map.subjects.map((subject) => (
                <SubjectRow key={subject.id} subject={subject} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Actividad</h2>
          <span className="text-xs text-muted-foreground">
            {plural(map.heatmap.totalReviews, 'repaso', 'repasos')} en {plural(map.heatmap.studiedDays, 'día', 'días')} · últimos 6 meses
          </span>
        </div>
        <Heatmap days={map.heatmap.days} max={map.heatmap.maxReviews} />
      </section>

      {map.documents.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">Cobertura de documentos</h2>
          <ul className="space-y-2 text-sm">
            {map.documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3">
                <Link href={`/documents/${doc.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {doc.title}
                </Link>
                <Bar value={doc.parts ? doc.partsCovered / doc.parts : 0} label={`${doc.partsCovered} de ${doc.parts} partes con tarjetas`} />
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:w-24">
                  {doc.partsCovered}/{doc.parts} partes
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RecommendationRow({ item, minutes }: { item: Recommendation; minutes: number }) {
  const deckQuery = item.deckId ? `deck=${encodeURIComponent(item.deckId)}` : '';
  const view: { text: string; href: string; action: string } = (() => {
    switch (item.kind) {
      case 'exam_at_risk':
        return {
          text: `Examen de ${item.deck}: recuerdo previsto ${item.count}%, por debajo de tu objetivo.`,
          href: `/review?${deckQuery}&mode=exam`,
          action: 'Modo examen',
        };
      case 'unseen_before_exam':
        return {
          text: `${plural(item.count, 'tarjeta', 'tarjetas')} de ${item.deck} sin estudiar antes del examen.`,
          href: `/review?${deckQuery}&mode=exam`,
          action: 'Empezar',
        };
      case 'due':
        return { text: `${plural(item.count, 'tarjeta pendiente', 'tarjetas pendientes')} hoy (~${minutes} min).`, href: '/review', action: 'Repasar' };
      case 'leeches':
        return {
          text: `${plural(item.count, 'tarjeta', 'tarjetas')} de ${item.deck} se ${item.count === 1 ? 'olvida' : 'olvidan'} una y otra vez: conviene reescribirlas.`,
          href: `/deck/${item.deckId}?state=leech`,
          action: 'Ver',
        };
      case 'drafts':
        return { text: `${plural(item.count, 'borrador', 'borradores')} por revisar.`, href: '/drafts', action: 'Revisar' };
      case 'document_uncovered':
        return {
          text: `${plural(item.count, 'parte', 'partes')} de “${item.document}” sin tarjetas.`,
          href: `/documents/${item.documentId}`,
          action: 'Abrir',
        };
    }
  })();
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="min-w-0 flex-1">{view.text}</span>
      <Link href={view.href} className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-accent">
        {view.action}
      </Link>
    </li>
  );
}

function minExamDepth(subjects: SubjectProgress[]): number {
  // Show each exam once: at the subject where it is set (the shallowest level carrying it).
  return Math.min(...subjects.filter((subject) => subject.exam).map((subject) => subject.depth));
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  const width = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="h-3 w-20 shrink-0 overflow-hidden rounded-full sm:w-40"
      style={{ background: 'var(--color-bar-track)' }}
      role="img"
      aria-label={label}
      title={label}
    >
      <div className="h-full rounded-r-[4px]" style={{ width: `${width}%`, background: 'var(--color-bar)' }} />
    </div>
  );
}

function SubjectRow({ subject }: { subject: SubjectProgress }) {
  return (
    <tr className="border-t first:border-t-0">
      <td className="py-2 pr-3" style={{ paddingLeft: `${subject.depth * 1.25}rem` }}>
        <Link href={`/deck/${subject.id}`} className={`hover:underline ${subject.depth === 0 ? 'font-semibold' : ''}`}>
          {subject.depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
          {subject.shortName}
        </Link>
        <span className="ml-2 text-xs text-muted-foreground">{subject.cards}</span>
      </td>
      <td className="py-2 sm:w-56">
        <div className="flex items-center gap-2">
          <Bar value={subject.mastery} label={`Dominio ${pct(subject.mastery)}`} />
          <span className="w-10 text-right text-xs tabular-nums">{pct(subject.mastery)}</span>
        </div>
      </td>
      <td className="hidden w-20 py-2 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">{pct(subject.coverage)}</td>
      <td className="hidden w-20 py-2 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
        {subject.weak > 0 ? `${subject.weak} débiles` : '—'}
      </td>
    </tr>
  );
}

function ExamRow({ subject }: { subject: SubjectProgress }) {
  const exam = subject.exam!;
  const ready = exam.predictedRecall >= 0.85;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="min-w-0 flex-1 font-medium">{subject.name}</span>
      <span className="text-xs text-muted-foreground">
        {new Date(`${exam.date}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · faltan {exam.daysLeft} días
      </span>
      <Bar value={exam.predictedRecall} label={`Recuerdo previsto el día del examen: ${pct(exam.predictedRecall)}`} />
      <span className="text-xs sm:w-44">
        {ready ? '✓ Listo' : '⚠ En riesgo'} · recuerdo previsto {pct(exam.predictedRecall)}
      </span>
      <Link
        href={`/review?deck=${encodeURIComponent(subject.id)}&mode=exam`}
        className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
      >
        Repasar para el examen
      </Link>
    </div>
  );
}

const LEVELS = ['var(--color-seq-0)', 'var(--color-seq-1)', 'var(--color-seq-2)', 'var(--color-seq-3)', 'var(--color-seq-4)'];

function level(reviews: number, max: number): number {
  if (reviews <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((reviews / max) * 4)));
}

function Heatmap({ days, max }: { days: Array<{ date: string; reviews: number }>; max: number }) {
  // Columns are weeks (Monday first), rows are weekdays, like GitHub's contribution graph.
  const weeks = useMemo(() => {
    const firstWeekday = (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const padded: Array<{ date: string; reviews: number } | null> = [...Array(firstWeekday).fill(null), ...days];
    const columns: Array<Array<{ date: string; reviews: number } | null>> = [];
    for (let i = 0; i < padded.length; i += 7) columns.push(padded.slice(i, i + 7));
    return columns;
  }, [days]);

  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label="Repasos por día en los últimos 6 meses">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {week.map((day, j) =>
              day ? (
                <div
                  key={day.date}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: LEVELS[level(day.reviews, max)] }}
                  title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}: ${day.reviews} repasos`}
                />
              ) : (
                <div key={`pad-${j}`} className="h-3 w-3" />
              )
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground">
        Menos
        {LEVELS.map((color) => (
          <span key={color} className="h-3 w-3 rounded-[3px]" style={{ background: color }} />
        ))}
        Más
      </div>
    </div>
  );
}
