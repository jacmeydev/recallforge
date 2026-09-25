import { AppShell } from '@/components/app/app-shell';
import { DeckView } from '@/components/app/deck-view';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return (
    <AppShell userName={user.name}>
      <DeckView deckId={decodeURIComponent(id)} />
    </AppShell>
  );
}
