export interface RouteObservationInput {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  requestId?: string;
  userId?: string;
  deviceId?: string | null;
  operationId?: string | null;
  errorMessage?: string;
}

interface RouteBucket {
  route: string;
  requests: number;
  errors: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastStatus: number;
  lastSeenAt: string;
  methods: Record<string, number>;
  statuses: Record<string, number>;
}

interface NamedMetricBucket {
  name: string;
  count: number;
  sum: number;
  lastValue: number;
  lastSeenAt: string;
  lastData?: Record<string, unknown>;
}

interface ObservabilityError {
  ts: string;
  route: string;
  status: number;
  requestId?: string;
  userId?: string;
  deviceId?: string | null;
  operationId?: string | null;
  message?: string;
}

const routeBuckets = new Map<string, RouteBucket>();
const namedMetrics = new Map<string, NamedMetricBucket>();
const recentErrors: ObservabilityError[] = [];
const MAX_RECENT_ERRORS = 25;

function nowIso(): string {
  return new Date().toISOString();
}

function getOrCreateRouteBucket(route: string): RouteBucket {
  const existing = routeBuckets.get(route);
  if (existing) return existing;

  const created: RouteBucket = {
    route,
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastStatus: 0,
    lastSeenAt: nowIso(),
    methods: {},
    statuses: {},
  };
  routeBuckets.set(route, created);
  return created;
}

export function recordRouteObservation(input: RouteObservationInput) {
  const bucket = getOrCreateRouteBucket(input.route);
  bucket.requests += 1;
  bucket.totalDurationMs += input.durationMs;
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, input.durationMs);
  bucket.lastStatus = input.status;
  bucket.lastSeenAt = nowIso();
  bucket.methods[input.method] = (bucket.methods[input.method] || 0) + 1;
  bucket.statuses[String(input.status)] = (bucket.statuses[String(input.status)] || 0) + 1;

  if (input.status >= 400) {
    bucket.errors += 1;
    recentErrors.unshift({
      ts: bucket.lastSeenAt,
      route: input.route,
      status: input.status,
      requestId: input.requestId,
      userId: input.userId,
      deviceId: input.deviceId,
      operationId: input.operationId,
      message: input.errorMessage,
    });
    if (recentErrors.length > MAX_RECENT_ERRORS) {
      recentErrors.length = MAX_RECENT_ERRORS;
    }
  }
}

export function recordNamedMetric(
  name: string,
  value: number,
  data?: Record<string, unknown>
) {
  const existing = namedMetrics.get(name);
  const ts = nowIso();
  if (existing) {
    existing.count += 1;
    existing.sum += value;
    existing.lastValue = value;
    existing.lastSeenAt = ts;
    existing.lastData = data;
    return;
  }

  namedMetrics.set(name, {
    name,
    count: 1,
    sum: value,
    lastValue: value,
    lastSeenAt: ts,
    lastData: data,
  });
}

export function getObservabilitySnapshot() {
  const routes = [...routeBuckets.values()]
    .map((bucket) => ({
      route: bucket.route,
      requests: bucket.requests,
      errors: bucket.errors,
      errorRate: bucket.requests > 0 ? Math.round((bucket.errors / bucket.requests) * 1000) / 1000 : 0,
      avgDurationMs: bucket.requests > 0 ? Math.round(bucket.totalDurationMs / bucket.requests) : 0,
      maxDurationMs: bucket.maxDurationMs,
      lastStatus: bucket.lastStatus,
      lastSeenAt: bucket.lastSeenAt,
      methods: bucket.methods,
      statuses: bucket.statuses,
    }))
    .sort((left, right) => right.requests - left.requests);

  const totalRequests = routes.reduce((sum, route) => sum + route.requests, 0);
  const totalErrors = routes.reduce((sum, route) => sum + route.errors, 0);

  return {
    totals: {
      routesTracked: routes.length,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 1000) / 1000 : 0,
    },
    routes: routes.slice(0, 20),
    namedMetrics: [...namedMetrics.values()]
      .map((metric) => ({
        name: metric.name,
        count: metric.count,
        avgValue: metric.count > 0 ? Math.round((metric.sum / metric.count) * 1000) / 1000 : 0,
        lastValue: metric.lastValue,
        lastSeenAt: metric.lastSeenAt,
        lastData: metric.lastData,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 20),
    recentErrors,
  };
}

export function resetObservability() {
  routeBuckets.clear();
  namedMetrics.clear();
  recentErrors.length = 0;
}
