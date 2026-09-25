import { AppShell } from '@/components/app/app-shell';
import { DraftsView } from '@/components/app/drafts-view';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ deck?: string; documentId?: string }> }) {
  const user = await requireUser();
  const { deck, documentId } = await searchParams;
  return (
    <AppShell userName={user.name}>
      <DraftsView deck={deck} documentId={documentId} />
    </AppShell>
  );
}
