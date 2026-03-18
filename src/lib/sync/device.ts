import { generateId } from '@/lib/utils';

const DEVICE_ID_KEY = 'recallforge:deviceId';
const DEVICE_SEQ_KEY = 'recallforge:deviceSeq';

export function getClientDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'server';
  }

  let current = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!current) {
    current = generateId();
    window.localStorage.setItem(DEVICE_ID_KEY, current);
  }
  return current;
}

export function nextDeviceSequence(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const current = Number.parseInt(window.localStorage.getItem(DEVICE_SEQ_KEY) || '0', 10) || 0;
  const next = current + 1;
  window.localStorage.setItem(DEVICE_SEQ_KEY, String(next));
  return next;
}
