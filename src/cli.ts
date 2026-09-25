// ============================================================================
// RecallForge — Command line
// ============================================================================
//   recallforge mcp            MCP server over stdio (what agents launch)
//   recallforge ui [--port N]  Local web app on http://127.0.0.1:3030
//   recallforge stats          Today's summary
//   recallforge export [file]  Full JSON backup (stdout by default)
//   recallforge path           Where the data lives
// ============================================================================

import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeDb, resolveDatabasePath } from '@/lib/core/db';
import { exportUserData } from '@/lib/core/export';
import { getStats } from '@/lib/core/stats';
import { getLocalUser } from '@/lib/core/users';
import { createMcpServer } from '@/lib/mcp/server';

const HELP = `RecallForge — memoria de repetición espaciada para tus agentes de IA

Uso:
  recallforge mcp             Servidor MCP por stdio (lo arranca tu agente)
  recallforge ui [--port N]   Abre la web local (por defecto http://127.0.0.1:3030)
  recallforge stats           Resumen de hoy
  recallforge export [archivo] Copia de seguridad completa en JSON
  recallforge path            Muestra dónde están tus datos

Ejemplo (Claude Code):
  claude mcp add recallforge -- node ${process.argv[1] ?? 'dist/cli.mjs'} mcp

Datos: ${resolveDatabasePath()}  (cámbialo con RECALLFORGE_DB)`;

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

async function runMcp(): Promise<void> {
  const server = createMcpServer(getLocalUser());
  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await server.close();
    closeDb();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function runUi(args: string[]): void {
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || '3030';
  const root = packageRoot();
  const built = fs.existsSync(path.join(root, '.next', 'BUILD_ID'));
  const nextBin = createRequire(path.join(root, 'package.json')).resolve('next/dist/bin/next');
  const nextArgs = built ? ['start', '-H', '127.0.0.1', '-p', port] : ['dev', '--webpack', '-H', '127.0.0.1', '-p', port];
  console.error(`RecallForge en http://127.0.0.1:${port}${built ? '' : ' (modo desarrollo: ejecuta "npm run build" para que arranque más rápido)'}`);
  const child = spawn(process.execPath, [nextBin, ...nextArgs], { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function printStats(): void {
  const stats = getStats(getLocalUser().id);
  const due = stats.due.learning + stats.due.review + stats.due.new;
  const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
  console.log(
    [
      `Pendientes hoy: ${due} (${stats.due.new} nuevas, ${stats.due.review} repasos, ${stats.due.learning} en aprendizaje)`,
      `Repasadas hoy: ${stats.today.reviews} · acierto ${pct(stats.today.accuracy)}`,
      `Retención 30 días: ${pct(stats.retention30d.rate)} · racha ${stats.streakDays} días`,
      `Tarjetas: ${stats.cards.total} · por revisar ${stats.cards.drafts}`,
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'mcp':
      return runMcp();
    case 'ui':
      return runUi(args);
    case 'stats':
      return printStats();
    case 'export': {
      const json = JSON.stringify(exportUserData(getLocalUser().id), null, 2);
      if (args[0]) {
        fs.writeFileSync(args[0], json);
        console.error(`Exportado a ${args[0]}`);
      } else {
        process.stdout.write(json + '\n');
      }
      return;
    }
    case 'path':
      console.log(resolveDatabasePath());
      return;
    default:
      console.log(HELP);
      if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
