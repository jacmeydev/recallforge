import { randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';

interface ManagedNextServer {
  baseUrl: string;
  dbPath: string;
  distDir: string;
  port: number;
  stop: () => Promise<void>;
}

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp', 'http-integration');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const TS_CONFIG_PATH = path.join(ROOT, 'tsconfig.json');
const NEXT_ENV_PATH = path.join(ROOT, 'next-env.d.ts');
const START_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const MAX_LOG_LINES = 160;

type SpawnedNextProcess = ChildProcessByStdio<null, Readable, Readable>;

let activeServer: ManagedNextServer | null = null;

function makeDbPath() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return path.join(TEMP_DIR, `recallforge-http-${process.pid}-${randomUUID()}.db`);
}

function makeDistDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return path.join('.tmp', 'http-integration', 'next-test');
}

function readFileIfExists(targetPath: string) {
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
}

function restoreFile(targetPath: string, content: string | null) {
  if (content === null) {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
    return;
  }
  fs.writeFileSync(targetPath, content, 'utf8');
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('No se pudo reservar un puerto para el servidor HTTP de test')));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(port);
      });
    });
  });
}

function bufferProcessLogs(child: SpawnedNextProcess) {
  const lines: string[] = [];
  const push = (chunk: Buffer) => {
    const entries = chunk
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    lines.push(...entries);
    if (lines.length > MAX_LOG_LINES) {
      lines.splice(0, lines.length - MAX_LOG_LINES);
    }
  };

  child.stdout.on('data', push);
  child.stderr.on('data', push);
  return lines;
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(3_000),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerReady(
  baseUrl: string,
  child: SpawnedNextProcess,
  logs: string[]
) {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = logs.slice(-40).join('\n');
      throw new Error(`El servidor HTTP de test terminó antes de estar listo.\n${tail}`);
    }

    if (await isHealthy(baseUrl)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const tail = logs.slice(-40).join('\n');
  throw new Error(`Timeout esperando el servidor HTTP de test en ${baseUrl}.\n${tail}`);
}

async function warmRoute(baseUrl: string, route: string, init?: RequestInit) {
  try {
    await fetch(`${baseUrl}${route}`, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch {
    // Warming is best-effort only.
  }
}

async function stopChild(child: SpawnedNextProcess) {
  if (child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 10_000);

    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

export async function startManagedNextServer(): Promise<ManagedNextServer> {
  if (activeServer && await isHealthy(activeServer.baseUrl)) {
    return activeServer;
  }

  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = makeDbPath();
  const distDir = makeDistDir();
  const tsconfigBefore = readFileIfExists(TS_CONFIG_PATH);
  const nextEnvBefore = readFileIfExists(NEXT_ENV_PATH);

  const child = spawn(process.execPath, [
    NEXT_BIN,
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      NEXT_DIST_DIR: distDir,
      NEXTAUTH_URL: baseUrl,
      AUTH_URL: baseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET || 'recallforge-http-test-secret',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'recallforge-http-test-secret',
      AUTH_TRUST_HOST: 'true',
      TRUST_HOST: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
      RECALLFORGE_TEST_DB_FIXED: '1',
      LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = bufferProcessLogs(child);

  try {
    await waitForServerReady(baseUrl, child, logs);

    await Promise.all([
      warmRoute(baseUrl, '/api/health'),
      warmRoute(baseUrl, '/api/auth/csrf'),
      warmRoute(baseUrl, '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'warmup@recallforge.test' }),
      }),
      warmRoute(baseUrl, '/login'),
      warmRoute(baseUrl, '/settings'),
      warmRoute(baseUrl, '/copilot'),
      warmRoute(baseUrl, '/optimizer'),
      warmRoute(baseUrl, '/agent-console'),
    ]);
  } catch (error) {
    await stopChild(child);
    restoreFile(TS_CONFIG_PATH, tsconfigBefore);
    restoreFile(NEXT_ENV_PATH, nextEnvBefore);
    throw error;
  }

  activeServer = {
    baseUrl,
    dbPath,
    distDir,
    port,
    stop: async () => {
      await stopChild(child);
      activeServer = null;
      for (const suffix of ['', '-wal', '-shm']) {
        const target = `${dbPath}${suffix}`;
        if (fs.existsSync(target)) {
          fs.rmSync(target, { force: true });
        }
      }
      const distTarget = path.join(ROOT, distDir);
      if (fs.existsSync(distTarget)) {
        fs.rmSync(distTarget, { recursive: true, force: true });
      }
      restoreFile(TS_CONFIG_PATH, tsconfigBefore);
      restoreFile(NEXT_ENV_PATH, nextEnvBefore);
    },
  };

  return activeServer;
}
