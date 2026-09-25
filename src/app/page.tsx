import { AppShell } from '@/components/app/app-shell';
import { Dashboard } from '@/components/app/dashboard';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
