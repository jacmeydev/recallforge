'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Download,
  Play,
  Eye,
  Loader2,
  Clipboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { parseImportFile, detectFormat } from '@/lib/utils/file-parse';
import { AIImportOptionsSchema, validateImportItem } from '@/lib/validation/ai-import-schema';
import { importAIBatch } from '@/lib/services/ai-import-service';
import type { AIImportItem, AIImportOptions, AIDuplicateStrategy } from '@/lib/validation/ai-import-schema';
import type { AIImportSummary } from '@/types';

// ─── Steps ─────────────────────────────────────────────────────────────────

type WizardStep = 'upload' | 'preview' | 'options' | 'running' | 'done';

const STEP_LABELS: Record<WizardStep, string> = {
  upload: '1. Cargar archivo',
  preview: '2. Vista previa',
  options: '3. Opciones',
  running: '4. Importando…',
  done: '5. Resultado',
};

// ─── Templates ─────────────────────────────────────────────────────────────

const TEMPLATE_JSON = JSON.stringify(
  {
    version: 'recallforge-ai-import-v1',
    items: [
      {
        noteType: 'Básica',
        deck: 'Mi Mazo',
        fields: { Front: 'Pregunta', Back: 'Respuesta' },
        tags: ['ejemplo'],
      },
    ],
  },
  null,
  2
);

const TEMPLATE_JSONL = [
  '{"noteType":"Básica","deck":"Mi Mazo","fields":{"Front":"Pregunta 1","Back":"Respuesta 1"},"tags":["ejemplo"]}',
  '{"noteType":"Básica","deck":"Mi Mazo","fields":{"Front":"Pregunta 2","Back":"Respuesta 2"},"tags":["ejemplo"]}',
].join('\n');

const TEMPLATE_CSV =
  'noteType,deck,field_Front,field_Back,tags\nBásica,Mi Mazo,Pregunta,Respuesta,ejemplo';

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AIImportPage() {
  const { user } = useAppStore();

  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [items, setItems] = useState<AIImportItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [options, setOptions] = useState<AIImportOptions>(
    AIImportOptionsSchema.parse({})
  );
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<AIImportSummary | null>(null);
  const [manualContent, setManualContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseContent = useCallback((content: string, sourceName: string) => {
    setFileName(sourceName);
    setParseErrors([]);
    setValidationErrors([]);

    try {
      setRawContent(content);

      const format = detectFormat(content);
      const parsed = parseImportFile(content, format);
      setItems(parsed);

      // Validate each item
      const valErrors: string[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const { errors } = validateImportItem(parsed[i], i);
        valErrors.push(...errors);
      }
      setValidationErrors(valErrors);
      setStep('preview');
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : 'Error al analizar el archivo']);
      setItems([]);
    }
  }, []);

  // ─── File upload handler ─────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      parseContent(content, file.name);
    } catch (err) {
      setFileName(file.name);
      setParseErrors([err instanceof Error ? err.message : 'Error al leer el archivo']);
      setItems([]);
    }
  }, [parseContent]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleClipboardImport = useCallback(async () => {
    setParseErrors([]);

    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setParseErrors([
        'Este navegador no permite leer el portapapeles directamente. Pega el contenido en el cuadro inferior.',
      ]);
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setParseErrors(['El portapapeles está vacío o no contiene texto importable.']);
        return;
      }

      setManualContent(text);
      parseContent(text, 'Portapapeles');
    } catch (err) {
      setParseErrors([
        err instanceof Error
          ? `No se pudo leer el portapapeles: ${err.message}`
          : 'No se pudo leer el portapapeles. Pega el contenido manualmente.',
      ]);
    }
  }, [parseContent]);

  const handleManualImport = useCallback(() => {
    if (!manualContent.trim()) {
      setParseErrors(['Pega contenido en el cuadro antes de analizarlo.']);
      return;
    }
    parseContent(manualContent, 'Texto pegado');
  }, [manualContent, parseContent]);

  // ─── Run import ─────────────────────────────────────────────────────

  const runImport = useCallback(
    async (dryRun: boolean) => {
      if (!user) return;

      const opts = { ...options, dryRun };
      setProgress({ current: 0, total: items.length });
      setStep('running');

      try {
        const result = await importAIBatch(user.id, items, opts, (current, total) =>
          setProgress({ current, total })
        );
        setSummary(result);
        setStep('done');
      } catch (err) {
        setSummary({
          totalItems: items.length,
          created: 0,
          updated: 0,
          skipped: 0,
          failed: items.length,
          errors: [{ index: -1, message: err instanceof Error ? err.message : 'Error desconocido' }],
          durationMs: 0,
          dryRun,
        });
        setStep('done');
      }
    },
    [user, items, options]
  );

  // ─── Reset ──────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setRawContent('');
    setManualContent('');
    setItems([]);
    setParseErrors([]);
    setValidationErrors([]);
    setSummary(null);
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ─── Download template ──────────────────────────────────────────────

  const downloadTemplate = useCallback((format: 'json' | 'jsonl' | 'csv') => {
    const content = format === 'json' ? TEMPLATE_JSON : format === 'jsonl' ? TEMPLATE_JSONL : TEMPLATE_CSV;
    const ext = format === 'json' ? 'json' : format === 'jsonl' ? 'jsonl' : 'csv';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recallforge-import-template.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ─── Distinct values for preview ────────────────────────────────────

  const previewStats = useMemo(() => {
    const decks = new Set(items.map(i => i.deck));
    const noteTypes = new Set(items.map(i => i.noteType));
    const tags = new Set(items.flatMap(i => i.tags || []));
    const withSubject = items.filter(i => i.subject).length;
    const withPriority = items.filter(i => i.priority).length;
    return { totalItems: items.length, decks: decks.size, noteTypes: noteTypes.size, tags: tags.size, withSubject, withPriority };
  }, [items]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Importación IA por Lote</h1>
        <p className="text-muted-foreground">
          Importa tarjetas generadas por ChatGPT, OpenClaw, scripts o hojas de cálculo
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(Object.keys(STEP_LABELS) as WizardStep[]).map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            <span
              className={cn(
                'rounded-full px-3 py-1',
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {STEP_LABELS[s]}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* ─── Step: Upload ─────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" /> Cargar archivo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <FileText className="h-12 w-12 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    Arrastra un archivo aquí o haz clic para seleccionar
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Formatos: JSON, JSONL, CSV, TSV
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.jsonl,.csv,.tsv,.txt"
                  className="hidden"
                  onChange={handleInputChange}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Seleccionar archivo
                </Button>
              </div>

              <div className="mt-6 space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Pegar desde el portapapeles</p>
                    <p className="text-sm text-muted-foreground">
                      Ideal para JSON/JSONL/CSV generado por OpenClaw, ChatGPT o una hoja de cálculo.
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleClipboardImport}>
                    <Clipboard className="mr-2 h-4 w-4" />
                    Pegar del portapapeles
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manualImportContent">O pega el contenido manualmente</Label>
                  <Textarea
                    id="manualImportContent"
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    placeholder={`Pega aquí contenido en JSON, JSONL, CSV o TSV.\n\nEjemplo:\n{"noteType":"Básica","deck":"Mi Mazo","fields":{"Front":"Pregunta","Back":"Respuesta"}}`}
                    className="min-h-40 font-mono text-xs"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Si tu navegador bloquea el acceso al portapapeles, pega aquí con Ctrl/Cmd+V y luego analiza.
                    </p>
                    <Button onClick={handleManualImport} disabled={!manualContent.trim()}>
                      Analizar texto pegado
                    </Button>
                  </div>
                </div>
              </div>

              {parseErrors.length > 0 && (
                <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <XCircle className="h-4 w-4" /> Error al analizar
                  </div>
                  {parseErrors.map((e, i) => (
                    <p key={i} className="mt-1 text-sm text-destructive">{e}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Templates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" /> Plantillas de ejemplo
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={() => downloadTemplate('json')}>
                <Download className="mr-2 h-3 w-3" /> JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate('jsonl')}>
                <Download className="mr-2 h-3 w-3" /> JSONL
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate('csv')}>
                <Download className="mr-2 h-3 w-3" /> CSV
              </Button>
            </CardContent>
          </Card>

          {/* Documentation */}
          <Card>
            <CardHeader>
              <CardTitle>Documentación</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none">
              <h4>Formato JSON (recomendado)</h4>
              <pre className="text-xs overflow-x-auto bg-muted p-3 rounded-lg">{`{
  "version": "recallforge-ai-import-v1",
  "items": [
    {
      "noteType": "Básica",
      "deck": "Mi Mazo",
      "fields": { "Front": "Pregunta", "Back": "Respuesta" },
      "tags": ["etiqueta1"],
      "externalId": "opcional-id-único"
    }
  ]
}`}</pre>

              <h4>Formato CSV</h4>
              <p>Columnas requeridas: <code>noteType</code>, <code>deck</code>, y al menos una columna <code>field_*</code>.</p>
              <pre className="text-xs overflow-x-auto bg-muted p-3 rounded-lg">{`noteType,deck,field_Front,field_Back,tags
Básica,Mi Mazo,¿Capital de Francia?,París,geografía;europa`}</pre>

              <h4>Campos disponibles</h4>
              <ul>
                <li><strong>noteType</strong> — Nombre del tipo de nota (debe existir)</li>
                <li><strong>deck</strong> — Nombre del mazo (debe existir)</li>
                <li><strong>fields</strong> — Campos de la nota (según el tipo)</li>
                <li><strong>tags</strong> — Etiquetas (separadas por ; en CSV)</li>
                <li><strong>externalId</strong> — ID externo para detección de duplicados</li>
                <li><strong>duplicateKey</strong> — Clave personalizada para duplicados</li>
                <li><strong>source</strong> — Origen (ej: &quot;chatgpt&quot;, &quot;openclaw&quot;)</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Step: Preview ────────────────────────────────────────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" /> Vista previa — {fileName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{previewStats.totalItems}</div>
                  <div className="text-xs text-muted-foreground">Ítems</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{previewStats.decks}</div>
                  <div className="text-xs text-muted-foreground">Mazos</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{previewStats.noteTypes}</div>
                  <div className="text-xs text-muted-foreground">Tipos de nota</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{previewStats.tags}</div>
                  <div className="text-xs text-muted-foreground">Etiquetas únicas</div>
                </div>
              </div>
              {(previewStats.withSubject > 0 || previewStats.withPriority > 0) && (
                <div className="flex gap-3 text-xs text-muted-foreground">
                  {previewStats.withSubject > 0 && <span>{previewStats.withSubject} con materia</span>}
                  {previewStats.withPriority > 0 && <span>{previewStats.withPriority} con prioridad</span>}
                </div>
              )}

              {/* Validation warnings */}
              {validationErrors.length > 0 && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                  <div className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    {validationErrors.length} advertencia{validationErrors.length > 1 ? 's' : ''}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                    {validationErrors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {validationErrors.length > 10 && (
                      <li className="italic">
                        …y {validationErrors.length - 10} más
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Items table */}
              <div className="max-h-80 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Mazo</th>
                      <th className="px-3 py-2 text-left">Campos</th>
                      <th className="px-3 py-2 text-left">Académico</th>
                      <th className="px-3 py-2 text-left">Etiquetas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 100).map((item, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary">{item.noteType}</Badge>
                        </td>
                        <td className="px-3 py-2">{item.deck}</td>
                        <td className="px-3 py-2 max-w-xs truncate">
                          {Object.entries(item.fields)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' | ')
                            .slice(0, 80)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {item.subject && <Badge variant="outline" className="text-[10px]">{item.subject}</Badge>}
                            {item.chapter && <Badge variant="outline" className="text-[10px]">{item.chapter}</Badge>}
                            {item.priority && <Badge variant={item.priority === 'high' || item.priority === 'critical' ? 'destructive' : 'secondary'} className="text-[10px]">{item.priority}</Badge>}
                            {item.conceptualDifficulty && <Badge variant="secondary" className="text-[10px]">{item.conceptualDifficulty}</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {(item.tags || []).map(t => (
                            <Badge key={t} variant="outline" className="mr-1 text-xs">
                              {t}
                            </Badge>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length > 100 && (
                  <div className="p-2 text-center text-sm text-muted-foreground">
                    Mostrando 100 de {items.length} ítems
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('upload')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver
            </Button>
            <Button onClick={() => setStep('options')}>
              Continuar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step: Options ────────────────────────────────────────── */}
      {step === 'options' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Opciones de importación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Duplicate strategy */}
              <div className="space-y-2">
                <Label>Estrategia de duplicados</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { value: 'skip', label: 'Omitir duplicados', desc: 'No importar si ya existe' },
                      { value: 'update', label: 'Actualizar existentes', desc: 'Sobreescribir campos' },
                      { value: 'create_always', label: 'Crear siempre', desc: 'Crear aunque exista duplicado' },
                      { value: 'merge_tags', label: 'Fusionar etiquetas', desc: 'Actualizar y unir etiquetas' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        options.duplicateStrategy === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted'
                      )}
                      onClick={() =>
                        setOptions((o) => ({ ...o, duplicateStrategy: opt.value }))
                      }
                    >
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tag prefix */}
              <div className="space-y-2">
                <Label htmlFor="tagPrefix">
                  Etiqueta adicional (opcional)
                </Label>
                <input
                  id="tagPrefix"
                  type="text"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="ej: ai-import-2025"
                  value={options.tagPrefix || ''}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      tagPrefix: e.target.value || undefined,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Se añadirá a todas las notas importadas
                </p>
              </div>

              {/* Batch size */}
              <div className="space-y-2">
                <Label htmlFor="batchSize">
                  Tamaño de lote: {options.batchSize}
                </Label>
                <input
                  id="batchSize"
                  type="range"
                  min={1}
                  max={100}
                  value={options.batchSize}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      batchSize: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full"
                />
              </div>

              {/* Auto-create decks */}
              <div className="flex items-center gap-3">
                <input
                  id="autoCreateDecks"
                  type="checkbox"
                  checked={options.autoCreateDecks ?? false}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, autoCreateDecks: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="autoCreateDecks" className="cursor-pointer">
                  Crear mazos automáticamente si no existen
                </Label>
              </div>

              {/* Academic options */}
              <div className="border-t pt-4 space-y-4">
                <h3 className="font-medium text-sm">Opciones Académicas</h3>

                {/* Default priority */}
                <div className="space-y-2">
                  <Label>Prioridad predeterminada</Label>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { value: undefined, label: 'Ninguna' },
                      { value: 'low' as const, label: 'Baja' },
                      { value: 'medium' as const, label: 'Media' },
                      { value: 'high' as const, label: 'Alta' },
                      { value: 'critical' as const, label: 'Crítica' },
                    ]).map((opt) => (
                      <button
                        key={opt.label}
                        className={cn(
                          'rounded-md border px-3 py-1 text-xs transition-colors',
                          options.defaultPriority === opt.value
                            ? 'border-primary bg-primary/5 font-medium'
                            : 'hover:bg-muted'
                        )}
                        onClick={() => setOptions((o) => ({ ...o, defaultPriority: opt.value }))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Default difficulty */}
                <div className="space-y-2">
                  <Label>Dificultad conceptual predeterminada</Label>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { value: undefined, label: 'Ninguna' },
                      { value: 'easy' as const, label: 'Fácil' },
                      { value: 'medium' as const, label: 'Media' },
                      { value: 'hard' as const, label: 'Difícil' },
                      { value: 'very_hard' as const, label: 'Muy Difícil' },
                    ]).map((opt) => (
                      <button
                        key={opt.label}
                        className={cn(
                          'rounded-md border px-3 py-1 text-xs transition-colors',
                          options.defaultConceptualDifficulty === opt.value
                            ? 'border-primary bg-primary/5 font-medium'
                            : 'hover:bg-muted'
                        )}
                        onClick={() => setOptions((o) => ({ ...o, defaultConceptualDifficulty: opt.value }))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Default program */}
                <div className="space-y-2">
                  <Label htmlFor="defaultProgram">Programa predeterminado (opcional)</Label>
                  <input
                    id="defaultProgram"
                    type="text"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="ej: Medicina 2025"
                    value={options.defaultProgram || ''}
                    onChange={(e) => setOptions((o) => ({ ...o, defaultProgram: e.target.value || undefined }))}
                  />
                </div>

                {/* Auto-create curriculum */}
                <div className="flex items-center gap-2">
                  <input
                    id="autoCreateCurriculum"
                    type="checkbox"
                    checked={options.autoCreateCurriculum || false}
                    onChange={(e) => setOptions((o) => ({ ...o, autoCreateCurriculum: e.target.checked }))}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="autoCreateCurriculum" className="text-sm">
                    Crear nodos curriculares automáticamente
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground -mt-1 ml-6">
                  Crea programa/materia/capítulo/tema si no existen al importar
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('preview')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => runImport(true)}>
                <Eye className="mr-2 h-4 w-4" /> Simulación (dry run)
              </Button>
              <Button onClick={() => runImport(false)}>
                <Play className="mr-2 h-4 w-4" /> Importar {items.length} ítems
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Step: Running ────────────────────────────────────────── */}
      {step === 'running' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-lg font-medium">Importando…</div>
            <div className="text-sm text-muted-foreground">
              {progress.current} / {progress.total}
            </div>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{
                  width: progress.total > 0
                    ? `${(progress.current / progress.total) * 100}%`
                    : '0%',
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Step: Done ───────────────────────────────────────────── */}
      {step === 'done' && summary && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {summary.failed === summary.totalItems ? (
                  <XCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {summary.dryRun ? 'Resultado de la simulación' : 'Importación completada'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{summary.totalItems}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{summary.created}</div>
                  <div className="text-xs text-muted-foreground">Creados</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{summary.updated}</div>
                  <div className="text-xs text-muted-foreground">Actualizados</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-amber-600">{summary.skipped}</div>
                  <div className="text-xs text-muted-foreground">Omitidos</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-destructive">{summary.failed}</div>
                  <div className="text-xs text-muted-foreground">Fallidos</div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                Duración: {(summary.durationMs / 1000).toFixed(1)}s
              </div>

              {summary.errors.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="mb-2 font-medium text-destructive text-sm">
                    Errores ({summary.errors.length})
                  </div>
                  <ul className="space-y-1 text-sm">
                    {summary.errors.slice(0, 50).map((e, i) => (
                      <li key={i} className="text-destructive/80">
                        {e.message}
                      </li>
                    ))}
                    {summary.errors.length > 50 && (
                      <li className="italic text-muted-foreground">
                        …y {summary.errors.length - 50} más
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={reset}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Nueva importación
            </Button>
            {summary.dryRun && (
              <Button onClick={() => runImport(false)}>
                <Play className="mr-2 h-4 w-4" /> Importar de verdad
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
