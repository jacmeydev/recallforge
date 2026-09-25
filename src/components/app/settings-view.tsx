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

      <Card>
        <CardHeader>
          <CardTitle>Tus datos</CardTitle>
          <CardDescription>Descarga todas tus materias, tarjetas, documentos e historial en JSON.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/api/v1/export">Exportar JSON</a>
          </Button>
        </CardContent>
      </Card>
    </div>
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
