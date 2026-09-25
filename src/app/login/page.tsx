'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/register')
      .then((res) => res.json())
      .then((data) => setRegistrationOpen(Boolean(data.open)))
      .catch(() => setRegistrationOpen(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? 'No se pudo crear la cuenta');
        const login = await signIn('credentials', { email, password, redirect: false });
        if (login?.error) throw new Error('Cuenta creada, pero no se pudo iniciar sesión. Inténtalo manualmente.');
        setApiKey(data.apiKey);
        return;
      }

      const login = await signIn('credentials', { email, password, redirect: false });
      if (login?.error) throw new Error('Email o contraseña incorrectos');
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    return (
      <Centered>
        <h1 className="text-2xl font-bold">Cuenta creada</h1>
        <p className="text-sm text-muted-foreground">
          Esta es tu clave de API para conectar agentes (Claude, ChatGPT, OpenClaw…). Guárdala: no se volverá a mostrar. Puedes generar
          otra cuando quieras en «Cuenta y agentes».
        </p>
        <code className="block break-all rounded-lg bg-muted p-3 text-xs select-all">{apiKey}</code>
        <Button
          className="w-full"
          onClick={() => {
            router.push('/account');
            router.refresh();
          }}
        >
          Ver cómo conectar mi agente
        </Button>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="text-center">
        <h1 className="text-3xl font-bold">RecallForge</h1>
        <p className="mt-1 text-sm text-muted-foreground">Memoria de repetición espaciada para ti y tus agentes</p>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nombre" autoComplete="name" />
        )}
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Email" autoComplete="email" />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="Contraseña (mínimo 8 caracteres)"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? '…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </Button>
      </form>

      {(registrationOpen || mode === 'register') && (
        <button
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Entra'}
        </button>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-8 shadow-lg">{children}</div>
    </div>
  );
}
