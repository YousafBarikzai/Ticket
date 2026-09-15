import { loadConfig } from './config.js';
import { currentContext } from './context.js';

/**
 * Structured logging, metrics and tracing hooks.
 *
 * Every line carries the tenant and correlation identifiers so one request can
 * be followed from the edge through a queue to an external call (ADR-0007).
 * Classified fields and anything that looks like a secret are redacted here,
 * because a log is the easiest place to leak by accident.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const REDACTED = '[redacted]';
const SECRET_KEYS = /^(password|secret|token|authorization|api[_-]?key|cookie|set-cookie|refresh_token|access_token|client_secret|hash)$/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;

/**
 * Field NAMES contributed by the classification registry. Matching is by name
 * rather than by entity path, deliberately: a log line is an arbitrary shape,
 * not an entity, so once a field name is classified anywhere it is redacted
 * everywhere it appears. Over-redacting a log is cheap; under-redacting is a
 * disclosure.
 */
const classifiedFields = new Set<string>();

export function registerClassifiedField(fieldName: string): void {
  classifiedFields.add(fieldName.toLowerCase());
}

/** Test helper: forget classified field names. */
export function clearClassifiedFields(): void {
  classifiedFields.clear();
}

export function redact(value: unknown, path = '', depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return value.replace(JWT_PATTERN, REDACTED);
  if (Array.isArray(value)) return value.slice(0, 50).map((v, i) => redact(v, `${path}[${i}]`, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      out[key] = SECRET_KEYS.test(key) || classifiedFields.has(key.toLowerCase()) ? REDACTED : redact(v, childPath, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown>, bound: Record<string, unknown>): void {
  const configured = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
  if (LEVELS[level] < LEVELS[configured]) return;
  if (process.env.LOG_SILENT === '1') return;

  const ctx = currentContext();
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(ctx ? { tenantId: ctx.tenantId, correlationId: ctx.correlationId, actorType: ctx.actor.type } : {}),
    ...bound,
    ...(redact(fields) as Record<string, unknown>),
  };
  const stream = LEVELS[level] >= LEVELS.error ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

function makeLogger(bound: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, f = {}) => write('debug', m, f, bound),
    info: (m, f = {}) => write('info', m, f, bound),
    warn: (m, f = {}) => write('warn', m, f, bound),
    error: (m, f = {}) => write('error', m, f, bound),
    child: (fields) => makeLogger({ ...bound, ...(redact(fields) as Record<string, unknown>) }),
  };
}

export const logger: Logger = makeLogger();

/** A minimal metrics registry: counters, gauges and histogram summaries. */
class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  private key(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    return parts.length ? `${name}{${parts.join(',')}}` : name;
  }

  increment(name: string, labels?: Record<string, string>, by = 1): void {
    const k = this.key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.gauges.set(this.key(name, labels), value);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    const k = this.key(name, labels);
    const series = this.histograms.get(k) ?? [];
    series.push(value);
    // Bounded: the exporter reads and resets, this is only a safety valve.
    if (series.length > 10_000) series.shift();
    this.histograms.set(k, series);
  }

  /** Times an async operation and records its duration and outcome. */
  async time<T>(name: string, labels: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      this.observe(name, performance.now() - started, { ...labels, outcome: 'ok' });
      return result;
    } catch (error) {
      this.observe(name, performance.now() - started, { ...labels, outcome: 'error' });
      throw error;
    }
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number>; histograms: Record<string, { count: number; p50: number; p95: number; max: number }> } {
    const histograms: Record<string, { count: number; p50: number; p95: number; max: number }> = {};
    for (const [k, values] of this.histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      histograms[k] = { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    };
  }

  /** Prometheus text exposition, served at /metrics. */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, summary] of Object.entries(this.snapshot().histograms)) {
      const [name, labels] = k.includes('{') ? [k.slice(0, k.indexOf('{')), k.slice(k.indexOf('{'))] : [k, ''];
      const withQuantile = (q: string): string =>
        labels ? `${name}{${labels.slice(1, -1)},quantile="${q}"}` : `${name}{quantile="${q}"}`;
      lines.push(`${withQuantile('0.5')} ${summary.p50.toFixed(3)}`);
      lines.push(`${withQuantile('0.95')} ${summary.p95.toFixed(3)}`);
      lines.push(`${name}_count${labels} ${summary.count}`);
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export const metrics = new Metrics();

/**
 * Starts OpenTelemetry when an endpoint is configured. The SDK is imported
 * dynamically so that neither tests nor local development pay for it.
 */
export async function initTelemetry(serviceName?: string): Promise<void> {
  const config = loadConfig();
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) {
    logger.debug('telemetry exporter not configured; traces stay local');
    return;
  }
  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { PgInstrumentation }, { IORedisInstrumentation }] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/instrumentation-http'),
        import('@opentelemetry/instrumentation-pg'),
        import('@opentelemetry/instrumentation-ioredis'),
      ]);
    const sdk = new NodeSDK({
      serviceName: serviceName ?? config.OTEL_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter({ url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
      instrumentations: [new HttpInstrumentation(), new PgInstrumentation(), new IORedisInstrumentation()],
    });
    sdk.start();
    logger.info('telemetry started', { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT });
  } catch (error) {
    logger.warn('telemetry could not start; continuing without it', { error: (error as Error).message });
  }
}
