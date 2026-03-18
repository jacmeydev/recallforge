export const dynamic = 'force-dynamic';

// ============================================================================
// RecallForge — Session API (returns current user info)
// ============================================================================

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/server/auth';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      timezone: user.timezone,
      theme: user.theme,
    },
  });
}
