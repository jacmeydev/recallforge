'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { DocumentSummary } from '@/lib/core/documents';
import type { DeckSummary } from '@/lib/core/types';

const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm,.csv,.tsv,.json';

export function agentPrompt(document: { id: string; title: string }): string {
  return `Usa RecallForge para crear tarjetas de alta calidad del documento "${document.title}" (id ${document.id}). Léelo parte por parte, crea las tarjetas como borradores enlazadas a su página y luego dime qué creaste por sección.`;
}

export function DocumentsView() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deck, setDeck] = useState('');
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<{ documents: DocumentSummary[] }>('/api/v1/documents'), api<{ decks: DeckSummary[] }>('/api/v1/decks')])
      .then(([docs, deckData]) => {
        if (cancelled) return;
        setDocuments(docs.documents);
        setDecks(deckData.decks);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return setError('Elige un archivo');
    setUploading(true);
    setError('');
    setUploaded(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (deck.trim()) form.append('deck', deck.trim());
      if (title.trim()) form.append('title', title.trim());
      const res = await fetch('/api/v1/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'No se pudo subir el archivo');
      setUploaded(data.document);
      setTitle('');
      if (fileInput.current) fileInput.current.value = '';
      setReloadToken((token) => token + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Documentos</h1>
        <p className="text-sm text-muted-foreground">
          Sube tus apuntes, libros o diapositivas. Tu agente los lee parte por parte y crea las tarjetas enlazadas a cada página.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subir documento</CardTitle>
          <CardDescription>PDF, Word (.docx), PowerPoint (.pptx), texto, Markdown, HTML o CSV · hasta 30 MB</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={upload} className="grid gap-3 md:grid-cols-2">
            <input ref={fileInput} type="file" accept={ACCEPT} className="text-sm md:col-span-2" required />
            <Input value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="Materia, p. ej. Medicina::Farmacología" list="deck-paths" />
            <datalist id="deck-paths">
              {decks.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" />
            <div className="md:col-span-2">
              <Button type="submit" disabled={uploading}>
                {uploading ? 'Procesando…' : 'Subir'}
              </Button>
            </div>
          </form>
          {error && <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {uploaded && <UploadedNotice document={uploaded} />}
        </CardContent>
      </Card>

      <div className="divide-y rounded-xl border bg-card">
        {documents?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Todavía no has subido documentos.</p>}
        {documents?.map((doc) => (
          <div key={doc.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Link href={`/documents/${doc.id}`} className="font-medium hover:underline">
                {doc.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {doc.deck?.name ?? 'Sin materia'} · {doc.parts} partes · {doc.cards.active} tarjetas
                {doc.cards.drafts > 0 && (
                  <>
                    {' '}·{' '}
                    <Link href={`/drafts?documentId=${doc.id}`} className="text-amber-600 hover:underline">
                      {doc.cards.drafts} por revisar
                    </Link>
                  </>
                )}
              </p>
            </div>
            <Coverage covered={doc.cards.partsCovered} total={doc.parts} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Coverage({ covered, total }: { covered: number; total: number }) {
  const percent = total > 0 ? Math.round((covered / total) * 100) : 0;
  return (
    <div className="w-40 text-right text-xs text-muted-foreground">
      <div className="mb-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
      {covered}/{total} partes con tarjetas
    </div>
  );
}

function UploadedNotice({ document }: { document: DocumentSummary }) {
  const prompt = agentPrompt(document);
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p>
        <strong>{document.title}</strong> listo: {document.parts} partes. Ahora pídele a tu agente (conectado a RecallForge):
      </p>
      <pre className="whitespace-pre-wrap rounded bg-white/70 p-2 text-xs">{prompt}</pre>
      <button className="text-xs underline" onClick={() => void navigator.clipboard.writeText(prompt)}>
        Copiar mensaje
      </button>
    </div>
  );
}
