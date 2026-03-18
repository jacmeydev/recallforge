'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Flame,
  Target,
  AlertTriangle,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface HabitData {
  streak: number;
  longestStreak: number;
  dailyGoal: number;
  todayProgress: number;
  todayStudied: boolean;
  lastStudyDate: string | null;
  weekActivity: { date: string; studied: boolean; count: number }[];
  streakAtRisk: boolean;
}

export function DailyHabitCard() {
  const [habit, setHabit] = useState<HabitData | null>(null);

  useEffect(() => {
    fetch('/api/habit')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHabit(data); })
      .catch(() => {});
  }, []);

  if (!habit) return null;

  const goalPercent = Math.min(100, Math.round((habit.todayProgress / habit.dailyGoal) * 100));
  const dayNames = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  return (
    <Card className={cn(
      'transition-colors',
      habit.streakAtRisk && 'border-amber-500/50 bg-amber-500/5'
    )}>
      <CardContent className="py-4">
        {/* Header with streak */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className={cn('h-5 w-5', habit.streak > 0 ? 'text-orange-500' : 'text-muted-foreground')} />
            <span className="font-semibold text-lg">{habit.streak}</span>
            <span className="text-sm text-muted-foreground">
              {habit.streak === 1 ? 'día' : 'días'} de racha
            </span>
          </div>
          {habit.streakAtRisk && (
            <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>¡En riesgo!</span>
            </div>
          )}
          {habit.todayStudied && !habit.streakAtRisk && (
            <div className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>¡Hecho!</span>
            </div>
          )}
        </div>

        {/* Daily goal progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <div className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              <span>Meta diaria</span>
            </div>
            <span>{habit.todayProgress}/{habit.dailyGoal} tarjetas</span>
          </div>
          <Progress value={goalPercent} className="h-2" />
        </div>

        {/* Week activity dots */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            {habit.weekActivity.map((day, i) => {
              const date = new Date(day.date);
              const dayName = dayNames[date.getDay()];
              return (
                <div key={day.date} className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-muted-foreground">{dayName}</span>
                  <div
                    className={cn(
                      'h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-medium',
                      day.studied
                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                    )}
                    title={`${day.date}: ${day.count} tarjetas`}
                  >
                    {day.studied ? '✓' : '·'}
                  </div>
                </div>
              );
            })}
          </div>
          {habit.streakAtRisk && (
            <Link href="/rescue">
              <Button size="sm" variant="outline" className="text-xs h-7">
                Rescate
              </Button>
            </Link>
          )}
        </div>

        {/* Longest streak hint */}
        {habit.longestStreak > habit.streak && habit.longestStreak > 3 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Récord: {habit.longestStreak} días · 
            {habit.longestStreak - habit.streak <= 3
              ? ` ¡Solo ${habit.longestStreak - habit.streak} más para superarlo!`
              : ` Seguí así para superarlo`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
