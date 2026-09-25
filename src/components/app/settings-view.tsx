'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { UserSettings } from '@/lib/core/settings';

export interface ConnectionInfo {
  /** Absolute path of the stdio MCP entry point (dist/cli.mjs). */
  cliPath: string;
  origin: string;
  databasePath: string;
  tokenRequired: boolean;
}

export function SettingsView({ connection }: { connection: ConnectionInfo }) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ settings: UserSettings }>('/api/v1/settings')
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(err.message));
  }, []);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const steps = (name: string) =>
      String(form.get(name) ?? '')
        .split(',')
        .map((step) => step.trim())
        .filter(Boolean);
    try {
      const result = await api<{ settings: UserSettings }>('/api/v1/settings', {
        method: 'PATCH',
        body: {
          desiredRetention: Number(form.get('desiredRetention')),
          newCardsPerDay: Number(form.get('newCardsPerDay')),
          maxReviewsPerDay: Number(form.get('maxReviewsPerDay')),
          dayStartHour: Number(form.get('dayStartHour')),
          timezone: String(form.get('timezone')),
          learningSteps: steps('learningSteps'),
          relearningSteps: steps('relearningSteps'),
        },
      });
      setSettings(result.settings);
      setError('');
      setNotice('Ajustes guardados');
    } catch (err) {
      setNotice('');
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  const { cliPath, origin, tokenRequired } = connection;
  const token = tokenRequired ? 'TU_TOKEN' : '';
  const httpHeaders = tokenRequired ? { Authorization: `Bearer ${token}` } : undefined;
  const snippets = [
    {
      title: 'Claude Code',
      code: `claude mcp add recallforge -- node "${cliPath}" mcp`,
    },
    {
      title: 'Claude Desktop, Cursor, VS Code, Windsurf, Codex y otros clientes MCP (archivo de configuración)',
      code: JSON.stringify({ mcpServers: { recallforge: { command: 'node', args: [cliPath, 'mcp'] } } }, null, 2),
    },
    {
      title: 'Agentes que se conectan por HTTP (mientras esta web esté abierta)',
      code: JSON.stringify(
        { mcpServers: { recallforge: { url: `${origin}/api/mcp`, ...(httpHeaders ? { headers: httpHeaders } : {}) } } },
        null,
        2
      ),
    },
    {
      title: 'REST (OpenClaw, n8n, scripts)',
      code: `curl ${tokenRequired ? `-H "Authorization: Bearer ${token}" ` : ''}${origin}/api/v1/study/next\n# Índice de endpoints: ${origin}/api/v1`,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Agentes y ajustes</h1>
      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Conecta tu agente</CardTitle>
          <CardDescription>
            RecallForge es un servidor MCP local: tu agente lo arranca solo, sin cuentas ni claves. Después pídele, por ejemplo,
            «hazme tarjetas de este PDF» o «pregúntame lo pendiente de Farmacología».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snippets.map((snippet) => (
            <div key={snippet.title} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{snippet.title}</p>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void navigator.clipboard.writeText(snippet.code)}
                >
                  Copiar
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{snippet.code}</pre>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Tus datos están en <code>{connection.databasePath}</code>. La web y los agentes comparten ese archivo.
            {tokenRequired
              ? ' Este servidor exige el token RECALLFORGE_TOKEN.'
              : ' Para usarlo desde un agente en la nube, expón el servidor con un túnel y define RECALLFORGE_TOKEN (ver README).'}
          </p>
        </CardContent>
      </Card>

      {settings && (
        <Card>
          <CardHeader>
            <CardTitle>Ajustes de estudio</CardTitle>
            <CardDescription>FSRS programa cada tarjeta para que la recuerdes con la retención objetivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSettings} className="grid gap-4 sm:grid-cols-2">
              <Field label="Retención objetivo (0.70–0.99)">
                <Input name="desiredRetention" type="number" step="0.01" min="0.7" max="0.99" defaultValue={settings.desiredRetention} />
              </Field>
              <Field label="Tarjetas nuevas por día">
                <Input name="newCardsPerDay" type="number" min="0" defaultValue={settings.newCardsPerDay} />
              </Field>
              <Field label="Máximo de repasos por día">
                <Input name="maxReviewsPerDay" type="number" min="0" defaultValue={settings.maxReviewsPerDay} />
              </Field>
              <Field label="Zona horaria">
                <Input name="timezone" defaultValue={settings.timezone} list="timezones" />
                <datalist id="timezones">
                  {typeof Intl.supportedValuesOf === 'function' &&
                    Intl.supportedValuesOf('timeZone').map((tz) => <option key={tz} value={tz} />)}
                </datalist>
              </Field>
              <Field label="Hora de inicio del día de estudio">
                <Input name="dayStartHour" type="number" min="0" max="23" defaultValue={settings.dayStartHour} />
              </Field>
              <Field label="Pasos de aprendizaje (p. ej. 1m, 10m)">
                <Input name="learningSteps" defaultValue={settings.learningSteps.join(', ')} />
              </Field>
              <Field label="Pasos tras un olvido (p. ej. 10m)">
                <Input name="relearningSteps" defaultValue={settings.relearningSteps.join(', ')} />
              </Field>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button type="submit">Guardar ajustes</Button>
                {notice && <span className="text-sm text-emerald-700">{notice}</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataCard databasePath={connection.databasePath} />
    </div>
  );
}

function DataCard({ databasePath }: { databasePath: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  async function importFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return setError('Elige un archivo');
    setBusy(true);
    setError('');
    setResult('');
    try {
      const res = await fetch('/api/v1/import', { method: 'POST', body: form, headers: { 'x-recallforge-client': 'web' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
      setResult(
        `Importado: ${data.cards} tarjetas, ${data.decks} materias nuevas, ${data.documents} documentos, ${data.reviews} repasos` +
          (data.skipped ? ` · ${data.skipped} omitidos (ya existían o duplicados)` : '')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus datos</CardTitle>
        <CardDescription>
          Todo vive en un archivo de tu ordenador y funciona sin internet: <code className="break-all text-xs">{databasePath}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <div className="font-medium">Exportar</div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/export">Copia completa (JSON)</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/export?format=tsv">Tarjetas para Anki / Excel (TSV)</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            El JSON incluye materias, fechas de examen, documentos, tarjetas con su estado de memoria, todos los repasos y el historial de
            cambios. Copia de la base de datos: <code>recallforge backup</code>.
          </p>
        </div>
        <form className="space-y-2" onSubmit={(e) => void importFile(e)}>
          <div className="font-medium">Importar</div>
          <p className="text-xs text-muted-foreground">
            Una copia JSON de RecallForge (se fusiona sin duplicar) o un CSV/TSV con pregunta y respuesta (exportación “Notas en texto
            plano” de Anki, hojas de cálculo).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input name="file" type="file" accept=".json,.csv,.tsv,.txt" className="max-w-full text-xs" />
            <Input name="deck" placeholder="Materia para CSV/TSV (opcional)" className="h-8 max-w-xs text-xs" />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="draft" value="true" /> como borradores
            </label>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Importando…' : 'Importar'}
            </Button>
          </div>
          {result && <p className="text-xs text-emerald-700 dark:text-emerald-400">{result}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
