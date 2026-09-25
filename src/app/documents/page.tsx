import { AppShell } from '@/components/app/app-shell';
import { DocumentsView } from '@/components/app/documents-view';

export const dynamic = 'force-dynamic';

export default function DocumentsPage() {
  return (
    <AppShell>
      <DocumentsView />
    </AppShell>
  );
}
