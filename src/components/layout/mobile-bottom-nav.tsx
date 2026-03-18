'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  Plus,
  BarChart3,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const bottomNavItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/decks', label: 'Estudiar', icon: BookOpen },
  { href: '/notes/add', label: 'Agregar', icon: Plus, accent: true },
  { href: '/stats', label: 'Stats', icon: BarChart3 },
  { href: '/settings', label: 'Ajustes', icon: Settings },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 md:hidden">
      <div className="safe-area-bottom flex h-14 items-center justify-around px-1">
        {bottomNavItems.map((item) => {
          const isActive = pathname?.startsWith(item.href) && item.href !== '/notes/add';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 min-w-[3rem] py-1 px-2 rounded-lg transition-colors touch-manipulation',
                item.accent
                  ? 'text-primary-foreground'
                  : isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.accent ? (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary -mt-3 shadow-md">
                  <item.icon className="h-5 w-5 text-primary-foreground" />
                </div>
              ) : (
                <item.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5px]')} />
              )}
              <span className={cn('text-[10px] leading-none', item.accent && 'text-foreground')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
