// Browser-side helper for calling /api/v1 with the session cookie.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      'x-recallforge-client': 'web',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `Error ${res.status}`);
  return data as T;
}

export function formatDue(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'ahora';
  const minutes = diff / 60000;
  if (minutes < 60) return `en ${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `en ${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 45) return `en ${Math.round(days)} d`;
  return new Date(iso).toLocaleDateString();
}
