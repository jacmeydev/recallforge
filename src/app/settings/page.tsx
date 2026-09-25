import { headers } from 'next/headers';
import path from 'path';
import { AppShell } from '@/components/app/app-shell';
import { SettingsView } from '@/components/app/settings-view';
import { requiredToken } from '@/lib/api/auth';
import { resolveDatabasePath } from '@/lib/core/db';

export const dynamic = 'force-dynamic';

/** Public origin for the connection snippets: BASE_URL, else the (proxied) request host. */
async function publicOrigin(): Promise<string> {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3030';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function SettingsPage() {
  return (
    <AppShell>
      <SettingsView
        connection={{
          cliPath: path.join(process.cwd(), 'dist', 'cli.mjs'),
          origin: await publicOrigin(),
          databasePath: resolveDatabasePath(),
          tokenRequired: requiredToken() !== null,
        }}
      />
    </AppShell>
  );
}
