import { z } from 'zod';
import { DEMO_RESET_COOLDOWN_SECONDS } from '@itsm/contracts/demo';

/**
 * Runtime configuration, validated once at boot. The process refuses to start
 * on an invalid configuration rather than failing later under load
 * (docs/architecture/05 §13).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL_APP: z.string().url(),
  DATABASE_URL_PLATFORM: z.string().url().optional(),
  /**
   * Where dashboard and report queries run. A replica, or the primary through
   * the `app_readonly` role, or absent — in which case they share the
   * application pool, which is fine for development and wrong for production
   * (docs/architecture/06 §6).
   */
  DATABASE_URL_READONLY: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),

  API_PORT: z.coerce.number().int().default(3000),
  API_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3001'),

  /** Keycloak issuer; when unset the API accepts only development tokens. */
  OIDC_ISSUER: z.string().optional(),
  OIDC_AUDIENCE: z.string().default('itsm-api'),
  /** Development-only shared secret for locally signed tokens. */
  DEV_TOKEN_SECRET: z.string().default('dev-only-not-a-secret'),

  STORAGE_BUCKET: z.string().default('itsm-local'),
  STORAGE_REGION: z.string().default('eu-west'),
  STORAGE_ENDPOINT: z.string().optional(),

  EMAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Service Desk <servicedesk@example.test>'),

  /**
   * Meilisearch (ADR-0017). Unset means search is served from the PostgreSQL
   * projection, which is a supported way to run the platform rather than a
   * fallback: a small tenant does not need a search server.
   */
  MEILISEARCH_URL: z.string().url().optional(),
  MEILISEARCH_API_KEY: z.string().optional(),

  /**
   * The AI model provider (ADR-0040, ADR-0042). `stub` answers without a model
   * and is refused in production; `anthropic` needs a key. Unset means no
   * provider, and every capability that calls a model is refused loudly rather
   * than answered with something plausible.
   */
  AI_PROVIDER: z.enum(['none', 'stub', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  /**
   * TypeSafe's JEV decision engine (ADR-0051). Set, and triage asks JEV;
   * unset, JEV is not in the chain. Independent of `AI_PROVIDER`: JEV decides
   * and never generates.
   */
  JEV_API_KEY: z.string().optional(),
  /** The model a prompt version gets when it names none. */
  AI_DEFAULT_MODEL: z.string().optional(),
  /**
   * What each model costs, as JSON: micro-pence per thousand tokens, keyed by
   * model. Operator-supplied because a vendor's published price changes
   * without asking this repository and is quoted in another currency — and
   * because an unpriced model is refused rather than counted as free.
   */
  AI_MODEL_PRICES: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('itsm-api'),

  WORKER_QUEUES: z.string().default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(600),

  /**
   * How long one evaluated metric answer is reused, in seconds (A8 R4c). Off
   * by default so tests and development always read fresh facts; the deploy
   * sets 120 for the API, where the shared demo's dashboards would otherwise
   * send every visitor's identical query to the database (Y-M2).
   */
  ANALYTICS_QUERY_CACHE_SECONDS: z.coerce.number().int().min(0).max(600).default(0),

  /* ---------------------------------------------------------------------------
   * The shared demo (SPEC v3 §4.9). Every value below is a code default except
   * `DEMO_MODE`, which the deploy sets, so a deployment that never heard of the
   * demo runs exactly as before. None of them is a secret.
   *
   * `DEMO_TENANT_SLUG` is deliberately not validated here: a bad slug must not
   * stop production from starting. The boot interlock (`demoInterlock` in
   * `demo.ts`) refuses it instead — demo tokens end, the status route says
   * `misconfigured`, the worker skips its demo jobs — and says so loudly.
   * ------------------------------------------------------------------------ */
  DEMO_MODE: z.enum(['on', 'off']).default('off'),
  DEMO_TENANT_SLUG: z.string().default('demo'),
  /** The operator's own tenant (`infra/scripts/bootstrap.ts`); read here so the interlock can refuse to share it with the demo. */
  BOOTSTRAP_TENANT_SLUG: z.string().optional(),
  /** Visitors may reset the demo once per this window; the worker writes the cooldown key with the same value. */
  DEMO_RESET_COOLDOWN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(DEMO_RESET_COOLDOWN_SECONDS),
  /** Writes per visit per minute (429 `rate_limited`). */
  DEMO_WRITES_PER_MINUTE: z.coerce.number().int().positive().default(30),
  /** Writes per visit in all (429 `demo_limit`, category `writes`). */
  DEMO_WRITES_PER_SESSION: z.coerce.number().int().positive().default(500),
  /** Writes per IP bucket per hour: a ten-person workshop behind one NAT stays well under it. */
  DEMO_WRITES_PER_IP_HOUR: z.coerce.number().int().positive().default(2_000),
  /**
   * Demo-tenant writes per hour above which the API warns and refuses only the
   * ten busiest buckets. Never a block on everyone: one attacker must not be
   * able to switch the demo off for every prospect (Y-M1).
   */
  DEMO_WRITES_ALERT_PER_HOUR: z.coerce.number().int().positive().default(20_000),
  /** Reads per IP bucket per minute (Y-M2): the per-visit budget alone lets one address open twenty visits. */
  DEMO_READS_PER_IP_MINUTE: z.coerce.number().int().positive().default(1_200),
  /** The generator's seed (A4 §1.15): one seed, one story, every night. */
  DEMO_SEED: z.coerce.number().int().min(0).max(0xffff_ffff).default(20_261_002),
  /** Tickets and their history scale with this; people and configuration do not. 0.2 in CI and the harness. */
  DEMO_SCALE: z.coerce.number().min(0.1).max(1).default(1),
  /** At least 60 for the previous-period deltas, at most 150 for the holiday table (A4 §3.11). */
  DEMO_HISTORY_DAYS: z.coerce.number().int().min(60).max(150).default(120),
  /** A build that runs longer is abandoned; equal to the reset lock's lifetime. */
  DEMO_BUILD_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  /**
   * Batches the build replays and reprojects at once (R3). Two, not four: the
   * build shares `worker-data` and the database with every real tenant.
   */
  DEMO_BUILD_PARALLELISM: z.coerce.number().int().min(1).max(8).default(2),
});

export type PlatformConfig = z.infer<typeof schema>;

let cached: PlatformConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`invalid configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached configuration. */
export function resetConfig(): void {
  cached = undefined;
}
