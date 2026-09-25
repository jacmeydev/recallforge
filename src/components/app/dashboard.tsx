'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { Stats } from '@/lib/core/stats';
import type { DeckSummary } from '@/lib/core/types';

export function Dashboard() {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newDeck, setNewDeck] = useState('');
  const [error, setError] = useState('');

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<{ decks: DeckSummary[] }>('/api/v1/decks'), api<Stats>('/api/v1/stats')])
      .then(([deckData, statsData]) => {
        if (cancelled) return;
        setDecks(deckData.decks);
        setStats(statsData);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'No se pudo cargar'));
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function createDeck(event: React.FormEvent) {
    event.preventDefault();
    if (!newDeck.trim()) return;
    try {
      await api('/api/v1/decks', { method: 'POST', body: { name: newDeck } });
      setNewDeck('');
      setError('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el mazo');
    }
  }

  const dueTotal = stats ? stats.due.learning + stats.due.review + stats.due.new : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Hoy</h1>
          <p className="text-sm text-muted-foreground">
            Estudia aquí o pídele a tu agente que te pregunte. Todo queda en la misma memoria.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/review">Repasar ahora{dueTotal > 0 ? ` (${dueTotal})` : ''}</Link>
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pendientes hoy" value={stats ? dueTotal : '—'} hint={stats ? `${stats.due.new} nuevas · ${stats.due.review} repasos · ${stats.due.learning} en aprendizaje` : ''} />
        <Stat
          label="Repasadas hoy"
          value={stats ? stats.today.reviews : '—'}
          hint={stats?.today.accuracy != null ? `${Math.round(stats.today.accuracy * 100)}% acierto` : ''}
        />
        <Stat
          label="Retención 30 días"
          value={stats?.retention30d.rate != null ? `${Math.round(stats.retention30d.rate * 100)}%` : '—'}
          hint={stats ? `objetivo ${Math.round(stats.settings.desiredRetention * 100)}%` : ''}
        />
        <Stat label="Racha" value={stats ? `${stats.streakDays} d` : '—'} hint={stats ? `${stats.cards.total} tarjetas` : ''} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Mazos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {decks && decks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aún no tienes mazos. Crea uno aquí o conecta tu agente (en <Link className="underline" href="/account">Cuenta y agentes</Link>) y
              pídele que genere tarjetas de tus apuntes.
            </p>
          )}
          {decks && decks.length > 0 && (
            <div className="divide-y rounded-lg border">
              {decks.map((deck) => (
                <div key={deck.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Link href={`/deck/${deck.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                    {deck.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{deck.counts.total} tarjetas</span>
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    <span className="text-blue-600">{deck.counts.new} nuevas</span> ·{' '}
                    <span className="text-emerald-600">{deck.counts.due} pendientes</span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/review?deck=${encodeURIComponent(deck.id)}`}>Repasar</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={createDeck} className="flex gap-2">
            <Input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="Nuevo mazo, p. ej. Farmacología" maxLength={200} />
            <Button type="submit" variant="secondary">
              Crear
            </Button>
          </form>
        </CardContent>
      </Card>

      {stats && stats.weakCards.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Tarjetas difíciles</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {stats.weakCards.slice(0, 5).map((card) => (
                <li key={card.id} className="flex gap-3">
                  <span className="shrink-0 text-xs text-destructive">
                    {card.timesFailed}× fallada
                  </span>
                  <span className="min-w-0 flex-1 truncate">{card.front}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{card.deck}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
