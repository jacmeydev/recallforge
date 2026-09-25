'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { Explanation } from '@/lib/core/explain';
import type { Card } from '@/lib/core/types';

/** Where a card comes from: document, page/slide and the exact excerpt. */
export function CardSource({ card }: { card: Pick<Card, 'source' | 'excerpt' | 'document'> }) {
  if (!card.document && !card.source && !card.excerpt) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div>
        Fuente:{' '}
        {card.document ? (
          <Link
            href={`/documents/${card.document.id}${card.document.part != null ? `#part-${card.document.part}` : ''}`}
            className="underline hover:text-foreground"
          >
            {card.document.title}
            {card.document.label ? `, ${card.document.label}` : ''}
          </Link>
        ) : (
          card.source
        )}
      </div>
      {card.excerpt && (
        <blockquote className="border-l-2 pl-2 italic" style={{ borderColor: 'var(--color-bar)' }}>
          “{card.excerpt}”
        </blockquote>
      )}
    </div>
  );
}

/**
 * "Explícame esto": the source text around the excerpt, past attempts and
 * related cards, plus a ready-to-paste request for the learner's agent.
 * Nothing here is generated: it is the learner's own material.
 */
export function ExplainButton({ cardId }: { cardId: string }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return;
    try {
      setData(await api<Explanation>(`/api/v1/cards/${cardId}/explain`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  const prompt = `Explícame la tarjeta ${cardId} de RecallForge (usa explain_card y cita la fuente).`;

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => void toggle()} aria-expanded={open}>
        {open ? 'Ocultar explicación' : 'Explícame esto'}
      </Button>
      {open && (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
          {error && <p className="text-destructive">{error}</p>}
          {!data && !error && <p className="text-muted-foreground">Cargando…</p>}
          {data && (
            <>
              {data.card.explanation && <p className="whitespace-pre-wrap">{data.card.explanation}</p>}
              {data.source ? (
                <div className="space-y-1">
                  <div className="text-xs font-medium">
                    {data.source.documentTitle}
                    {data.source.label ? ` · ${data.source.label}` : ''}
                  </div>
                  <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    <Highlighted text={data.source.context} excerpt={data.source.excerpt} />
                  </p>
                </div>
              ) : (
                !data.card.explanation && <p className="text-xs text-muted-foreground">Esta tarjeta no tiene documento de origen ni explicación.</p>
              )}
              {data.related.length > 0 && (
                <div>
                  <div className="text-xs font-medium">Tarjetas relacionadas</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {data.related.map((card) => (
                      <li key={card.id}>
                        {card.front} → <span className="text-foreground">{card.back}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
                <span>¿Quieres una explicación a fondo? Pídesela a tu agente:</span>
                <button
                  className="rounded border px-2 py-0.5 hover:bg-accent"
                  onClick={() => {
                    void navigator.clipboard?.writeText(prompt).then(() => setCopied(true));
                  }}
                >
                  {copied ? 'Copiado' : 'Copiar petición'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Highlighted({ text, excerpt }: { text: string; excerpt: string }) {
  const at = excerpt ? text.toLowerCase().indexOf(excerpt.replace(/\s+/g, ' ').toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-100 px-0.5 text-amber-950 dark:bg-amber-900/60 dark:text-amber-50">
        {text.slice(at, at + excerpt.replace(/\s+/g, ' ').length)}
      </mark>
      {text.slice(at + excerpt.replace(/\s+/g, ' ').length)}
    </>
  );
}
