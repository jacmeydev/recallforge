'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Registration failed');
          setLoading(false);
          return;
        }

        // Show API key to user
        setApiKey(data.apiKey);

        // Auto-login after registration
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
        });

        if (result?.error) {
          setError('Account created but login failed. Try logging in manually.');
          setLoading(false);
          return;
        }

        // Don't redirect yet — show API key first
        setLoading(false);
        return;
      }

      // Login
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Connection error. Try again.');
      setLoading(false);
    }
  }

  // API key reveal screen after registration
  if (apiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 bg-card rounded-xl border p-8 shadow-lg">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Account Created</h1>
            <p className="text-muted-foreground mt-2">
              Save your API key for UniBot/OpenClaw integration:
            </p>
          </div>

          <div className="bg-muted rounded-lg p-4">
            <code className="text-xs break-all select-all text-foreground">{apiKey}</code>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            This key will not be shown again. Store it securely.
          </p>

          <button
            onClick={() => { router.push('/dashboard'); router.refresh(); }}
            className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium hover:bg-primary/90 transition-colors"
          >
            Continue to RecallForge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 bg-card rounded-xl border p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">RecallForge</h1>
          <p className="text-muted-foreground mt-1">
            {mode === 'login' ? 'Log in to your account' : 'Create a new account'}
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full rounded-lg border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="At least 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-3 font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === 'login' ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        <div className="text-center">
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === 'login'
              ? "Don't have an account? Register"
              : 'Already have an account? Log in'}
          </button>
        </div>

        <div className="border-t pt-4">
          <button
            onClick={() => { router.push('/dashboard'); }}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            Continue offline (local-only mode)
          </button>
        </div>
      </div>
    </div>
  );
}
