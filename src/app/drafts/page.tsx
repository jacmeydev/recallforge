import { AppShell } from '@/components/app/app-shell';
import { DraftsView } from '@/components/app/drafts-view';

export const dynamic = 'force-dynamic';

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ deck?: string; documentId?: string }> }) {
  const { deck, documentId } = await searchParams;
  return (
    <AppShell>
      <DraftsView deck={deck} documentId={documentId} />
    </AppShell>
  );
}
