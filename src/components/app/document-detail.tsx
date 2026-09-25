'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { DocumentPartSummary, DocumentSummary, ReadDocumentResult } from '@/lib/core/documents';
import { agentPrompt, Coverage } from './documents-view';

type DocumentDetail = DocumentSummary & { outline: DocumentPartSummary[] };

export function DocumentDetailView({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [open, setOpen] = useState<{ index: number; text: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<{ document: DocumentDetail }>(`/api/v1/documents/${documentId}`)
      .then((data) => !cancelled && setDocument(data.document))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function togglePart(index: number) {
    if (open?.index === index) return setOpen(null);
    try {
      const data = await api<ReadDocumentResult>(`/api/v1/documents/${documentId}/read?fromPart=${index}&maxChars=500`);
      setOpen({ index, text: data.parts[0]?.text ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  async function remove(deleteCards: boolean) {
    const question = deleteCards
      ? '¿Eliminar el documento y TODAS las tarjetas creadas a partir de él?'
      : '¿Eliminar el documento? Las tarjetas creadas a partir de él se conservan.';
    if (!confirm(question)) return;
    try {
      await api(`/api/v1/documents/${documentId}?deleteCards=${deleteCards}`, { method: 'DELETE' });
      router.push('/documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  if (error) return <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!document) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const prompt = agentPrompt(document);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/documents" className="text-xs text-muted-foreground hover:underline">
            ← Documentos
          </Link>
          <h1 className="text-2xl font-bold">{document.title}</h1>
          <p className="text-sm text-muted-foreground">
            {document.deck?.name ?? 'Sin materia'} · {document.cards.active} tarjetas · {document.cards.drafts} por revisar
          </p>
        </div>
        <Coverage covered={document.cards.partsCovered} total={document.parts} />
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Pídele a tu agente:</p>
        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{prompt}</pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(prompt)}>
            Copiar mensaje
          </Button>
          {document.cards.drafts > 0 && (
            <Button size="sm" asChild>
              <Link href={`/drafts?documentId=${document.id}`}>Revisar {document.cards.drafts} borradores</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="divide-y rounded-xl border bg-card">
        {document.outline.map((part) => (
          <div key={part.index} className="p-3 text-sm">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => void togglePart(part.index)}>
              <span className="flex-1 font-medium">{part.label}</span>
              <span className="text-xs text-muted-foreground">{part.chars.toLocaleString()} caracteres</span>
              <span className={`text-xs ${part.cards > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {part.cards > 0 ? `${part.cards} tarjetas` : 'sin tarjetas'}
              </span>
            </button>
            {open?.index === part.index && (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{open.text}</pre>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" className="text-destructive" onClick={() => void remove(false)}>
          Eliminar documento
        </Button>
        <Button variant="ghost" className="text-destructive" onClick={() => void remove(true)}>
          Eliminar documento y sus tarjetas
        </Button>
      </div>
    </div>
  );
}
