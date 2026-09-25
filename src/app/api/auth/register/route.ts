import { NextResponse } from 'next/server';
import { errorResponse, readJson } from '@/lib/api/handler';
import { AppError } from '@/lib/core/errors';
import { isRegistrationOpen, registerUser } from '@/lib/core/users';

export const dynamic = 'force-dynamic';

/** GET /api/auth/register — whether new accounts can be created. */
export function GET() {
  return NextResponse.json({ open: isRegistrationOpen() });
}

/** POST /api/auth/register — { email, password, name, timezone? } → account + API key (shown once). */
export async function POST(req: Request) {
  try {
    if (!isRegistrationOpen()) {
      throw new AppError(403, 'registration_closed', 'Registration is closed on this server');
    }
    const { user, apiKey } = await registerUser(await readJson(req));
    return NextResponse.json({ user, apiKey }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
