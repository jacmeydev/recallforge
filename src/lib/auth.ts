// ============================================================================
// RecallForge — Web session auth (Auth.js credentials, JWT sessions)
// ============================================================================
// Browsers log in with email + password; agents use API keys instead
// (see src/lib/api/auth.ts).
// ============================================================================

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { findUserById, verifyCredentials } from '@/lib/core/users';
import type { AuthUser } from '@/lib/core/types';

function trustHost(): boolean {
  if (process.env.AUTH_TRUST_HOST === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: trustHost(),
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === 'string') session.user.id = token.id;
      return session;
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;
        const user = await verifyCredentials(email, password);
        return user ? { id: user.id, email: user.email, name: user.name } : null;
      },
    }),
  ],
});

/** The logged-in web user, or null. */
export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const session = await auth();
    return session?.user?.id ? findUserById(session.user.id) : null;
  } catch {
    return null;
  }
}
