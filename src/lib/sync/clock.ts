const CLOCK_OFFSET_KEY = 'recallforge:clockOffsetMs';
const CLOCK_OFFSET_MEASURED_AT_KEY = 'recallforge:clockOffsetMeasuredAt';

export interface ClockSyncSnapshot {
  clockOffsetMs: number | null;
  offsetMeasuredAt: string | null;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function captureServerClock(serverNow: string | null | undefined): ClockSyncSnapshot | null {
  if (!hasWindow() || typeof serverNow !== 'string' || serverNow.trim().length === 0) {
    return null;
  }

  const serverDate = new Date(serverNow);
  if (Number.isNaN(serverDate.getTime())) {
    return null;
  }

  const measuredAtDate = new Date();
  const clockOffsetMs = serverDate.getTime() - measuredAtDate.getTime();
  const offsetMeasuredAt = measuredAtDate.toISOString();

  window.localStorage.setItem(CLOCK_OFFSET_KEY, String(clockOffsetMs));
  window.localStorage.setItem(CLOCK_OFFSET_MEASURED_AT_KEY, offsetMeasuredAt);

  return { clockOffsetMs, offsetMeasuredAt };
}

export function getClockSyncSnapshot(): ClockSyncSnapshot {
  if (!hasWindow()) {
    return { clockOffsetMs: null, offsetMeasuredAt: null };
  }

  const rawOffset = window.localStorage.getItem(CLOCK_OFFSET_KEY);
  const rawMeasuredAt = window.localStorage.getItem(CLOCK_OFFSET_MEASURED_AT_KEY);
  const clockOffsetMs = rawOffset !== null ? Number.parseInt(rawOffset, 10) : Number.NaN;

  return {
    clockOffsetMs: Number.isFinite(clockOffsetMs) ? clockOffsetMs : null,
    offsetMeasuredAt: rawMeasuredAt && rawMeasuredAt.trim().length > 0 ? rawMeasuredAt : null,
  };
}

export function clearClockSyncSnapshot() {
  if (!hasWindow()) return;
  window.localStorage.removeItem(CLOCK_OFFSET_KEY);
  window.localStorage.removeItem(CLOCK_OFFSET_MEASURED_AT_KEY);
}
