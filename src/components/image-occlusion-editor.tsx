'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Upload,
  ClipboardPaste,
  Trash2,
  RectangleHorizontal,
  MousePointer2,
  ImageIcon,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Normalized rect (0-1 relative to image dimensions) */
export interface IORect {
  id: string;
  x: number;      // 0-1
  y: number;      // 0-1
  width: number;   // 0-1
  height: number;  // 0-1
}

interface Props {
  imageDataUrl: string;
  masks: IORect[];
  onImageChange: (dataUrl: string) => void;
  onMasksChange: (masks: IORect[]) => void;
}

type Tool = 'draw' | 'select';

interface DrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

let nextId = 1;
function genId() {
  return `mask-${Date.now()}-${nextId++}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ImageOcclusionEditor({ imageDataUrl, masks, onImageChange, onMasksChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tool, setTool] = useState<Tool>('draw');
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ maskId: string; offsetX: number; offsetY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ maskId: string; handle: string; startRect: IORect } | null>(null);
  const [changeImageWarning, setChangeImageWarning] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  // ─── Image Handling ───────────────────────────────────────────────────

  const loadImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (masks.length > 0 && imageDataUrl) {
        setPendingImage(dataUrl);
        setChangeImageWarning(true);
      } else {
        onImageChange(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  }, [masks, imageDataUrl, onImageChange]);

  const handleConfirmChangeImage = () => {
    if (pendingImage) {
      onImageChange(pendingImage);
      onMasksChange([]);
    }
    setPendingImage(null);
    setChangeImageWarning(false);
  };

  const handleCancelChangeImage = () => {
    setPendingImage(null);
    setChangeImageWarning(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImageFile(file);
    e.target.value = '';
  };

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (masks.length > 0 && imageDataUrl) {
              setPendingImage(dataUrl);
              setChangeImageWarning(true);
            } else {
              onImageChange(dataUrl);
            }
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch {
      // Clipboard API not available or denied
    }
  }, [masks, imageDataUrl, onImageChange]);

  // Paste from keyboard
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) loadImageFile(file);
          e.preventDefault();
          break;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [loadImageFile]);

  // Drag-and-drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadImageFile(file);
  }, [loadImageFile]);

  // ─── Coordinate conversion ───────────────────────────────────────────

  const toNormalized = useCallback((clientX: number, clientY: number): [number, number] => {
    const img = imgRef.current;
    if (!img) return [0, 0];
    const rect = img.getBoundingClientRect();
    return [
      clamp((clientX - rect.left) / rect.width, 0, 1),
      clamp((clientY - rect.top) / rect.height, 0, 1),
    ];
  }, []);

  // ─── Drawing ──────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!imageDataUrl) return;
    const [nx, ny] = toNormalized(e.clientX, e.clientY);

    if (tool === 'draw') {
      setDrawState({ startX: nx, startY: ny, currentX: nx, currentY: ny });
      setSelectedId(null);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, [imageDataUrl, tool, toNormalized]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const [nx, ny] = toNormalized(e.clientX, e.clientY);

    if (drawState) {
      setDrawState(prev => prev ? { ...prev, currentX: nx, currentY: ny } : null);
    } else if (dragState) {
      const mask = masks.find(m => m.id === dragState.maskId);
      if (!mask) return;
      const newX = clamp(nx - dragState.offsetX, 0, 1 - mask.width);
      const newY = clamp(ny - dragState.offsetY, 0, 1 - mask.height);
      onMasksChange(masks.map(m =>
        m.id === dragState.maskId ? { ...m, x: newX, y: newY } : m
      ));
    } else if (resizeState) {
      const { maskId, handle, startRect } = resizeState;
      let newRect = { ...startRect };

      if (handle.includes('e')) {
        newRect.width = clamp(nx - startRect.x, 0.02, 1 - startRect.x);
      }
      if (handle.includes('w')) {
        const right = startRect.x + startRect.width;
        const newX = clamp(nx, 0, right - 0.02);
        newRect.x = newX;
        newRect.width = right - newX;
      }
      if (handle.includes('s')) {
        newRect.height = clamp(ny - startRect.y, 0.02, 1 - startRect.y);
      }
      if (handle.includes('n')) {
        const bottom = startRect.y + startRect.height;
        const newY = clamp(ny, 0, bottom - 0.02);
        newRect.y = newY;
        newRect.height = bottom - newY;
      }

      onMasksChange(masks.map(m => m.id === maskId ? { ...m, ...newRect } : m));
    }
  }, [drawState, dragState, resizeState, masks, toNormalized, onMasksChange]);

  const handlePointerUp = useCallback(() => {
    if (drawState) {
      const x = Math.min(drawState.startX, drawState.currentX);
      const y = Math.min(drawState.startY, drawState.currentY);
      const w = Math.abs(drawState.currentX - drawState.startX);
      const h = Math.abs(drawState.currentY - drawState.startY);

      if (w > 0.01 && h > 0.01) {
        const newMask: IORect = { id: genId(), x, y, width: w, height: h };
        onMasksChange([...masks, newMask]);
        setSelectedId(newMask.id);
      }
      setDrawState(null);
    }
    setDragState(null);
    setResizeState(null);
  }, [drawState, masks, onMasksChange]);

  // ─── Mask interaction ─────────────────────────────────────────────────

  const handleMaskPointerDown = useCallback((e: React.PointerEvent, maskId: string) => {
    e.stopPropagation();
    if (tool === 'draw') return;
    const [nx, ny] = toNormalized(e.clientX, e.clientY);
    const mask = masks.find(m => m.id === maskId);
    if (!mask) return;
    setSelectedId(maskId);
    setDragState({ maskId, offsetX: nx - mask.x, offsetY: ny - mask.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [tool, masks, toNormalized]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent, maskId: string, handle: string) => {
    e.stopPropagation();
    const mask = masks.find(m => m.id === maskId);
    if (!mask) return;
    setResizeState({ maskId, handle, startRect: { ...mask } });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [masks]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedId) {
      onMasksChange(masks.filter(m => m.id !== selectedId));
      setSelectedId(null);
    }
  }, [selectedId, masks, onMasksChange]);

  // Delete key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, handleDeleteSelected]);

  // ─── Render ───────────────────────────────────────────────────────────

  const resizeHandles = ['nw', 'ne', 'sw', 'se'];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Subir imagen
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePaste}
          className="gap-2"
        >
          <ClipboardPaste className="h-4 w-4" />
          Pegar imagen
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {imageDataUrl && (
          <>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant={tool === 'draw' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setTool('draw'); setSelectedId(null); }}
              className="gap-2"
            >
              <RectangleHorizontal className="h-4 w-4" />
              Dibujar
            </Button>
            <Button
              variant={tool === 'select' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('select')}
              className="gap-2"
            >
              <MousePointer2 className="h-4 w-4" />
              Seleccionar
            </Button>

            {selectedId && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Borrar zona
                </Button>
              </>
            )}

            <div className="ml-auto text-xs text-muted-foreground tabular-nums">
              {masks.length} zona{masks.length !== 1 ? 's' : ''} marcada{masks.length !== 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>

      {/* Change image warning */}
      {changeImageWarning && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="flex-1">Si cambias la imagen, se borrarán las {masks.length} zonas actuales.</span>
          <Button size="sm" variant="destructive" onClick={handleConfirmChangeImage}>Cambiar</Button>
          <Button size="sm" variant="outline" onClick={handleCancelChangeImage}>Cancelar</Button>
        </div>
      )}

      {/* Editor area */}
      <div
        ref={containerRef}
        className={cn(
          'relative rounded-xl border-2 border-dashed overflow-hidden select-none',
          !imageDataUrl ? 'border-muted-foreground/25 bg-muted/30' : 'border-transparent bg-black/5 dark:bg-white/5',
          tool === 'draw' && imageDataUrl && 'cursor-crosshair',
          tool === 'select' && imageDataUrl && 'cursor-default',
        )}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {!imageDataUrl ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <ImageIcon className="h-12 w-12 opacity-40" />
            <p className="text-sm font-medium">Sube o pega una imagen para empezar</p>
            <p className="text-xs opacity-60">También puedes arrastrar una imagen aquí</p>
          </div>
        ) : (
          <div className="relative inline-block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageDataUrl}
              alt="Imagen para oclusión"
              className="block w-full h-auto pointer-events-none"
              draggable={false}
            />

            {/* SVG overlay for masks */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            >
              {masks.map(mask => (
                <g key={mask.id}>
                  <rect
                    x={mask.x}
                    y={mask.y}
                    width={mask.width}
                    height={mask.height}
                    fill={selectedId === mask.id ? 'rgba(33, 150, 243, 0.55)' : 'rgba(255, 87, 34, 0.65)'}
                    stroke={selectedId === mask.id ? '#1976D2' : '#E64A19'}
                    strokeWidth={0.003}
                    rx={0.003}
                    style={{ pointerEvents: tool === 'select' ? 'all' : 'none', cursor: tool === 'select' ? 'move' : 'crosshair' }}
                    onPointerDown={(e) => handleMaskPointerDown(e as unknown as React.PointerEvent, mask.id)}
                  />
                  {/* Resize handles for selected mask */}
                  {selectedId === mask.id && tool === 'select' && resizeHandles.map(handle => {
                    const hx = handle.includes('w') ? mask.x : mask.x + mask.width;
                    const hy = handle.includes('n') ? mask.y : mask.y + mask.height;
                    return (
                      <rect
                        key={handle}
                        x={hx - 0.008}
                        y={hy - 0.008}
                        width={0.016}
                        height={0.016}
                        fill="#fff"
                        stroke="#1976D2"
                        strokeWidth={0.002}
                        style={{ pointerEvents: 'all', cursor: `${handle}-resize` }}
                        onPointerDown={(e) => handleResizePointerDown(e as unknown as React.PointerEvent, mask.id, handle)}
                      />
                    );
                  })}
                  {/* Zone number label */}
                  <text
                    x={mask.x + mask.width / 2}
                    y={mask.y + mask.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={Math.min(mask.width, mask.height) * 0.4}
                    fontWeight="bold"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {masks.indexOf(mask) + 1}
                  </text>
                </g>
              ))}

              {/* Drawing preview */}
              {drawState && (
                <rect
                  x={Math.min(drawState.startX, drawState.currentX)}
                  y={Math.min(drawState.startY, drawState.currentY)}
                  width={Math.abs(drawState.currentX - drawState.startX)}
                  height={Math.abs(drawState.currentY - drawState.startY)}
                  fill="rgba(33, 150, 243, 0.3)"
                  stroke="#2196F3"
                  strokeWidth={0.003}
                  strokeDasharray="0.01 0.005"
                />
              )}
            </svg>
          </div>
        )}
      </div>

      {imageDataUrl && masks.length === 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Usa la herramienta &quot;Dibujar&quot; para marcar zonas sobre la imagen
        </p>
      )}
    </div>
  );
}

// ─── Serialization helpers ──────────────────────────────────────────────────

export function serializeMasks(masks: IORect[]): string {
  return JSON.stringify(masks.map(({ id, ...rest }) => rest));
}

export function deserializeMasks(json: string): IORect[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: { x: number; y: number; width: number; height: number }, i: number) => ({
      id: `mask-loaded-${i}`,
      x: r.x ?? 0,
      y: r.y ?? 0,
      width: r.width ?? 0.1,
      height: r.height ?? 0.1,
    }));
  } catch {
    return [];
  }
}
