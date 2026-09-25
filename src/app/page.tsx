import { AppShell } from '@/components/app/app-shell';
import { Dashboard } from '@/components/app/dashboard';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await requireUser();
  return (
    <AppShell userName={user.name}>
      <Dashboard />
    </AppShell>
  );
}
