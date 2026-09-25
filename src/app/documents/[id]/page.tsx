import { AppShell } from '@/components/app/app-shell';
import { DocumentDetailView } from '@/components/app/document-detail';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <DocumentDetailView documentId={id} />
    </AppShell>
  );
}
