import { z } from 'zod';

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

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('itsm-api'),

  WORKER_QUEUES: z.string().default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(600),
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
