// ============================================================================
// RecallForge — Command line
// ============================================================================
//   recallforge mcp            MCP server over stdio (what agents launch)
//   recallforge ui [--port N]  Local web app on http://127.0.0.1:3030
//   recallforge stats          Today's summary
//   recallforge export [file]  Full JSON backup (stdout by default)
//   recallforge backup [dir]   Copy of the database file (safe while in use)
//   recallforge import <file>  Restore a JSON export or import CSV/TSV cards
//   recallforge path           Where the data lives
// ============================================================================

import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeDb, getDb, resolveDatabasePath } from '@/lib/core/db';
import { exportCardsTsv, exportUserData } from '@/lib/core/export';
import { exportApkg, importApkg } from '@/lib/core/anki';
import { importData } from '@/lib/core/import';
import { optimizeScheduler } from '@/lib/core/optimizer';
import { getStats } from '@/lib/core/stats';
import { getLocalUser } from '@/lib/core/users';
import { createMcpServer } from '@/lib/mcp/server';

const HELP = `RecallForge — memoria de repetición espaciada para tus agentes de IA

Uso:
  recallforge mcp             Servidor MCP por stdio (lo arranca tu agente)
  recallforge ui [--port N]   Abre la web local (por defecto http://127.0.0.1:3030)
  recallforge stats           Resumen de hoy
  recallforge export [archivo] Copia completa en JSON (.apkg → para Anki/AnkiDroid/AnkiMobile, .tsv → hojas de cálculo)
  recallforge backup [carpeta] Copia de la base de datos (por defecto ~/.recallforge/backups)
  recallforge import <archivo> [--deck Materia] [--draft]
                               Importa un mazo de Anki (.apkg), una copia JSON o tarjetas CSV/TSV
  recallforge optimize        Ajusta FSRS a tu propio historial de repasos
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
      `Pendientes hoy: ${due} (~${stats.workload.minutesToday} min · ${stats.due.new} nuevas, ${stats.due.review} repasos, ${stats.due.learning} en aprendizaje)`,
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
      if (args[0]?.toLowerCase().endsWith('.apkg')) {
        const deckIndex = args.indexOf('--deck');
        fs.writeFileSync(args[0], await exportApkg(getLocalUser().id, { deck: deckIndex >= 0 ? args[deckIndex + 1] : undefined }));
        console.error(`Exportado a ${args[0]} (ábrelo con Anki, AnkiDroid o AnkiMobile)`);
        return;
      }
      const tsv = args[0]?.toLowerCase().endsWith('.tsv') || args[0]?.toLowerCase().endsWith('.txt');
      const json = tsv ? exportCardsTsv(getLocalUser().id) : JSON.stringify(exportUserData(getLocalUser().id), null, 2);
      if (args[0]) {
        fs.writeFileSync(args[0], json);
        console.error(`Exportado a ${args[0]}`);
      } else {
        process.stdout.write(json + '\n');
      }
      return;
    }
    case 'backup': {
      const dir = args[0] ?? path.join(path.dirname(resolveDatabasePath()), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(dir, `recallforge-${stamp}.db`);
      await getDb().backup(file);
      console.error(`Copia guardada en ${file}`);
      return;
    }
    case 'import': {
      if (!args[0]) throw new Error('Uso: recallforge import <archivo> [--deck Materia] [--draft]');
      const deckIndex = args.indexOf('--deck');
      if (/\.(apkg|colpkg)$/i.test(args[0])) {
        const started = Date.now();
        const result = await importApkg(getLocalUser().id, args[0], { deck: deckIndex >= 0 ? args[deckIndex + 1] : undefined, draft: args.includes('--draft') });
        console.log(
          `Importado de Anki: ${result.cards} tarjetas, ${result.reviews} repasos del historial, ${result.decks} materias nuevas` +
            (result.skipped ? ` · ${result.skipped} ya estaban` : '') +
            ` (${((Date.now() - started) / 1000).toFixed(1)} s)`
        );
        for (const warning of result.warnings) {
          console.error(`  · ${/personalise the scheduler/.test(warning) ? 'Tu historial alcanza para ajustar el algoritmo a tu memoria: ejecuta "recallforge optimize".' : warning}`);
        }
        return;
      }
      const result = importData(getLocalUser().id, fs.readFileSync(args[0], 'utf8'), {
        deck: deckIndex >= 0 ? args[deckIndex + 1] : undefined,
        draft: args.includes('--draft'),
      });
      console.log(
        `Importado: ${result.cards} tarjetas, ${result.decks} materias nuevas, ${result.documents} documentos, ${result.reviews} repasos` +
          (result.skipped ? ` · ${result.skipped} omitidos (ya existían o duplicados)` : '')
      );
      for (const warning of result.warnings.slice(0, 10)) console.error(`  · ${warning}`);
      return;
    }
    case 'optimize': {
      const result = await optimizeScheduler(getLocalUser().id);
      const gain = Math.round(((result.before.logLoss - result.after.logLoss) / result.before.logLoss) * 100);
      console.log(
        result.applied
          ? `Algoritmo ajustado a tu memoria con ${result.reviews} repasos: predice un ${gain}% mejor cuándo vas a olvidar.`
          : 'Tus parámetros actuales ya predicen tu memoria igual de bien; no se cambió nada.'
      );
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
