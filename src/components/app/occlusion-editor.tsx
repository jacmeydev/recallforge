'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';

interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  group?: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Image occlusion editor: upload an image, drag to draw the regions to hide,
 * name each structure. One card per region (or per group of regions).
 */
export function OcclusionEditor({ deck, onCreated }: { deck: string; onCreated: (count: number) => void }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [header, setHeader] = useState('');
  const [extra, setExtra] = useState('');
  const [hideAll, setHideAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const point = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/v1/media', { method: 'POST', body: form, headers: { 'x-recallforge-client': 'web' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Error');
      setImage({ id: data.media.id, url: `/api/v1/media/${data.media.id}` });
      setRegions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!image || regions.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ created: unknown[] }>('/api/v1/cards', {
        method: 'POST',
        body: {
          deck,
          cards: [
            {
              front: header.trim(),
              back: extra.trim() || undefined,
              occlusion: {
                image: image.id,
                hideAll,
                regions: regions.map(({ label, group, ...rest }) => ({ ...rest, ...(label.trim() ? { label: label.trim() } : {}), ...(group ? { group } : {}) })),
              },
            },
          ],
        },
      });
      onCreated(result.created.length);
      setImage(null);
      setRegions([]);
      setHeader('');
      setExtra('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  if (!image) {
    return (
      <div className="space-y-2">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground hover:bg-accent">
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          {busy ? 'Subiendo…' : 'Elige una imagen (anatomía, histología, radiografía, esquema…)'}
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Arrastra sobre la imagen para tapar cada estructura y escribe su nombre. Cada región será una tarjeta.</p>
      <div
        ref={box}
        className="relative mx-auto w-fit touch-none select-none"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start.current = point(e);
          setDrawing({ x: start.current.x, y: start.current.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = point(e);
          setDrawing({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
        }}
        onPointerUp={() => {
          if (drawing && drawing.w > 0.01 && drawing.h > 0.01) {
            setRegions((current) => [...current, { left: round(drawing.x), top: round(drawing.y), width: round(drawing.w), height: round(drawing.h), label: '' }]);
          }
          start.current = null;
          setDrawing(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="Imagen a ocluir" className="block max-h-[70vh] max-w-full rounded-md" draggable={false} />
        {regions.map((region, i) => (
          <div
            key={i}
            className="absolute flex items-center justify-center border border-neutral-900 bg-[#ffeba2]/90 text-xs font-semibold text-neutral-900"
            style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
          >
            {region.group ?? i + 1}
          </div>
        ))}
        {drawing && (
          <div
            className="absolute border-2 border-dashed border-red-600 bg-[#ff8e8e]/60"
            style={{ left: `${drawing.x * 100}%`, top: `${drawing.y * 100}%`, width: `${drawing.w * 100}%`, height: `${drawing.h * 100}%` }}
          />
        )}
      </div>

      {regions.length > 0 && (
        <ol className="space-y-1.5">
          {regions.map((region, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-right text-xs text-muted-foreground">{region.group ?? i + 1}</span>
              <Input
                className="h-8"
                value={region.label}
                placeholder="Nombre de la estructura (la respuesta)"
                onChange={(e) => setRegions((current) => current.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              />
              <Input
                className="h-8 w-20"
                type="number"
                min={1}
                title="Grupo: regiones con el mismo número se preguntan juntas"
                placeholder="grupo"
                value={region.group ?? ''}
                onChange={(e) =>
                  setRegions((current) => current.map((r, j) => (j === i ? { ...r, group: e.target.value ? Number(e.target.value) : undefined } : r)))
                }
              />
              <button className="text-xs text-destructive" onClick={() => setRegions((current) => current.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Título (opcional), p. ej. «Plexo braquial»" />
        <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Notas al responder (opcional)" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hideAll} onChange={(e) => setHideAll(e.target.checked)} />
        Tapar todas las regiones y preguntar una (si no, solo se tapa la que se pregunta)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy || regions.length === 0}>
          Crear {regions.length ? new Set(regions.map((r, i) => r.group ?? `r${i}`)).size : ''} tarjetas
        </Button>
        <Button variant="ghost" onClick={() => setImage(null)}>
          Cambiar imagen
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
