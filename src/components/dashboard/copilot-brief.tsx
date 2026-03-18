'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  ArrowRight,
  AlertTriangle,
  BookOpen,
  TrendingUp,
} from 'lucide-react';

interface CopilotAction {
  id: string;
  actionType: string;
  title: string;
  description: string;
  urgency: string;
}

export function CopilotBriefCard() {
  const [actions, setActions] = useState<CopilotAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/copilot/actions')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.actions) setActions(data.actions.slice(0, 3));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || actions.length === 0) return null;

  const getIcon = (actionType: string) => {
    switch (actionType) {
      case 'study_overdue': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      case 'study_weak_topic': return <BookOpen className="h-3.5 w-3.5 text-blue-500" />;
      case 'rescue_session': return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
      default: return <Sparkles className="h-3.5 w-3.5 text-purple-500" />;
    }
  };

  return (
    <Card className="border-purple-200 dark:border-purple-900/50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium">Copilot sugiere</span>
          </div>
          <Link href="/copilot">
            <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
              Ver todo
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>

        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="flex items-start gap-2 text-sm">
              <div className="mt-0.5 shrink-0">{getIcon(action.actionType)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs">{action.title}</p>
                <p className="text-xs text-muted-foreground truncate">{action.description}</p>
              </div>
              {(action.urgency === 'high' || action.urgency === 'critical') && (
                <Badge variant="destructive" className="text-[10px] h-4">
                  Urgente
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
