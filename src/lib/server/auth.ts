// ============================================================================
// RecallForge — Auth.js Configuration
// ============================================================================

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { serverDb } from '@/lib/server/db';
import { users } from '@/lib/server/db/schema';
import { runMigrations } from '@/lib/server/db/migrate';
import { hashApiKey } from '@/lib/server/api-keys';
import type { User as RecallForgeUser } from '@/types';

// Ensure tables exist on first auth call
let migrated = false;
function ensureMigrated() {
  if (!migrated) {
    runMigrations();
    migrated = true;
  }
}

function getTrustHost(): boolean {
  if (process.env.AUTH_TRUST_HOST === 'true') return true;
  if (process.env.TRUST_HOST === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function parseStudyPreferences(raw: string): RecallForgeUser['studyPreferences'] {
  const defaults: RecallForgeUser['studyPreferences'] = {
    showNextIntervals: true,
    simpleMode: false,
    autoplayAudio: true,
    doubleScrollProtection: true,
    focusModeDefault: false,
  };

  if (!raw || raw.trim().length === 0) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<RecallForgeUser['studyPreferences']>;
    return {
      ...defaults,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return defaults;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: getTrustHost(),
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
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
        ensureMigrated();

        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const [user] = await serverDb
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.passwordHash) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
        };
      },
    }),
  ],
});

// ─── Helper: Get authenticated user or null ────────────────────────────────

export async function getAuthUser(): Promise<RecallForgeUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  ensureMigrated();
  const [user] = await serverDb
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? undefined,
    locale: user.locale,
    timezone: user.timezone,
    theme: user.theme as 'light' | 'dark' | 'system',
    studyPreferences: parseStudyPreferences(user.studyPreferences),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Helper: Validate API key for agent access ─────────────────────────────

export async function getApiKeyUser(apiKey: string): Promise<RecallForgeUser | null> {
  ensureMigrated();
  const [hashedUser] = await serverDb
    .select()
    .from(users)
    .where(eq(users.apiKeyHash, hashApiKey(apiKey)))
    .limit(1);

  let user = hashedUser;

  if (!user) {
    const [legacyUser] = await serverDb
      .select()
      .from(users)
      .where(eq(users.apiKey, apiKey))
      .limit(1);
    user = legacyUser;
  }

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? undefined,
    locale: user.locale,
    timezone: user.timezone,
    theme: user.theme as 'light' | 'dark' | 'system',
    studyPreferences: parseStudyPreferences(user.studyPreferences),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
