import Link from 'next/link';
import { SignOutButton } from './sign-out-button';

const NAV = [
  { href: '/', label: 'Inicio' },
  { href: '/review', label: 'Repasar' },
  { href: '/documents', label: 'Documentos' },
  { href: '/drafts', label: 'Por revisar' },
  { href: '/account', label: 'Cuenta y agentes' },
];

export function AppShell({ userName, children }: { userName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            RecallForge
          </Link>
          <nav className="flex flex-1 flex-wrap gap-4 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{userName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
