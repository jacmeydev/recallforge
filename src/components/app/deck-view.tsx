'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, formatDue } from '@/lib/api/client';
import type { Card as StudyCard, DeckSummary } from '@/lib/core/types';

const PAGE = 50;
const STATE_LABEL: Record<string, string> = { new: 'nueva', learning: 'aprendiendo', relearning: 'reaprendiendo', review: 'repaso' };

interface CardDraft {
  front: string;
  back: string;
  explanation: string;
  source: string;
  tags: string;
}

const EMPTY_DRAFT: CardDraft = { front: '', back: '', explanation: '', source: '', tags: '' };

function toDraft(card: StudyCard): CardDraft {
  return { front: card.front, back: card.back, explanation: card.explanation, source: card.source, tags: card.tags.join(', ') };
}

function draftBody(draft: CardDraft) {
  return {
    front: draft.front,
    back: draft.back,
    explanation: draft.explanation,
    source: draft.source,
    tags: draft.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export function DeckView({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [deck, setDeck] = useState<DeckSummary | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ id: string; draft: CardDraft } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((token) => token + 1);

  const fetchCards = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ deck: deckId, limit: String(PAGE), offset: String(offset) });
      if (query.trim()) params.set('query', query.trim());
      if (state) params.set('state', state);
      return api<{ total: number; cards: StudyCard[] }>(`/api/v1/cards?${params}`);
    },
    [deckId, query, state]
  );

  useEffect(() => {
    let cancelled = false;
    api<{ deck: DeckSummary }>(`/api/v1/decks/${encodeURIComponent(deckId)}`)
      .then((data) => !cancelled && setDeck(data.deck))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [deckId, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchCards(0)
        .then((data) => {
          if (cancelled) return;
          setTotal(data.total);
          setCards(data.cards);
        })
        .catch((err) => !cancelled && setError(err.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchCards, reloadToken]);

  const loadMore = () =>
    fetchCards(cards.length)
      .then((data) => {
        setTotal(data.total);
        setCards((current) => [...current, ...data.cards]);
      })
      .catch((err) => setError(err.message));

  async function run(action: () => Promise<unknown>, success?: string) {
    setError('');
    setMessage('');
    try {
      await action();
      if (success) setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  const addCard = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ created: unknown[]; skipped: Array<{ reason: string }> }>('/api/v1/cards', {
        method: 'POST',
        body: { deck: deckId, cards: [draftBody(draft)] },
      });
      if (result.skipped.length) throw new Error('Ya existe una tarjeta con esa pregunta en este mazo');
      setDraft(EMPTY_DRAFT);
      reload();
    }, 'Tarjeta añadida');
  };

  const saveEdit = () =>
    editing &&
    run(async () => {
      await api(`/api/v1/cards/${editing.id}`, { method: 'PATCH', body: draftBody(editing.draft) });
      setEditing(null);
      reload();
    }, 'Tarjeta actualizada');

  const toggleSuspend = (card: StudyCard) =>
    run(async () => {
      await api(`/api/v1/cards/${card.id}`, { method: 'PATCH', body: { suspended: !card.suspended } });
      reload();
    });

  const removeCard = (card: StudyCard) =>
    confirm('¿Eliminar esta tarjeta y su historial?') &&
    run(async () => {
      await api(`/api/v1/cards/${card.id}`, { method: 'DELETE' });
      reload();
    });

  const renameDeck = () => {
    const name = prompt('Nuevo nombre o ruta (usa :: para moverlo dentro de otra materia)', deck?.name);
    if (!name?.trim()) return;
    void run(async () => {
      await api(`/api/v1/decks/${encodeURIComponent(deckId)}`, { method: 'PATCH', body: { name } });
      reload();
    });
  };

  const removeDeck = () =>
    confirm(`¿Eliminar "${deck?.name}", sus submaterias y sus ${deck?.totals.total ?? 0} tarjetas? No se puede deshacer.`) &&
    run(async () => {
      await api(`/api/v1/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
      router.push('/');
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Mazos
          </Link>
          <h1 className="text-2xl font-bold">{deck?.name ?? '…'}</h1>
          {deck && (
            <p className="text-sm text-muted-foreground">
              {deck.totals.total} tarjetas · {deck.totals.new} nuevas · {deck.totals.due} pendientes hoy
              {deck.totals.suspended > 0 && ` · ${deck.totals.suspended} suspendidas`}
              {deck.totals.drafts > 0 && (
                <>
                  {' '}·{' '}
                  <Link href={`/drafts?deck=${encodeURIComponent(deckId)}`} className="text-amber-600 hover:underline">
                    {deck.totals.drafts} por revisar
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/review?deck=${encodeURIComponent(deckId)}`}>Repasar</Link>
          </Button>
          <Button variant="outline" onClick={renameDeck}>
            Renombrar
          </Button>
          <Button variant="ghost" className="text-destructive" onClick={() => void removeDeck()}>
            Eliminar
          </Button>
        </div>
      </div>

      {deck && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <span className="text-muted-foreground">Fecha de examen</span>
          <Input
            type="date"
            className="h-8 w-44"
            defaultValue={deck.examDate ?? ''}
            key={deck.examDate ?? 'none'}
            onChange={(e) =>
              void run(async () => {
                await api(`/api/v1/decks/${encodeURIComponent(deckId)}`, {
                  method: 'PATCH',
                  body: { examDate: e.target.value || null },
                });
                reload();
              }, e.target.value ? 'Fecha de examen guardada' : 'Fecha de examen eliminada')
            }
          />
          {deck.examDate && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/review?deck=${encodeURIComponent(deckId)}&mode=exam`}>Repasar para el examen</Link>
            </Button>
          )}
          <span className="text-xs text-muted-foreground">Se aplica también a sus submaterias.</span>
        </div>
      )}

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Nueva tarjeta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addCard} className="grid gap-3 md:grid-cols-2">
            <CardFields draft={draft} onChange={setDraft} />
            <div className="md:col-span-2">
              <Button type="submit">Añadir tarjeta</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en preguntas, respuestas y etiquetas" />
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Todas</option>
            <option value="new">Nuevas</option>
            <option value="learning">Aprendiendo</option>
            <option value="review">En repaso</option>
            <option value="due">Vencidas</option>
            <option value="leech">Difíciles (4+ olvidos)</option>
            <option value="suspended">Suspendidas</option>
          </select>
          <span className="self-center text-xs text-muted-foreground">{total} resultados</span>
        </div>

        <div className="divide-y rounded-xl border bg-card">
          {cards.map((card) =>
            editing?.id === card.id ? (
              <div key={card.id} className="grid gap-3 p-4 md:grid-cols-2">
                <CardFields draft={editing.draft} onChange={(next) => setEditing({ id: card.id, draft: next })} />
                <div className="flex gap-2 md:col-span-2">
                  <Button size="sm" onClick={() => void saveEdit()}>
                    Guardar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div key={card.id} className={`grid gap-2 p-4 md:grid-cols-[1fr_1fr_auto] ${card.suspended ? 'opacity-50' : ''}`}>
                <p className="whitespace-pre-wrap text-sm font-medium">{card.front}</p>
                <div className="text-sm">
                  <p className="whitespace-pre-wrap">{card.back}</p>
                  {card.explanation && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.explanation}</p>}
                </div>
                <div className="flex flex-col items-start gap-2 md:items-end">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{STATE_LABEL[card.state] ?? card.state}</Badge>
                    {card.state !== 'new' && <Badge variant="outline">{formatDue(card.dueAt)}</Badge>}
                    {card.lapses > 0 && <Badge variant="warning">{card.lapses} olvidos</Badge>}
                  </div>
                  <div className="flex gap-1 text-xs">
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditing({ id: card.id, draft: toDraft(card) })}>
                      Editar
                    </button>
                    ·
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => void toggleSuspend(card)}>
                      {card.suspended ? 'Reactivar' : 'Suspender'}
                    </button>
                    ·
                    <button className="text-destructive" onClick={() => void removeCard(card)}>
                      Eliminar
                    </button>
                  </div>
                  {card.tags.length > 0 && <p className="text-xs text-muted-foreground">{card.tags.join(', ')}</p>}
                </div>
              </div>
            )
          )}
          {cards.length === 0 && <p className="p-4 text-sm text-muted-foreground">No hay tarjetas que coincidan.</p>}
        </div>
        {cards.length < total && (
          <Button variant="outline" onClick={() => void loadMore()}>
            Cargar más
          </Button>
        )}
      </div>
    </div>
  );
}

function CardFields({ draft, onChange }: { draft: CardDraft; onChange: (draft: CardDraft) => void }) {
  const set = (key: keyof CardDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...draft, [key]: event.target.value });
  return (
    <>
      <Textarea required value={draft.front} onChange={set('front')} placeholder="Pregunta" rows={3} />
      <Textarea required value={draft.back} onChange={set('back')} placeholder="Respuesta" rows={3} />
      <Textarea value={draft.explanation} onChange={set('explanation')} placeholder="Explicación / contexto (opcional)" rows={2} />
      <div className="space-y-3">
        <Input value={draft.source} onChange={set('source')} placeholder="Fuente (libro, capítulo, página)" />
        <Input value={draft.tags} onChange={set('tags')} placeholder="Etiquetas separadas por coma" />
      </div>
    </>
  );
}
