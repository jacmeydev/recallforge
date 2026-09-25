import { AppShell } from '@/components/app/app-shell';
import { DocumentsView } from '@/components/app/documents-view';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const user = await requireUser();
  return (
    <AppShell userName={user.name}>
      <DocumentsView />
    </AppShell>
  );
}
