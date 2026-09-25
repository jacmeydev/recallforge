import { headers } from 'next/headers';
import { AppShell } from '@/components/app/app-shell';
import { AccountView } from '@/components/app/account-view';
import { requireUser } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

/** Public origin for the connection snippets: BASE_URL, else the (proxied) request host. */
async function publicOrigin(): Promise<string> {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3030';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <AppShell userName={user.name}>
      <AccountView origin={await publicOrigin()} />
    </AppShell>
  );
}
