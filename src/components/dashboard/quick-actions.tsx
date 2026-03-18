'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  BookOpen,
  Plus,
  Upload,
  Shield,
  Sparkles,
} from 'lucide-react';
import type { DeckWithCounts } from '@/types';

interface QuickActionsProps {
  totalStudyable: number;
  hasDecks: boolean;
  decks: DeckWithCounts[];
}

export function QuickActions({ totalStudyable, hasDecks, decks }: QuickActionsProps) {
  const router = useRouter();

  const handleStudy = () => {
    // Flatten the deck tree to find leaf decks with actual due cards
    const flatten = (list: DeckWithCounts[]): DeckWithCounts[] => {
      const result: DeckWithCounts[] = [];
      for (const d of list) {
        result.push(d);
        if (d.children?.length) result.push(...flatten(d.children));
      }
      return result;
    };
    const allDecks = flatten(decks);
    // Prefer leaf decks (no children) that have their own cards
    const leafWithDue = allDecks.find(
      d => (!d.children || d.children.length === 0) &&
           d.newCount + d.learningCount + d.reviewCount > 0
    );
    // Fallback: any deck with due cards
    const deckWithDue = leafWithDue || allDecks.find(
      d => d.newCount + d.learningCount + d.reviewCount > 0
    );
    if (deckWithDue) {
      router.push(`/study/${deckWithDue.id}`);
    } else {
      router.push('/decks');
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {/* Study Now — prominent if cards are due */}
      {totalStudyable > 0 && hasDecks && (
        <Button className="h-12 w-full gap-2 text-sm md:col-span-2 md:h-14 md:justify-start" size="lg" onClick={handleStudy}>
          <BookOpen className="h-4 w-4" />
          <span>Estudiar ({totalStudyable})</span>
        </Button>
      )}

      {/* Add Note */}
      <Link href="/notes/add">
        <Button variant="outline" className="h-12 w-full gap-2 text-sm md:h-14 md:justify-start">
          <Plus className="h-4 w-4" />
          <span>Agregar Nota</span>
        </Button>
      </Link>

      {/* AI Import */}
      <Link href="/ai-import">
        <Button variant="outline" className="h-12 w-full gap-2 text-sm md:h-14 md:justify-start">
          <Upload className="h-4 w-4" />
          <span>Importar IA</span>
        </Button>
      </Link>

      {/* Rescue */}
      <Link href="/rescue">
        <Button variant="outline" className="h-12 w-full gap-2 text-sm md:h-14 md:justify-start">
          <Shield className="h-4 w-4" />
          <span>Rescate</span>
        </Button>
      </Link>

      {/* Copilot */}
      <Link href="/copilot">
        <Button variant="outline" className="h-12 w-full gap-2 text-sm md:h-14 md:justify-start">
          <Sparkles className="h-4 w-4" />
          <span>Copilot</span>
        </Button>
      </Link>
    </div>
  );
}
