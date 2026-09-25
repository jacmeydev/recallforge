import { AppShell } from '@/components/app/app-shell';
import { ProgressView } from '@/components/app/progress-view';

export const dynamic = 'force-dynamic';

export default function ProgressPage() {
  return (
    <AppShell>
      <ProgressView />
    </AppShell>
  );
}
