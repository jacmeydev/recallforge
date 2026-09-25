// ============================================================================
// RecallForge — Study-day arithmetic
// ============================================================================
// Daily limits and "today" statistics follow the learner's local study day,
// which starts at `dayStartHour` in their IANA timezone (Anki-style rollover,
// so a late-night session still counts for the previous day).
// ============================================================================

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function localParts(date: Date, timezone: string): LocalParts & { minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset of `timezone` from UTC at `date`, in milliseconds (positive east of UTC). */
export function timezoneOffsetMs(date: Date, timezone: string): number {
  const p = localParts(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const offset = timezoneOffsetMs(new Date(guess), timezone);
  const candidate = guess - offset;
  const corrected = timezoneOffsetMs(new Date(candidate), timezone);
  return new Date(corrected === offset ? candidate : guess - corrected);
}

function shiftDate(year: number, month: number, day: number, deltaDays: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export interface StudyDay {
  /** Local calendar date of the study day, YYYY-MM-DD. */
  date: string;
  start: Date;
  end: Date;
}

export function studyDay(now: Date, timezone: string, dayStartHour: number, offsetDays = 0): StudyDay {
  const p = localParts(now, timezone);
  let base = { year: p.year, month: p.month, day: p.day };
  if (p.hour < dayStartHour) base = shiftDate(base.year, base.month, base.day, -1);
  if (offsetDays) base = shiftDate(base.year, base.month, base.day, offsetDays);
  const next = shiftDate(base.year, base.month, base.day, 1);
  return {
    date: `${base.year}-${String(base.month).padStart(2, '0')}-${String(base.day).padStart(2, '0')}`,
    start: zonedTimeToUtc(base.year, base.month, base.day, dayStartHour, timezone),
    end: zonedTimeToUtc(next.year, next.month, next.day, dayStartHour, timezone),
  };
}

/**
 * SQLite modifier that maps a UTC timestamp to its study-day date via
 * `date(ts, modifier)`. Uses the current offset, so days that straddle a DST
 * change can be off by an hour at the boundary — fine for aggregate stats.
 */
export function studyDaySqlModifier(now: Date, timezone: string, dayStartHour: number): string {
  const minutes = Math.round(timezoneOffsetMs(now, timezone) / 60000) - dayStartHour * 60;
  return `${minutes >= 0 ? '+' : ''}${minutes} minutes`;
}

/** Compact human interval, e.g. "10m", "3h", "4d", "2.5mo", "1.2y". */
export function formatInterval(ms: number): string {
  const minutes = Math.max(0, ms) / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round((days / 30) * 10) / 10}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}
