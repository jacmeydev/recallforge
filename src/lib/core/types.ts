// ============================================================================
// RecallForge — Core domain types
// ============================================================================

export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewSource = 'agent' | 'web' | 'api' | 'legacy';

export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

export interface StudySettings {
  /** Target probability of recalling a card when it comes due (FSRS). */
  desiredRetention: number;
  /** Max new cards introduced per study day. */
  newCardsPerDay: number;
  /** Max review-state cards shown per study day. */
  maxReviewsPerDay: number;
  /** Longest interval FSRS may schedule, in days. */
  maximumInterval: number;
  /** Short-term steps for new cards, e.g. ["1m", "10m"]. */
  learningSteps: string[];
  /** Short-term steps after a lapse, e.g. ["10m"]. */
  relearningSteps: string[];
  /** Local hour at which a new study day starts (like Anki's rollover). */
  dayStartHour: number;
  /** When nothing else is due, show learning cards due within this window. */
  learnAheadMinutes: number;
  enableFuzz: boolean;
  /** Custom FSRS weights. Empty array means FSRS defaults. */
  fsrsWeights: number[];
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  /** Exam day (YYYY-MM-DD) for this subject and its subdecks, if any. */
  examDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeckCounts {
  total: number;
  new: number;
  learning: number;
  review: number;
  suspended: number;
  /** AI-generated cards waiting for the learner's approval (not studied yet). */
  drafts: number;
  /** Learning cards due within the learn-ahead window + review cards due before the study day ends. */
  due: number;
}

export interface DeckSummary extends Deck {
  /** Last path segment: "Antibióticos" for "Medicina::Farmacología::Antibióticos". */
  shortName: string;
  parentId: string | null;
  depth: number;
  /** Cards directly in this deck. */
  counts: DeckCounts;
  /** Cards in this deck and all its subdecks. */
  totals: DeckCounts;
}

export type CardStatus = 'active' | 'draft';

/** What the learner may see before answering. Never contains the answer. */
export interface QuestionCard {
  id: string;
  deck: { id: string; name: string };
  front: string;
  tags: string[];
  state: CardState;
  reps: number;
  lapses: number;
  /**
   * The learner has seen this card several times: ask the same fact with
   * different wording or from another angle so it is recalled, not recognised.
   */
  suggestRephrase: boolean;
}

export interface Card extends QuestionCard {
  back: string;
  explanation: string;
  source: string;
  /** Exact passage of the source the card comes from. */
  excerpt: string;
  dueAt: string;
  stability: number;
  difficulty: number;
  /** Estimated probability of recall right now (null for new cards). */
  retrievability: number | null;
  lastReviewAt: string | null;
  suspended: boolean;
  /** "draft" cards wait for the learner's approval and are never studied. */
  status: CardStatus;
  /** Source document and part (page, slide or section) the card was made from. */
  document: { id: string; title: string; part: number | null; label: string | null } | null;
  createdAt: string;
  updatedAt: string;
}


export interface QueueCounts {
  learning: number;
  review: number;
  new: number;
}

export interface CardRow {
  id: string;
  user_id: string;
  deck_id: string;
  deck_name: string;
  front: string;
  back: string;
  explanation: string;
  source: string;
  excerpt: string;
  tags: string;
  state: CardState;
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  last_review_at: string | null;
  suspended: number;
  status: CardStatus;
  document_id: string | null;
  document_part: number | null;
  document_title?: string | null;
  document_label?: string | null;
  created_at: string;
  updated_at: string;
}
