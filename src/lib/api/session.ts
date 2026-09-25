import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

/** Server-component guard: the logged-in user, or a redirect to /login. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
