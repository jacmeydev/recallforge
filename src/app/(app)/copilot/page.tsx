'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sparkles,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pencil,
  FileText,
  TrendingUp,
  Activity,
  Loader2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CopilotAction {
  id: string;
  actionType: string;
  title: string;
  description: string;
  reason: string;
  scope: Record<string, unknown>;
  estimatedMinutes: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  expectedImpact: string;
}

interface CopilotDraft {
  id: string;
  status: string;
  noteType: string;
  deck: string;
  fields: Record<string, string>;
  tags: string[];
  subject: string | null;
  reason: string | null;
  agentId: string;
  sourceMetadata: {
    importSource?: string;
    ingestionId?: string;
    sourceActionId?: string;
    academic?: {
      subject?: string;
      module?: string;
      chapter?: string;
      topic?: string;
      subtopic?: string;
    };
  };
  sourceAssets: Array<{ name?: string; pageNumber?: number; kind?: string }>;
  sourceActionId?: string | null;
  importedNoteId?: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewerComment: string | null;
}

interface BriefStats {
  totalCards: number;
  overdueCards: number;
  newCards: number;
  matureCards: number;
  pendingReviewCards: number;
  draftsPending: number;
  subjectsAtRisk: number;
  avgRetrievability: number;
}

interface CopilotBrief {
  date: string;
  summary: string;
  topPriority: string;
  actions: CopilotAction[];
  stats: BriefStats;
}

interface HistoryEvent {
  type: string;
  ts: string;
  payload: Record<string, unknown>;
}

const urgencyColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  imported: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  edited: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function CopilotPage() {
  const [activeTab, setActiveTab] = useState('brief');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brief, setBrief] = useState<CopilotBrief | null>(null);
  const [actions, setActions] = useState<CopilotAction[]>([]);
  const [drafts, setDrafts] = useState<CopilotDraft[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const fetchData = useCallback(async (tab: string) => {
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case 'brief': {
          const res = await fetch('/api/copilot/brief');
          if (!res.ok) throw new Error('Error cargando brief');
          const data = await res.json();
          setBrief(data);
          setActions(data.actions || []);
          break;
        }
        case 'actions': {
          const res = await fetch('/api/copilot/actions');
          if (!res.ok) throw new Error('Error cargando acciones');
          const data = await res.json();
          setActions(data.actions || []);
          break;
        }
        case 'drafts': {
          const res = await fetch('/api/copilot/drafts');
          if (!res.ok) throw new Error('Error cargando borradores');
          const data = await res.json();
          setDrafts(data.drafts || []);
          break;
        }
        case 'history': {
          const res = await fetch('/api/copilot/history?limit=50');
          if (!res.ok) throw new Error('Error cargando historial');
          const data = await res.json();
          setHistory(data.events || []);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  const handleReviewDraft = async (draftId: string, action: 'approve' | 'reject') => {
    setReviewingId(draftId);
    try {
      const res = await fetch('/api/copilot/drafts/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: [{ draftId, action }] }),
      });
      if (!res.ok) throw new Error('Error al revisar borrador');
      fetchData('drafts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setReviewingId(null);
    }
  };

  const handleDismissAction = async (action: CopilotAction) => {
    try {
      await fetch('/api/copilot/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendationId: action.id,
          actionType: action.actionType,
          actionTaken: false,
          userDismissed: true,
          resultSummary: `Dismissed: ${action.title}`,
          payload: {
            scope: action.scope,
            urgency: action.urgency,
          },
        }),
      });
    } catch { /* best effort */ }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Sparkles className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Study Copilot</h1>
          <p className="text-sm text-muted-foreground">
            Tu asistente de estudio con bucle cerrado
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => fetchData(activeTab)}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">Actualizar</span>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="brief"><TrendingUp className="mr-1 h-4 w-4" /> Brief</TabsTrigger>
          <TabsTrigger value="actions"><AlertTriangle className="mr-1 h-4 w-4" /> Acciones</TabsTrigger>
          <TabsTrigger value="drafts"><FileText className="mr-1 h-4 w-4" /> Borradores</TabsTrigger>
          <TabsTrigger value="history"><Activity className="mr-1 h-4 w-4" /> Historial</TabsTrigger>
        </TabsList>

        {error && (
          <Card className="mt-4 border-destructive">
            <CardContent className="pt-4 text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ─── Brief Tab ─── */}
        <TabsContent value="brief">
          {!loading && brief && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" /> Brief del día — {brief.date}
                  </CardTitle>
                  <CardDescription>{brief.summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 rounded-lg bg-muted/50 p-3">
                    <p className="text-sm font-medium">Prioridad principal:</p>
                    <p className="text-lg font-semibold text-primary">{brief.topPriority}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Total" value={brief.stats.totalCards} />
                    <StatCard label="Vencidas" value={brief.stats.overdueCards} alert={brief.stats.overdueCards > 0} />
                    <StatCard label="Nuevas" value={brief.stats.newCards} />
                    <StatCard label="Maduras" value={brief.stats.matureCards} />
                    <StatCard label="IA pendientes" value={brief.stats.pendingReviewCards} alert={brief.stats.pendingReviewCards > 0} />
                    <StatCard label="Borradores" value={brief.stats.draftsPending} />
                    <StatCard label="Materias riesgo" value={brief.stats.subjectsAtRisk} alert={brief.stats.subjectsAtRisk > 0} />
                    <StatCard label="Retrievability" value={`${Math.round(brief.stats.avgRetrievability * 100)}%`} />
                  </div>
                </CardContent>
              </Card>

              {brief.actions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Acciones sugeridas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {brief.actions.map(a => (
                      <ActionCard key={a.id} action={a} onDismiss={handleDismissAction} />
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── Actions Tab ─── */}
        <TabsContent value="actions">
          {!loading && (
            <div className="space-y-3">
              {actions.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">Sin acciones sugeridas por ahora.</CardContent></Card>
              ) : (
                actions.map(a => <ActionCard key={a.id} action={a} onDismiss={handleDismissAction} />)
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── Drafts Tab ─── */}
        <TabsContent value="drafts">
          {!loading && (
            <div className="space-y-3">
              {drafts.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">Sin borradores pendientes.</CardContent></Card>
              ) : (
                drafts.map(d => (
                  <Card key={d.id}>
                    <CardContent className="pt-4">
                      {(() => {
                        const academic = d.sourceMetadata?.academic;
                        const academicParts = [
                          academic?.subject,
                          academic?.module,
                          academic?.chapter,
                          academic?.topic,
                          academic?.subtopic,
                        ].filter(Boolean);
                        return (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={statusColors[d.status] || ''}>{d.status}</Badge>
                            <span className="text-xs text-muted-foreground">{d.noteType} → {d.deck}</span>
                            {d.sourceMetadata?.importSource && (
                              <Badge variant="outline" className="text-xs uppercase">
                                {d.sourceMetadata.importSource}
                              </Badge>
                            )}
                          </div>
                          {academicParts.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1">
                              {academicParts.map((part) => (
                                <Badge key={part} variant="secondary" className="text-[11px]">
                                  {part}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="space-y-1">
                            {Object.entries(d.fields).map(([k, v]) => (
                              <div key={k} className="text-sm">
                                <span className="font-medium">{k}:</span>{' '}
                                <span className="text-muted-foreground">{String(v).slice(0, 120)}</span>
                              </div>
                            ))}
                          </div>
                          {d.reason && (
                            <p className="mt-1 text-xs text-muted-foreground italic">Razón: {d.reason}</p>
                          )}
                          {d.tags.length > 0 && (
                            <div className="mt-1 flex gap-1 flex-wrap">
                              {d.tags.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                            </div>
                          )}
                          {d.reviewerComment && (
                            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">Comentario: {d.reviewerComment}</p>
                          )}
                          {(d.sourceMetadata?.ingestionId || d.sourceAssets.length > 0 || d.sourceActionId) && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              {d.sourceMetadata?.ingestionId && <span>Ingesta: {d.sourceMetadata.ingestionId}</span>}
                              {d.sourceActionId && <span>Acción: {d.sourceActionId}</span>}
                              {d.sourceAssets.length > 0 && <span>Assets: {d.sourceAssets.length}</span>}
                            </div>
                          )}
                        </div>
                        {(d.status === 'pending' || d.status === 'edited') && (
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleReviewDraft(d.id, 'approve')}
                              disabled={reviewingId === d.id}
                            >
                              {reviewingId === d.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <CheckCircle2 className="h-3 w-3" />}
                              <span className="ml-1">Aprobar</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReviewDraft(d.id, 'reject')}
                              disabled={reviewingId === d.id}
                            >
                              <XCircle className="h-3 w-3" />
                              <span className="ml-1">Rechazar</span>
                            </Button>
                          </div>
                        )}
                      </div>
                        );
                      })()}
                      <div className="mt-2 text-xs text-muted-foreground">
                        Creado: {new Date(d.createdAt).toLocaleString()}
                        {d.reviewedAt && ` · Revisado: ${new Date(d.reviewedAt).toLocaleString()}`}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── History Tab ─── */}
        <TabsContent value="history">
          {!loading && (
            <div className="space-y-2">
              {history.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">Sin actividad del copiloto aún.</CardContent></Card>
              ) : (
                history.map((evt, i) => (
                  <Card key={`${evt.ts}-${i}`}>
                    <CardContent className="flex items-center gap-3 py-3">
                      <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{evt.type.replace('copilot_', '').replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {Object.entries(evt.payload).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(evt.ts).toLocaleString()}
                      </span>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${alert ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950' : ''}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ActionCard({ action, onDismiss }: { action: CopilotAction; onDismiss: (a: CopilotAction) => void }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={urgencyColors[action.urgency] || ''}>{action.urgency}</Badge>
            <span className="font-medium text-sm">{action.title}</span>
          </div>
          <p className="text-sm text-muted-foreground">{action.description}</p>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> ~{action.estimatedMinutes} min</span>
            <span>Impacto: {action.expectedImpact}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onDismiss(action)} title="Descartar">
          <ThumbsDown className="h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}
