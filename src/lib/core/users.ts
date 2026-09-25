// ============================================================================
// RecallForge — Users and API keys
// ============================================================================

import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { createApiKey, getApiKeyPreview, hashApiKey } from '@/lib/server/api-keys';
import { genId, getDb, nowIso } from './db';
import { badRequest, conflict, notFound } from './errors';
import { isValidTimezone } from './time';
import type { AuthUser } from './types';

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(100),
  timezone: z.string().optional(),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  timezone: string;
  api_key_preview: string | null;
  api_key_last_rotated_at: string | null;
  created_at: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, timezone: row.timezone || 'UTC' };
}

/**
 * Private by default: only the first account can sign up, unless the server
 * sets ALLOW_REGISTRATION=true.
 */
export function isRegistrationOpen(): boolean {
  if (process.env.ALLOW_REGISTRATION === 'true') return true;
  return !getDb().prepare(`SELECT 1 FROM users LIMIT 1`).get();
}

export async function registerUser(input: unknown): Promise<{ user: AuthUser; apiKey: string }> {
  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid registration', parsed.error.issues);
  const { email, password, name } = parsed.data;
  const timezone = parsed.data.timezone && isValidTimezone(parsed.data.timezone) ? parsed.data.timezone : 'UTC';
  const db = getDb();
  if (db.prepare(`SELECT 1 FROM users WHERE email = ? COLLATE NOCASE`).get(email)) {
    throw conflict('An account with this email already exists');
  }

  const now = nowIso();
  const apiKey = createApiKey();
  const user = { id: genId(), email, name, timezone };
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, timezone, api_key_hash, api_key_preview, api_key_last_rotated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, email, name, await hash(password, 12), timezone, hashApiKey(apiKey), getApiKeyPreview(apiKey), now, now, now);
  return { user, apiKey };
}

export async function verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
  const row = getDb().prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).get(email.trim()) as UserRow | undefined;
  if (!row?.password_hash) return null;
  return (await compare(password, row.password_hash)) ? toAuthUser(row) : null;
}

export function findUserById(id: string): AuthUser | null {
  const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toAuthUser(row) : null;
}

export function findUserByApiKey(apiKey: string): AuthUser | null {
  if (!apiKey.startsWith('rf_')) return null;
  const row = getDb().prepare(`SELECT * FROM users WHERE api_key_hash = ?`).get(hashApiKey(apiKey)) as UserRow | undefined;
  return row ? toAuthUser(row) : null;
}

export function rotateApiKey(userId: string): { apiKey: string; apiKeyPreview: string; rotatedAt: string } {
  const apiKey = createApiKey();
  const rotatedAt = nowIso();
  const result = getDb()
    .prepare(`UPDATE users SET api_key_hash = ?, api_key_preview = ?, api_key_last_rotated_at = ?, updated_at = ? WHERE id = ?`)
    .run(hashApiKey(apiKey), getApiKeyPreview(apiKey), rotatedAt, rotatedAt, userId);
  if (result.changes === 0) throw notFound('User', userId);
  return { apiKey, apiKeyPreview: getApiKeyPreview(apiKey), rotatedAt };
}

export function getAccount(userId: string) {
  const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
  if (!row) throw notFound('User', userId);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    timezone: row.timezone,
    apiKeyPreview: row.api_key_preview,
    apiKeyLastRotatedAt: row.api_key_last_rotated_at,
    createdAt: row.created_at,
  };
}
