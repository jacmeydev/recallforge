'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { checkCardQuality } from '@/lib/core/quality';
import type { Card as StudyCard } from '@/lib/core/types';

interface Draft {
  front: string;
  back: string;
  explanation: string;
  deck: string;
}

export function DraftsView({ deck, documentId }: { deck?: string; documentId?: string }) {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ state: 'draft', limit: '200' });
    if (deck) params.set('deck', deck);
    if (documentId) params.set('documentId', documentId);
    api<{ total: number; cards: StudyCard[] }>(`/api/v1/cards?${params}`)
      .then((data) => {
        if (cancelled) return;
        setCards(data.cards);
        setTotal(data.total);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [deck, documentId, reloadToken]);

  const reload = () => setReloadToken((token) => token + 1);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMessage(success);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const draftOf = (card: StudyCard): Draft =>
    edits[card.id] ?? { front: card.front, back: card.back, explanation: card.explanation, deck: card.deck.name };
  const setDraft = (id: string, draft: Draft) => setEdits((current) => ({ ...current, [id]: draft }));

  const saveIfEdited = async (card: StudyCard) => {
    const draft = edits[card.id];
    if (!draft) return;
    await api(`/api/v1/cards/${card.id}`, { method: 'PATCH', body: draft });
  };

  const approve = (card: StudyCard) =>
    run(async () => {
      await saveIfEdited(card);
      await api('/api/v1/cards/approve', { method: 'POST', body: { ids: [card.id] } });
    }, 'Tarjeta aprobada');

  const reject = (card: StudyCard) =>
    run(() => api(`/api/v1/cards/${card.id}`, { method: 'DELETE' }), 'Tarjeta descartada');

  const approveAll = () =>
    cards &&
    run(async () => {
      for (const card of cards) await saveIfEdited(card);
      await api('/api/v1/cards/approve', { method: 'POST', body: { ids: cards.map((card) => card.id) } });
    }, `${cards.length} tarjetas aprobadas`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Por revisar</h1>
          <p className="text-sm text-muted-foreground">
            Tarjetas creadas por tu agente. Corrige lo necesario y apruébalas: solo entonces entran en tus repasos.
          </p>
        </div>
        {cards && cards.length > 0 && (
          <Button onClick={() => void approveAll()} disabled={busy}>
            Aprobar {cards.length === total ? 'todas' : `estas ${cards.length}`}
          </Button>
        )}
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {cards === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {cards?.length === 0 && (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No hay tarjetas pendientes. Sube un documento en <Link className="underline" href="/documents">Documentos</Link> y pídele a tu
          agente que lo convierta en tarjetas.
        </p>
      )}

      <div className="space-y-3">
        {cards?.map((card) => {
          const draft = draftOf(card);
          const issues = checkCardQuality(draft);
          return (
            <div key={card.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{card.source || card.document?.title || 'Sin fuente'}</span>
                <Input
                  className="h-7 max-w-xs text-xs"
                  value={draft.deck}
                  onChange={(e) => setDraft(card.id, { ...draft, deck: e.target.value })}
                  aria-label="Materia"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Textarea
                  value={draft.front}
                  onChange={(e) => setDraft(card.id, { ...draft, front: e.target.value })}
                  rows={3}
                  aria-label="Pregunta"
                />
                <Textarea
                  value={draft.back}
                  onChange={(e) => setDraft(card.id, { ...draft, back: e.target.value })}
                  rows={3}
                  aria-label="Respuesta"
                />
              </div>
              <Textarea
                value={draft.explanation}
                onChange={(e) => setDraft(card.id, { ...draft, explanation: e.target.value })}
                rows={2}
                placeholder="Explicación (opcional)"
                aria-label="Explicación"
              />
              {issues.length > 0 && (
                <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                  {issues.map((issue) => (
                    <li key={issue}>{translateIssue(issue)}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void approve(card)} disabled={busy}>
                  Aprobar
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void reject(card)} disabled={busy}>
                  Descartar
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ISSUE_TEXT: Array<[RegExp, string]> = [
  [/very short/, 'Pregunta muy corta: asegúrate de que tenga una sola respuesta posible.'],
  [/Question is long/, 'Pregunta larga: evalúa una sola idea y pasa el contexto a la explicación.'],
  [/Answer is long/, 'Respuesta larga: deja lo esencial y mueve el resto a la explicación.'],
  [/Yes\/no/, 'Pregunta de sí/no: pregunta por el concepto (qué, cuál, por qué, cómo).'],
  [/list of (\d+)/, 'La respuesta es una lista larga: divídela en varias tarjetas o usa una mnemotecnia.'],
  [/already contains/, 'La pregunta ya contiene la respuesta.'],
];

function translateIssue(issue: string): string {
  return ISSUE_TEXT.find(([pattern]) => pattern.test(issue))?.[1] ?? issue;
}
