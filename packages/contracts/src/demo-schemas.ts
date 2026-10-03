/**
 * `@itsm/contracts/demo/schemas` — strict parsers for the demo's Redis records.
 *
 * Server-only (the BFFs, the API, the worker, the CLI and the site's server):
 * it imports zod, which `@itsm/contracts/demo` keeps out of every browser
 * bundle (Y-B2).
 *
 * Every schema is strict and every versioned record must say `v: 1`. A record
 * that does not parse is treated as absent, which is how the demo fails
 * closed: an unknown field, a token for a persona its app may not mint, or a
 * record written by a future version reads as "no session", never as a
 * session with guessed fields.
 */
import { z } from 'zod';
import {
  DEMO_AREAS,
  DEMO_BUILD_STEPS,
  DEMO_IP_BUCKET_PATTERN,
  DEMO_PERSONAS,
  DEMO_PERSONA_FOR_AREA,
  DEMO_RESET_REASONS,
  DEMO_SID_PATTERN,
  DEMO_TENANT_SLUG_PATTERN,
  type DemoArea,
  type DemoBackoff,
  type DemoBuildState,
  type DemoCooldown,
  type DemoEvent,
  type DemoLiveRecord,
  type DemoPausedRecord,
  type DemoPersonaKey,
  type DemoResetReason,
  type DemoStatus,
  type DemoTokenRecord,
} from './demo.js';

const id = z.string().uuid();
const epochMs = z.number().int().nonnegative();
const generation = z.number().int().positive();
const areaSchema = z.enum(DEMO_AREAS as unknown as [DemoArea, ...DemoArea[]]);
const personaKeySchema = z.enum(DEMO_PERSONAS.map((p) => p.key) as [DemoPersonaKey, ...DemoPersonaKey[]]);
const resetReasonSchema = z.enum(DEMO_RESET_REASONS as unknown as [DemoResetReason, ...DemoResetReason[]]);
const buildStepSchema = z.enum(DEMO_BUILD_STEPS);
const personaUser = z.object({ userId: id }).strict();

export const demoLiveSchema: z.ZodType<DemoLiveRecord> = z
  .object({
    v: z.literal(1),
    tenantId: id,
    slug: z.string().regex(DEMO_TENANT_SLUG_PATTERN),
    generation,
    builtAt: epochMs,
    anchor: epochMs,
    lastResetAt: epochMs,
    lastResetReason: resetReasonSchema,
    personas: z.object({ employee: personaUser, agent: personaUser, admin: personaUser }).strict(),
    agentTeamIds: z.array(id).max(50),
  })
  .strict();

export const demoTokenSchema: z.ZodType<DemoTokenRecord> = z
  .object({
    v: z.literal(1),
    tenantId: id,
    userId: id,
    persona: personaKeySchema,
    app: areaSchema,
    sid: z.string().regex(DEMO_SID_PATTERN),
    gen: generation,
    iat: epochMs,
    exp: epochMs,
    ipb: z.string().regex(DEMO_IP_BUCKET_PATTERN),
  })
  .strict()
  // Only the BFF's Lua writes these, and it writes only what `mayMint` allowed;
  // a record that pairs an app with another area's persona was not written by
  // it, so it is no session at all.
  .refine((record) => DEMO_PERSONA_FOR_AREA[record.app] === record.persona, {
    message: 'the persona is not the one this app mints',
    path: ['persona'],
  })
  .refine((record) => record.exp > record.iat, { message: 'expires before it was issued', path: ['exp'] });

export const demoBuildSchema: z.ZodType<DemoBuildState> = z
  .object({
    v: z.literal(1),
    state: z.literal('building'),
    generation,
    reason: resetReasonSchema,
    startedAt: epochMs,
    step: buildStepSchema,
    stepIndex: z.number().int().min(1).max(DEMO_BUILD_STEPS.length),
    steps: z.literal(11),
    etaSec: z.number().int().nonnegative(),
  })
  .strict();

export const demoBackoffSchema: z.ZodType<DemoBackoff> = z
  .object({
    v: z.literal(1),
    failures: z.number().int().positive(),
    retryAt: epochMs,
    step: buildStepSchema,
  })
  .strict();

export const demoCooldownSchema: z.ZodType<DemoCooldown> = z
  .object({ at: epochMs, generation, reason: resetReasonSchema })
  .strict();

export const demoPausedSchema: z.ZodType<DemoPausedRecord> = z
  .object({ by: z.literal('operator'), at: epochMs, reason: z.string().max(500) })
  .strict();

export const demoEventSchema: z.ZodType<DemoEvent> = z.union([
  z
    .object({
      type: z.literal('swapped'),
      generation,
      previousGeneration: generation.nullable(),
      previousTenantId: id.nullable(),
      reason: resetReasonSchema,
      at: epochMs,
    })
    .strict(),
  z.object({ type: z.enum(['build-started', 'build-failed']), at: epochMs, reason: z.string().max(500) }).strict(),
  z.object({ type: z.enum(['paused', 'resumed']), at: epochMs }).strict(),
]);

const statusPersonaSchema = z
  .object({
    key: personaKeySchema,
    button: z.enum(['Employee', 'Agent', 'Admin']),
    name: z.string().min(1).max(100),
    title: z.string().min(1).max(100),
    area: areaSchema,
  })
  .strict();

/**
 * The public status, as the site's server reads it from the API. Strict like
 * the rest: a status the site cannot read in full is shown as "unknown" with
 * the local clock, rather than half-understood.
 */
export const demoStatusSchema: z.ZodType<DemoStatus> = z
  .object({
    v: z.literal(1),
    demo: z.literal(true),
    state: z.enum(['ready', 'building', 'preparing', 'paused']),
    serverNow: epochMs,
    resetTimeZone: z.string().min(1).max(64),
    resetLabel: z.string().min(1).max(64),
    resetHour: z.number().int().min(0).max(23),
    nextResetAt: epochMs,
    periodMs: z.number().int().positive(),
    generation: generation.nullable(),
    lastResetAt: epochMs.nullable(),
    lastResetReason: resetReasonSchema.nullable(),
    build: z.object({ startedAt: epochMs, etaSec: z.number().int().nonnegative() }).strict().nullable(),
    manualResetAvailableAt: epochMs.nullable(),
    resetBlocked: z.boolean(),
    cooldownSeconds: z.number().int().nonnegative(),
    uploads: z.literal(false),
    personas: z.array(statusPersonaSchema).max(DEMO_PERSONAS.length),
    company: z.object({ name: z.string().min(1).max(100), fictional: z.literal(true) }).strict(),
  })
  .strict();

/**
 * Parses a raw Redis value (or `null` for a missing key) with one of the
 * schemas above; anything that is not valid JSON or does not parse is `null`.
 */
export function parseDemoRecord<T>(schema: z.ZodType<T>, raw: string | null | undefined): T | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
