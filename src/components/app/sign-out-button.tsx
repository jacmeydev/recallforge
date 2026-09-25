'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: '/login' })} className="hover:text-foreground">
      Salir
    </button>
  );
}
