'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, BookOpen, MoreHorizontal, Pencil, Trash2, Archive, FolderPlus } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { createDeck, getDecksWithCounts, deleteDeck, updateDeck } from '@/lib/services/deck-service';
import type { DeckWithCounts } from '@/types';

export default function DecksPage() {
  const { decks, setDecks, user } = useAppStore();
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDescription, setNewDeckDescription] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<DeckWithCounts | null>(null);
  const [parentDeckId, setParentDeckId] = useState<string | null>(null);

  // Load decks from Dexie on mount, when user changes, and after sync pull completes
  const loadDecks = React.useCallback(() => {
    if (!user) return;
    getDecksWithCounts(user.id).then(setDecks);
  }, [user, setDecks]);

  React.useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  // Re-query Dexie when sync pull completes (covers store-refresh failures and race conditions)
  React.useEffect(() => {
    const onSyncCompleted = () => loadDecks();
    window.addEventListener('recallforge:sync-pull-completed', onSyncCompleted);
    return () => window.removeEventListener('recallforge:sync-pull-completed', onSyncCompleted);
  }, [loadDecks]);

  const handleCreateDeck = async () => {
    if (!newDeckName.trim() || !user) return;

    await createDeck(user.id, {
      name: newDeckName.trim(),
      description: newDeckDescription.trim(),
      parentDeckId,
    });

    const updated = await getDecksWithCounts(user.id);
    setDecks(updated);
    setNewDeckName('');
    setNewDeckDescription('');
    setParentDeckId(null);
    setDialogOpen(false);
  };

  const handleDeleteDeck = async (deckId: string) => {
    if (!user) return;
    if (!confirm('¿Estás seguro? Las notas y tarjetas de este mazo se eliminarán.')) return;

    await deleteDeck(user.id, deckId);
    const updated = await getDecksWithCounts(user.id);
    setDecks(updated);
  };

  const handleArchiveDeck = async (deck: DeckWithCounts) => {
    if (!user) return;
    await updateDeck(user.id, deck.id, { archived: !deck.archived });
    const updated = await getDecksWithCounts(user.id);
    setDecks(updated);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mazos</h1>
          <p className="text-muted-foreground">Administra tus mazos de estudio</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nuevo Mazo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
            <DialogTitle>Crear Nuevo Mazo</DialogTitle>
            <DialogDescription>
                Agrega un nuevo mazo para organizar tu material de estudio.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  placeholder="ej., Anatomía, Patología"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDeck()}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descripción (opcional)</Label>
                <Input
                  id="description"
                  placeholder="Breve descripción..."
                  value={newDeckDescription}
                  onChange={(e) => setNewDeckDescription(e.target.value)}
                />
              </div>
              {decks.length > 0 && (
                <div className="space-y-2">
                  <Label>Mazo padre (opcional)</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm"
                    value={parentDeckId || ''}
                    onChange={(e) => setParentDeckId(e.target.value || null)}
                  >
                    <option value="">Ninguno (nivel superior)</option>
                    {decks.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateDeck} disabled={!newDeckName.trim()}>
                Crear Mazo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {decks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderPlus className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">Sin mazos aún</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Crea tu primer mazo para comenzar a agregar notas y estudiar.
            </p>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Crear Tu Primer Mazo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onDelete={() => handleDeleteDeck(deck.id)}
              onArchive={() => handleArchiveDeck(deck)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({
  deck,
  onDelete,
  onArchive,
}: {
  deck: DeckWithCounts;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const totalDue = deck.newCount + deck.learningCount + deck.reviewCount;

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <Link href={`/decks/${deck.id}`}>
              <CardTitle className="text-base hover:text-primary transition-colors truncate">
                {deck.name}
              </CardTitle>
            </Link>
            {deck.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {deck.description}
              </p>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onArchive}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="info">{deck.newCount} nuevas</Badge>
          <Badge variant="warning">{deck.learningCount} aprendiendo</Badge>
          <Badge variant="success">{deck.reviewCount} repaso</Badge>
        </div>

        <div className="text-xs text-muted-foreground">
          {deck.totalCount} tarjetas en total
        </div>

        {totalDue > 0 ? (
          <Link href={`/study/${deck.id}`}>
            <Button className="w-full gap-2" size="sm">
              <BookOpen className="h-4 w-4" />
              Estudiar ({totalDue} pendientes)
            </Button>
          </Link>
        ) : (
          <Button variant="outline" className="w-full" size="sm" disabled>
            ¡Al día!
          </Button>
        )}

        {deck.children && deck.children.length > 0 && (
          <div className="pl-3 border-l-2 border-border space-y-1 mt-3">
            {deck.children.map(child => (
              <div key={child.id} className="flex items-center justify-between text-xs">
                <Link href={`/decks/${child.id}`} className="hover:text-primary truncate">
                  {child.name}
                </Link>
                <span className="text-muted-foreground whitespace-nowrap ml-2">
                  {child.newCount + child.learningCount + child.reviewCount} pendientes
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
