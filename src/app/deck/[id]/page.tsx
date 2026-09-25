import { AppShell } from '@/components/app/app-shell';
import { DeckView } from '@/components/app/deck-view';

export const dynamic = 'force-dynamic';

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <DeckView deckId={decodeURIComponent(id)} />
    </AppShell>
  );
}
