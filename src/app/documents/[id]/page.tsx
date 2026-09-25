import { AppShell } from '@/components/app/app-shell';
import { DocumentDetailView } from '@/components/app/document-detail';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  return (
    <AppShell userName={user.name}>
      <DocumentDetailView documentId={id} />
    </AppShell>
  );
}
