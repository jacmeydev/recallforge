'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { UserSettings } from '@/lib/core/settings';

interface Account {
  email: string;
  name: string;
  apiKeyPreview: string | null;
  apiKeyLastRotatedAt: string | null;
}

export function AccountView({ origin }: { origin: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<{ account: Account }>('/api/v1/account'), api<{ settings: UserSettings }>('/api/v1/settings')])
      .then(([a, s]) => {
        setAccount(a.account);
        setSettings(s.settings);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function rotateKey() {
    if (account?.apiKeyPreview && !confirm('La clave actual dejará de funcionar en todos tus agentes. ¿Continuar?')) return;
    try {
      const result = await api<{ apiKey: string; apiKeyPreview: string; rotatedAt: string }>('/api/v1/account/api-key', {
        method: 'POST',
      });
      setApiKey(result.apiKey);
      setAccount((current) => current && { ...current, apiKeyPreview: result.apiKeyPreview, apiKeyLastRotatedAt: result.rotatedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

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

  const key = apiKey || 'rf_TU_CLAVE';
  const mcpUrl = `${origin}/api/mcp`;
  const snippets = [
    {
      title: 'Claude Code',
      code: `claude mcp add --transport http recallforge ${mcpUrl} --header "Authorization: Bearer ${key}"`,
    },
    {
      title: 'Cursor, VS Code, Windsurf y clientes con MCP remoto',
      code: JSON.stringify({ mcpServers: { recallforge: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
    {
      title: 'Claude Desktop y clientes solo-stdio (vía mcp-remote)',
      code: JSON.stringify(
        {
          mcpServers: {
            recallforge: {
              command: 'npx',
              args: ['-y', 'mcp-remote', mcpUrl, '--header', 'Authorization:${AUTH_HEADER}'],
              env: { AUTH_HEADER: `Bearer ${key}` },
            },
          },
        },
        null,
        2
      ),
    },
    {
      title: 'Conectores sin cabeceras (Claude.ai, ChatGPT): URL con la clave — solo sobre HTTPS',
      code: `${mcpUrl}?key=${key}`,
    },
    {
      title: 'REST (OpenClaw, n8n, scripts)',
      code: `curl -H "Authorization: Bearer ${key}" ${origin}/api/v1/study/next\n# Índice de endpoints: ${origin}/api/v1`,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cuenta y agentes</h1>
      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Clave de API</CardTitle>
          <CardDescription>
            Tus agentes usan esta clave para leer y repasar tus tarjetas. Trátala como una contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {apiKey ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-700">Cópiala ahora: no se volverá a mostrar.</p>
              <div className="flex gap-2">
                <code className="flex-1 break-all rounded-lg bg-muted p-3 text-xs">{apiKey}</code>
                <Button variant="outline" onClick={() => void navigator.clipboard.writeText(apiKey)}>
                  Copiar
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Clave actual: <code>{account?.apiKeyPreview ?? 'ninguna'}</code>
              {account?.apiKeyLastRotatedAt && ` · creada ${new Date(account.apiKeyLastRotatedAt).toLocaleDateString()}`}
            </p>
          )}
          <Button variant={apiKey ? 'outline' : 'default'} onClick={() => void rotateKey()}>
            {account?.apiKeyPreview ? 'Generar nueva clave' : 'Generar clave'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conecta tu agente</CardTitle>
          <CardDescription>
            RecallForge es un servidor MCP y una API REST. Conéctalo y pide, por ejemplo: «hazme tarjetas de este capítulo» o
            «pregúntame lo pendiente de Farmacología».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snippets.map((snippet) => (
            <div key={snippet.title} className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{snippet.title}</p>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void navigator.clipboard.writeText(snippet.code)}>
                  Copiar
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{snippet.code}</pre>
            </div>
          ))}
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
          <CardDescription>
            {account ? `${account.name} · ${account.email}. ` : ''}Descarga todos tus mazos, tarjetas e historial en JSON.
          </CardDescription>
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
