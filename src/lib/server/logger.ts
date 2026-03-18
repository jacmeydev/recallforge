// ============================================================================
// RecallForge — Structured Logger
// ============================================================================
// JSON in production (machine-parseable), pretty in development.
// Levels: debug < info < warn < error
// ============================================================================

import { recordNamedMetric } from '@/lib/server/observability';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

function formatEntry(entry: LogEntry): string {
  if (isProd()) {
    return JSON.stringify(entry);
  }
  const { level, msg, ts, ...rest } = entry;
  const prefix = {
    debug: '🔍',
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
  }[level];
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${prefix} [${ts.split('T')[1]?.slice(0, 8) || ts}] ${msg}${extra}`;
}

function emit(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...data,
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
  metric: (name: string, value: number, data?: Record<string, unknown>) => {
    recordNamedMetric(name, value, data);
    emit('info', `metric:${name}`, { metricName: name, metricValue: value, ...data });
  },
  withContext(data: Record<string, unknown>) {
    return {
      debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, { ...data, ...extra }),
      info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, { ...data, ...extra }),
      warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, { ...data, ...extra }),
      error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, { ...data, ...extra }),
      metric: (name: string, value: number, extra?: Record<string, unknown>) => {
        recordNamedMetric(name, value, { ...data, ...extra });
        emit('info', `metric:${name}`, { metricName: name, metricValue: value, ...data, ...extra });
      },
    };
  },
};
