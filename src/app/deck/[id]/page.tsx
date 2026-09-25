import { AppShell } from '@/components/app/app-shell';
import { DeckView } from '@/components/app/deck-view';

export const dynamic = 'force-dynamic';

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { id } = await params;
  const { state } = await searchParams;
  return (
    <AppShell>
      <DeckView deckId={decodeURIComponent(id)} initialState={state ?? ''} />
    </AppShell>
  );
}
