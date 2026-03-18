// ============================================================================
// RecallForge — App Store (Zustand)
// ============================================================================

import { create } from 'zustand';
import type {
  User,
  Deck,
  DeckWithCounts,
  NoteType,
  SchedulingPreset,
  SyncStatus,
  StudySession,
  StudyQueueCard,
} from '@/types';
import { getDefaultPreset } from '@/lib/fsrs';

// ─── App Store ─────────────────────────────────────────────────────────────

interface AppState {
  // User
  user: User | null;
  setUser: (user: User | null) => void;

  // Decks
  decks: DeckWithCounts[];
  setDecks: (decks: DeckWithCounts[]) => void;
  activeDeckId: string | null;
  setActiveDeckId: (id: string | null) => void;

  // Note Types
  noteTypes: NoteType[];
  setNoteTypes: (noteTypes: NoteType[]) => void;

  // Presets
  presets: SchedulingPreset[];
  setPresets: (presets: SchedulingPreset[]) => void;
  getPresetForDeck: (deckId: string) => SchedulingPreset;

  // Sync
  syncStatus: SyncStatus;
  setSyncStatus: (status: SyncStatus) => void;
  pendingSyncCount: number;
  setPendingSyncCount: (count: number) => void;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Initialization
  initialized: boolean;
  setInitialized: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // User
  user: null,
  setUser: (user) => set({ user }),

  // Decks
  decks: [],
  setDecks: (decks) => set({ decks }),
  activeDeckId: null,
  setActiveDeckId: (id) => set({ activeDeckId: id }),

  // Note Types
  noteTypes: [],
  setNoteTypes: (noteTypes) => set({ noteTypes }),

  // Presets
  presets: [],
  setPresets: (presets) => set({ presets }),
  getPresetForDeck: (deckId: string) => {
    const { decks, presets } = get();
    const deck = decks.find(d => d.id === deckId);
    if (deck?.presetId) {
      const preset = presets.find(p => p.id === deck.presetId);
      if (preset) return preset;
    }
    return presets[0] || getDefaultPreset();
  },

  // Sync
  syncStatus: 'idle',
  setSyncStatus: (status) => set({ syncStatus: status }),
  pendingSyncCount: 0,
  setPendingSyncCount: (count) => set({ pendingSyncCount: count }),

  // UI
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  theme: 'system',
  setTheme: (theme) => set({ theme }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  // Initialization
  initialized: false,
  setInitialized: (v) => set({ initialized: v }),
}));

// ─── Study Store ──────────────────────────────────────────────────────────

interface StudyState {
  session: StudySession | null;
  setSession: (session: StudySession | null) => void;
  preloadedQueue: StudyQueueCard[] | null;
  setPreloadedQueue: (queue: StudyQueueCard[] | null) => void;
  currentCardIndex: number;
  setCurrentCardIndex: (index: number) => void;
  showAnswer: boolean;
  setShowAnswer: (show: boolean) => void;
  typedAnswer: string;
  setTypedAnswer: (answer: string) => void;
  cardStartTime: number;
  setCardStartTime: (time: number) => void;
  isFinished: boolean;
  setIsFinished: (finished: boolean) => void;
  focusMode: boolean;
  setFocusMode: (focus: boolean) => void;
  simpleMode: boolean;
  setSimpleMode: (simple: boolean) => void;
}

export const useStudyStore = create<StudyState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  preloadedQueue: null,
  setPreloadedQueue: (queue) => set({ preloadedQueue: queue }),
  currentCardIndex: 0,
  setCurrentCardIndex: (index) => set({ currentCardIndex: index }),
  showAnswer: false,
  setShowAnswer: (show) => set({ showAnswer: show }),
  typedAnswer: '',
  setTypedAnswer: (answer) => set({ typedAnswer: answer }),
  cardStartTime: Date.now(),
  setCardStartTime: (time) => set({ cardStartTime: time }),
  isFinished: false,
  setIsFinished: (finished) => set({ isFinished: finished }),
  focusMode: false,
  setFocusMode: (focus) => set({ focusMode: focus }),
  simpleMode: false,
  setSimpleMode: (simple) => set({ simpleMode: simple }),
}));

// ─── Browser Store ────────────────────────────────────────────────────────

interface BrowserState {
  mode: 'notes' | 'cards';
  setMode: (mode: 'notes' | 'cards') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  setSorting: (column: string, direction: 'asc' | 'desc') => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  mode: 'notes',
  setMode: (mode) => set({ mode }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  selectedIds: new Set(),
  toggleSelection: (id) =>
    set((state) => {
      const newSet = new Set(state.selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return { selectedIds: newSet };
    }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() }),
  sortColumn: 'createdAt',
  sortDirection: 'desc',
  setSorting: (column, direction) => set({ sortColumn: column, sortDirection: direction }),
}));
