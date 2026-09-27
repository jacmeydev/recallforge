// ============================================================================
// RecallForge — SQLite driver
// ============================================================================
// better-sqlite3 when it is installed (fastest, used by the web app and the
// npm package); otherwise Node's built-in node:sqlite (Node 22.5+), which needs
// no native module, so the one-click Claude Desktop extension works on every
// platform. Both expose the same small interface used across the app.
// Force one with RECALLFORGE_SQLITE=better-sqlite3 | node.
// ============================================================================

import { createRequire } from 'module';

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

export interface SqliteDatabase {
  prepare(sql: string): Statement;
  exec(sql: string): unknown;
  /** Wraps fn in a transaction (nested calls use savepoints). Call the returned function to run it. */
  transaction<F extends (...args: never[]) => unknown>(fn: F): F;
  pragma(statement: string): unknown;
  close(): unknown;
}

export type SqliteDriver = 'better-sqlite3' | 'node';

const load = createRequire(import.meta.url);
let chosen: SqliteDriver | null = null;

export function sqliteDriver(): SqliteDriver {
  if (chosen) return chosen;
  const forced = process.env.RECALLFORGE_SQLITE;
  if (forced === 'node') return (chosen = 'node');
  try {
    load('better-sqlite3');
    chosen = 'better-sqlite3';
  } catch (error) {
    if (forced === 'better-sqlite3') throw error;
    chosen = 'node';
  }
  return chosen;
}

export function openSqlite(file: string, options: { readonly?: boolean } = {}): SqliteDatabase {
  if (sqliteDriver() === 'better-sqlite3') {
    const Database = load('better-sqlite3') as new (file: string, options?: { readonly?: boolean }) => SqliteDatabase;
    return new Database(file, { readonly: Boolean(options.readonly) });
  }
  return new NodeSqlite(file, Boolean(options.readonly));
}

// ---------------------------------------------------------------------------
// node:sqlite adapter
// ---------------------------------------------------------------------------

interface NodeStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  iterate(...params: unknown[]): IterableIterator<unknown>;
}
interface NodeDatabaseSync {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
  close(): void;
}

function loadNodeSqlite(): new (file: string, options?: { readOnly?: boolean }) => NodeDatabaseSync {
  // node:sqlite prints an ExperimentalWarning on first load; it is noise for users.
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite/i.test(text)) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return (load('node:sqlite') as { DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => NodeDatabaseSync }).DatabaseSync;
  } catch {
    throw new Error('RecallForge needs Node.js 22.5 or newer (or the better-sqlite3 package) to store your data.');
  } finally {
    process.emitWarning = emit;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array) && !(value instanceof Date);

/** better-sqlite3 accepts extra named parameters and returns Buffers; node:sqlite does neither. */
function bindable(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function toRow(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value;
  return out;
}

class NodeStatementAdapter implements Statement {
  private readonly names: Set<string>;

  constructor(
    private readonly statement: NodeStatement,
    sql: string
  ) {
    this.names = new Set([...sql.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  }

  private args(params: unknown[]): unknown[] {
    return params.map((param) => {
      if (!isPlainObject(param)) return bindable(param);
      const named: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(param)) if (this.names.has(key)) named[key] = bindable(value);
      return named;
    });
  }

  get(...params: unknown[]) {
    return toRow(this.statement.get(...this.args(params)));
  }

  all(...params: unknown[]) {
    return this.statement.all(...this.args(params)).map(toRow);
  }

  run(...params: unknown[]) {
    const result = this.statement.run(...this.args(params));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  *iterate(...params: unknown[]) {
    for (const row of this.statement.iterate(...this.args(params))) yield toRow(row);
  }
}

class NodeSqlite implements SqliteDatabase {
  private readonly db: NodeDatabaseSync;
  private depth = 0;
  private readonly cache = new Map<string, NodeStatementAdapter>();

  constructor(file: string, readonly: boolean) {
    const DatabaseSync = loadNodeSqlite();
    this.db = new DatabaseSync(file, readonly ? { readOnly: true } : {});
  }

  prepare(sql: string): Statement {
    let statement = this.cache.get(sql);
    if (!statement) {
      statement = new NodeStatementAdapter(this.db.prepare(sql), sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, statement);
    }
    return statement;
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  pragma(statement: string) {
    return this.db.prepare(`PRAGMA ${statement}`).all();
  }

  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    return ((...args: never[]) => {
      const savepoint = `rf_sp_${this.depth}`;
      this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        this.depth--;
        this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      }
    }) as F;
  }

  close() {
    this.cache.clear();
    this.db.close();
  }
}
