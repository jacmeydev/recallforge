export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — User Registration API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { serverDb } from '@/lib/server/db';
import { users } from '@/lib/server/db/schema';
import { runMigrations } from '@/lib/server/db/migrate';
import { createApiKey, getApiKeyPreview, hashApiKey } from '@/lib/server/api-keys';
import { logger } from '@/lib/server/logger';
import { getRequestContext, withRequestContext } from '@/lib/server/request-context';

let migrated = false;

export async function POST(req: NextRequest) {
  const context = getRequestContext(req);
  const log = logger.withContext({ requestId: context.requestId, route: 'auth/register' });
  if (!migrated) { runMigrations(); migrated = true; }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return withRequestContext(
        NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        ),
        context
      );
    }

    const payload = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
    const email = typeof payload.email === 'string' ? payload.email : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const name = typeof payload.name === 'string' ? payload.name : '';

    if (!email || !password || !name) {
      return withRequestContext(
        NextResponse.json(
          { error: 'email, password, and name are required' },
          { status: 400 }
        ),
        context
      );
    }

    if (typeof password !== 'string' || password.length < 8) {
      return withRequestContext(
        NextResponse.json(
          { error: 'Password must be at least 8 characters' },
          { status: 400 }
        ),
        context
      );
    }

    // Check for existing user
    const [existing] = await serverDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return withRequestContext(
        NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        ),
        context
      );
    }

    const now = new Date().toISOString();
    const passwordHash = await hash(password, 12);
    const apiKey = createApiKey();

    const newUser = {
      id: uuidv4(),
      email: email as string,
      name: name as string,
      passwordHash,
      locale: 'es',
      timezone: 'America/Bogota',
      theme: 'system',
      studyPreferences: JSON.stringify({
        showNextIntervals: true,
        simpleMode: false,
        autoplayAudio: true,
        doubleScrollProtection: true,
        focusModeDefault: false,
      }),
      apiKey: null,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPreview: getApiKeyPreview(apiKey),
      apiKeyLastRotatedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await serverDb.insert(users).values(newUser);

    log.info('User registered', { userId: newUser.id, email: newUser.email });

    return withRequestContext(NextResponse.json({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      apiKey,
      apiKeyPreview: newUser.apiKeyPreview,
    }, { status: 201 }), context);
  } catch (err) {
    log.error('Registration error', { error: err instanceof Error ? err.message : 'Unknown' });
    return withRequestContext(
      NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
      context
    );
  }
}
