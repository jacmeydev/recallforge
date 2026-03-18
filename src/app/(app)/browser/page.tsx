'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search,
  Trash2,
  Tag,
  ArrowUpDown,
  Ban,
  SkipForward,
  Flag,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Pencil,
  CheckSquare,
  Square,
  Columns,
  GraduationCap,
  Eye,
} from 'lucide-react';
import { useAppStore, useBrowserStore } from '@/lib/store';
import { searchCards, searchNotes } from '@/lib/services/search-service';
import { deleteNote, getNote } from '@/lib/services/note-service';
import { bulkSuspend, bulkUnsuspend, buryCard, resetCard, flagCard } from '@/lib/services/card-service';
import { formatInterval } from '@/lib/utils';
import type { Card as CardType, Note, Deck } from '@/types';

interface BrowserItem {
  id: string;
  noteId: string;
  deckName: string;
  noteTypeName: string;
  sortField: string;
  due: string;
  interval: string;
  ease: string;
  reviews: number;
  state: string;
  tags: string[];
  isSuspended: boolean;
  isBuried: boolean;
  flag: number;
  subject: string;
  aiReviewStatus: string;
  priority: string;
  conceptualDifficulty: string;
  hasSyllabusLink: boolean;
  examScope: string;
}

const ROW_HEIGHT = 52;

function VirtualizedTableBody({
  items,
  selectedIds,
  toggleSelect,
  flagColors,
  router,
}: {
  items: BrowserItem[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  flagColors: Record<number, string>;
  router: ReturnType<typeof useRouter>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div
      ref={parentRef}
      className="max-h-[60vh] overflow-auto"
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        <table className="w-full text-sm" style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}>
          <tbody>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              return (
                <tr
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'table-row',
                  }}
                  className={`border-b hover:bg-muted/50 cursor-pointer transition-colors ${
                    selectedIds.has(item.id) ? 'bg-primary/5' : ''
                  } ${item.isSuspended ? 'opacity-50' : ''}`}
                >
                  <td className="p-3" style={{ width: '40px' }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                      {selectedIds.has(item.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td
                    className="p-3 max-w-xs truncate"
                    onClick={() => router.push(`/notes/add?edit=${item.noteId}`)}
                  >
                    <div className="flex items-center gap-2">
                      {item.flag > 0 && <Flag className={`h-3 w-3 ${flagColors[item.flag] || ''}`} />}
                      {item.sortField}
                    </div>
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {item.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
                        ))}
                        {item.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{item.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{item.deckName}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{item.due}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">{item.interval}</td>
                  <td className="p-3 hidden xl:table-cell text-muted-foreground">{item.reviews}</td>
                  <td className="p-3 hidden md:table-cell">
                    <Badge variant={
                      item.state === 'new' ? 'info' :
                      item.state === 'learning' || item.state === 'relearning' ? 'warning' :
                      'success'
                    }>
                      {item.isSuspended ? 'suspendida' : item.isBuried ? 'enterrada' : item.state}
                    </Badge>
                  </td>
                  <td className="p-3" style={{ width: '40px' }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => router.push(`/notes/add?edit=${item.noteId}`)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BrowserPage() {
  const router = useRouter();
  const { user, decks, noteTypes } = useAppStore();
  const {
    mode, setMode,
    searchQuery, setSearchQuery,
    selectedIds, toggleSelection, selectAll: storeSelectAll, clearSelection,
    sortColumn, sortDirection, setSorting,
  } = useBrowserStore();

  const [items, setItems] = useState<BrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedDeckFilter, setSelectedDeckFilter] = useState<string>('');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('');
  const [selectedAIReviewFilter, setSelectedAIReviewFilter] = useState<string>('');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>('');
  const [selectedDifficultyFilter, setSelectedDifficultyFilter] = useState<string>('');
  const [selectedSyllabusFilter, setSelectedSyllabusFilter] = useState<string>('');
  const [selectedExamScopeFilter, setSelectedExamScopeFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(true);

  const deckMap = useMemo(() => {
    const m: Record<string, Deck> = {};
    decks.forEach((d) => (m[d.id] = d));
    return m;
  }, [decks]);

  const noteTypeMap = useMemo(() => {
    const m: Record<string, string> = {};
    noteTypes.forEach((nt) => (m[nt.id] = nt.name));
    return m;
  }, [noteTypes]);

  const uniqueSubjects = useMemo(() => {
    const subjects = new Set<string>();
    decks.forEach((d) => {
      const s = (d.metadata as Record<string, unknown>)?.subject;
      if (typeof s === 'string' && s) subjects.add(s);
    });
    return [...subjects].sort();
  }, [decks]);

  const performSearch = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      let query = searchQuery;

      // Add deck filter
      if (selectedDeckFilter) {
        const deckName = deckMap[selectedDeckFilter]?.name;
        if (deckName) {
          query = `deck:"${deckName}" ${query}`.trim();
        }
      }

      const cards = await searchCards(user.id, query);

      // Load curriculum links for hasSyllabusLink and examScope
      const { db } = await import('@/lib/db');
      const allLinks = await db.curriculumLinks.where('userId').equals(user.id).toArray();
      const linksByNoteId = new Map<string, { hasLink: boolean; examScope: string }>();
      for (const link of allLinks) {
        if (link.noteId) {
          const existing = linksByNoteId.get(link.noteId);
          linksByNoteId.set(link.noteId, {
            hasLink: true,
            examScope: existing?.examScope || (link as unknown as Record<string, unknown>).examScope as string || '',
          });
        }
      }

      const browserItems: BrowserItem[] = [];
      const noteCache: Record<string, Note> = {};

      for (const card of cards) {
        if (!noteCache[card.noteId]) {
          const note = await getNote(card.noteId);
          if (note) noteCache[card.noteId] = note;
        }

        const note = noteCache[card.noteId];
        if (!note) continue;

        const firstFieldValue = Object.values(note.fieldValues)[0] || '';
        const deck = deckMap[card.deckId];
        const noteAcademic = (note.sourceMetadata as Record<string, unknown>)?.academic as Record<string, unknown> | undefined;
        const deckMeta = deck?.metadata as Record<string, unknown> | undefined;
        const itemSubject = (noteAcademic?.subject as string) || (deckMeta?.subject as string) || '';
        const itemAIReview = (noteAcademic?.aiReviewStatus as string) || '';
        const itemPriority = (noteAcademic?.priority as string) || '';
        const itemDifficulty = (noteAcademic?.conceptualDifficulty as string) || '';
        const noteLink = linksByNoteId.get(card.noteId);
        const itemExamScope = (noteAcademic?.examScope as string) || noteLink?.examScope || '';

        browserItems.push({
          id: card.id,
          noteId: card.noteId,
          deckName: deck?.name || 'Unknown',
          noteTypeName: noteTypeMap[note.noteTypeId] || 'Unknown',
          sortField: firstFieldValue.replace(/<[^>]*>/g, '').slice(0, 100),
          due: card.dueAt ? new Date(card.dueAt).toLocaleDateString() : '—',
          interval: card.scheduledDays > 0 ? formatInterval(card.scheduledDays) : '—',
          ease: card.difficulty ? `${(card.difficulty * 100).toFixed(0)}%` : '—',
          reviews: card.reps,
          state: card.state,
          tags: note.tags,
          isSuspended: card.suspended,
          isBuried: card.buriedUntil !== null,
          flag: 0,
          subject: itemSubject,
          aiReviewStatus: itemAIReview,
          priority: itemPriority,
          conceptualDifficulty: itemDifficulty,
          hasSyllabusLink: noteLink?.hasLink || false,
          examScope: itemExamScope,
        });
      }

      // Apply academic filters client-side
      let filtered = browserItems;
      if (selectedSubjectFilter) {
        filtered = filtered.filter((i) => i.subject === selectedSubjectFilter);
      }
      if (selectedAIReviewFilter) {
        filtered = filtered.filter((i) => i.aiReviewStatus === selectedAIReviewFilter);
      }
      if (selectedPriorityFilter) {
        filtered = filtered.filter((i) => i.priority === selectedPriorityFilter);
      }
      if (selectedDifficultyFilter) {
        filtered = filtered.filter((i) => i.conceptualDifficulty === selectedDifficultyFilter);
      }
      if (selectedSyllabusFilter === 'linked') {
        filtered = filtered.filter((i) => i.hasSyllabusLink);
      } else if (selectedSyllabusFilter === 'unlinked') {
        filtered = filtered.filter((i) => !i.hasSyllabusLink);
      }
      if (selectedExamScopeFilter) {
        filtered = filtered.filter((i) => i.examScope === selectedExamScopeFilter);
      }

      setItems(filtered);
      setTotalCount(filtered.length);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user, searchQuery, selectedDeckFilter, selectedSubjectFilter, selectedAIReviewFilter, selectedPriorityFilter, selectedDifficultyFilter, selectedSyllabusFilter, selectedExamScopeFilter, deckMap, noteTypeMap]);

  // Search on mount and query change
  useEffect(() => {
    const timer = setTimeout(performSearch, 300);
    return () => clearTimeout(timer);
  }, [performSearch]);

  const toggleSelect = (id: string) => {
    toggleSelection(id);
  };

  const selectAll = () => {
    if (selectedIds.size === items.length) {
      clearSelection();
    } else {
      storeSelectAll(items.map((i) => i.id));
    }
  };

  const handleSort = (field: string) => {
    if (sortColumn === field) {
      setSorting(field, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSorting(field, 'asc');
    }
  };

  const selectedArray = [...selectedIds];

  // Bulk actions
  const handleBulkSuspend = async () => {
    if (!user) return;
    await bulkSuspend(selectedArray);
    performSearch();
  };

  const handleBulkUnsuspend = async () => {
    if (!user) return;
    await bulkUnsuspend(selectedArray);
    performSearch();
  };

  const handleBulkDelete = async () => {
    if (!user) return;
    const noteIds = [...new Set(items.filter((i) => selectedIds.has(i.id)).map((i) => i.noteId))];
    for (const noteId of noteIds) {
      await deleteNote(user.id, noteId);
    }
    clearSelection();
    performSearch();
  };

  const handleBulkReset = async () => {
    if (!user) return;
    for (const cardId of selectedArray) {
      await resetCard(cardId);
    }
    performSearch();
  };

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'sortField': cmp = a.sortField.localeCompare(b.sortField); break;
        case 'due': cmp = a.due.localeCompare(b.due); break;
        case 'interval': cmp = (a.interval ?? '').localeCompare(b.interval ?? ''); break;
        case 'reviews': cmp = a.reviews - b.reviews; break;
        case 'deck': cmp = a.deckName.localeCompare(b.deckName); break;
        default: cmp = 0;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortColumn, sortDirection]);

  const flagColors: Record<number, string> = {
    1: 'text-red-500',
    2: 'text-orange-500',
    3: 'text-green-500',
    4: 'text-blue-500',
    5: 'text-purple-500',
    6: 'text-pink-500',
    7: 'text-amber-500',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Explorador</h1>
        <p className="text-sm text-muted-foreground">
          {totalCount} tarjeta{totalCount !== 1 ? 's' : ''}
          {selectedIds.size > 0 && ` · ${selectedIds.size} seleccionada${selectedIds.size !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder='Buscar... (ej. deck:Anatomía is:due tag:patología prop:lapses>3)'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
          Filtros
        </Button>
      </div>

      {/* Filter sidebar */}
      {showFilters && (
        <div className="space-y-3">
          {/* Deck filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14">Mazo:</span>
            <Button
              variant={selectedDeckFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedDeckFilter('')}
            >
              Todos
            </Button>
            {decks.filter((d) => !d.archived).map((deck) => (
              <Button
                key={deck.id}
                variant={selectedDeckFilter === deck.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDeckFilter(deck.id)}
              >
                {deck.name}
              </Button>
            ))}
          </div>

          {/* Subject filter */}
          {uniqueSubjects.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs font-medium text-muted-foreground w-14 flex items-center gap-1">
                <GraduationCap className="h-3 w-3" /> Materia:
              </span>
              <Button
                variant={selectedSubjectFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSubjectFilter('')}
              >
                Todas
              </Button>
              {uniqueSubjects.map((subj) => (
                <Button
                  key={subj}
                  variant={selectedSubjectFilter === subj ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSubjectFilter(subj)}
                >
                  {subj}
                </Button>
              ))}
            </div>
          )}

          {/* AI Review Status filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14 flex items-center gap-1">
              <Eye className="h-3 w-3" /> IA:
            </span>
            <Button
              variant={selectedAIReviewFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAIReviewFilter('')}
            >
              Todas
            </Button>
            {(['pending-review', 'reviewed', 'corrected'] as const).map((status) => (
              <Button
                key={status}
                variant={selectedAIReviewFilter === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedAIReviewFilter(status)}
              >
                {status === 'pending-review' ? 'Pendiente' : status === 'reviewed' ? 'Revisada' : 'Corregida'}
              </Button>
            ))}
          </div>

          {/* Priority filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14">Prioridad:</span>
            <Button
              variant={selectedPriorityFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedPriorityFilter('')}
            >
              Todas
            </Button>
            {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
              <Button
                key={p}
                variant={selectedPriorityFilter === p ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedPriorityFilter(p)}
              >
                {p === 'low' ? 'Baja' : p === 'medium' ? 'Media' : p === 'high' ? 'Alta' : 'Crítica'}
              </Button>
            ))}
          </div>

          {/* Conceptual difficulty filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14">Dificultad:</span>
            <Button
              variant={selectedDifficultyFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedDifficultyFilter('')}
            >
              Todas
            </Button>
            {(['easy', 'medium', 'hard', 'very_hard'] as const).map((d) => (
              <Button
                key={d}
                variant={selectedDifficultyFilter === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDifficultyFilter(d)}
              >
                {d === 'easy' ? 'Fácil' : d === 'medium' ? 'Media' : d === 'hard' ? 'Difícil' : 'Muy Difícil'}
              </Button>
            ))}
          </div>

          {/* Syllabus link filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14">Syllabus:</span>
            <Button
              variant={selectedSyllabusFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSyllabusFilter('')}
            >
              Todas
            </Button>
            <Button
              variant={selectedSyllabusFilter === 'linked' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSyllabusFilter('linked')}
            >
              Vinculadas
            </Button>
            <Button
              variant={selectedSyllabusFilter === 'unlinked' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSyllabusFilter('unlinked')}
            >
              Sin Vínculo
            </Button>
          </div>

          {/* Exam scope filter */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs font-medium text-muted-foreground w-14">Examen:</span>
            <Button
              variant={selectedExamScopeFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedExamScopeFilter('')}
            >
              Todos
            </Button>
            {(['parcial_1', 'parcial_2', 'parcial_3', 'final', 'global'] as const).map((scope) => (
              <Button
                key={scope}
                variant={selectedExamScopeFilter === scope ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedExamScopeFilter(scope)}
              >
                {scope === 'parcial_1' ? 'Parcial 1' : scope === 'parcial_2' ? 'Parcial 2' : scope === 'parcial_3' ? 'Parcial 3' : scope === 'final' ? 'Final' : 'Global'}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium mr-2">{selectedIds.size} seleccionada{selectedIds.size !== 1 ? 's' : ''}</span>
          <Button variant="outline" size="sm" onClick={handleBulkSuspend}>
            <Ban className="h-3.5 w-3.5 mr-1" /> Suspender
          </Button>
          <Button variant="outline" size="sm" onClick={handleBulkUnsuspend}>
            Reactivar
          </Button>
          <Button variant="outline" size="sm" onClick={handleBulkReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reiniciar
          </Button>
          <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-500 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-3 w-10">
                    <button onClick={selectAll}>
                      {selectedIds.size === items.length && items.length > 0 ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 cursor-pointer hover:bg-muted" onClick={() => handleSort('sortField')}>
                    <span className="flex items-center gap-1">
                      Front <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="p-3 cursor-pointer hover:bg-muted hidden md:table-cell" onClick={() => handleSort('deck')}>
                    <span className="flex items-center gap-1">
                      Mazo <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="p-3 cursor-pointer hover:bg-muted hidden lg:table-cell" onClick={() => handleSort('due')}>
                    <span className="flex items-center gap-1">
                      Vencimiento <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="p-3 cursor-pointer hover:bg-muted hidden lg:table-cell" onClick={() => handleSort('interval')}>
                    <span className="flex items-center gap-1">
                      Intervalo <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="p-3 cursor-pointer hover:bg-muted hidden xl:table-cell" onClick={() => handleSort('reviews')}>
                    <span className="flex items-center gap-1">
                      Repasos <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="p-3 hidden md:table-cell">Estado</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
            </table>
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                Buscando...
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Sin tarjetas encontradas. Intenta ajustar tu búsqueda.
              </div>
            ) : (
              <VirtualizedTableBody
                items={sortedItems}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                flagColors={flagColors}
                router={router}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Search syntax help */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Ayuda de sintaxis de búsqueda</summary>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border rounded-lg">
          <code>deck:Name</code>
          <code>tag:grammar</code>
          <code>note:Basic</code>
          <code>is:due</code>
          <code>is:new</code>
          <code>is:suspended</code>
          <code>is:buried</code>
          <code>is:leech</code>
          <code>flagged:1</code>
          <code>prop:lapses&gt;3</code>
          <code>prop:ivl&gt;=30</code>
          <code>prop:stability&lt;10</code>
          <code>&quot;exact phrase&quot;</code>
          <code>word1 OR word2</code>
          <code>-excluded</code>
        </div>
      </details>
    </div>
  );
}
