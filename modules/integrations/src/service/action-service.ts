import { z } from 'zod';
import {
  type TenantContext,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  logger,
  newId,
  recordAudit,
  resolveSecret,
  transaction,
} from '@itsm/platform';
import { readPath } from '@itsm/expr';
import { call, GatewayRefusedError, type GatewayDeps } from '../gateway/gateway.js';
import { checkDestination } from '../gateway/address-guard.js';

/**
 * MOD-06-E2 actions: what a workflow may do to the outside world.
 *
 * A named definition rather than a URL typed into a workflow node. Three things
 * follow from that, and all three are the reason it is worth the indirection:
 * the same call is reused by several workflows; the credential is named once
 * and never appears in a graph an administrator can export; and listing this
 * table answers "what outbound calls can this platform make?", which is the
 * question a security review actually asks and which a URL buried in a node
 * cannot answer.
 */

export const httpConfigSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    url: z.string().url(),
    headers: z.record(z.string().max(500)).default({}),
    /** Templated with `{{path}}` against the caller's input, like a workflow node. */
    body: z.record(z.unknown()).optional(),
  })
  .strict();

export const transformConfigSchema = z
  .object({
    /** Dotted paths from the input to the output: `{ "id": "ticket.id" }`. */
    map: z.record(z.string().max(200)),
  })
  .strict();

export const actionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9.-]{1,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  kind: z.enum(['http', 'transform']),
  config: z.record(z.unknown()),
  credentialRef: z.string().max(60).nullable().optional(),
  credentialHeader: z.string().max(60).nullable().optional(),
  retryMax: z.number().int().min(0).max(10).default(3),
  timeoutMs: z.number().int().min(100).max(30_000).default(15_000),
  responseMapping: z.record(z.string().max(200)).default({}),
});

export interface ActionOutcome {
  ok: boolean;
  /** The mapped values, merged into the caller's context under its own key. */
  output: Record<string, unknown>;
  status?: number;
  error?: string;
  /** True when the failure is a configuration error and retrying cannot help. */
  permanent?: boolean;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function createAction(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'integration.action.manage');
  const parsed = actionSchema.parse(input);
  await assertConfigIsUsable(parsed.kind, parsed.config);

  return transaction(ctx, async (tx) => {
    const existing = await tx.actionDefinition.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`an action called ${parsed.key} already exists`);

    const row = await tx.actionDefinition.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        kind: parsed.kind,
        config: parsed.config as never,
        credentialRef: parsed.credentialRef ?? null,
        credentialHeader: parsed.credentialHeader ?? null,
        retryMax: parsed.retryMax,
        timeoutMs: parsed.timeoutMs,
        responseMapping: parsed.responseMapping as never,
        status: 'draft',
      },
    });

    await recordAudit(tx, ctx, {
      action: 'integration.action.created',
      targetType: 'action_definition',
      targetId: row.id,
      // The URL is recorded; the credential is a name, so recording it is safe
      // and useful — "which credential does this use?" is an audit question.
      after: { key: parsed.key, kind: parsed.kind, credentialRef: parsed.credentialRef ?? null },
    });

    return row;
  });
}

export async function publishAction(ctx: TenantContext, key: string) {
  authz.require(ctx, 'integration.action.manage');

  return transaction(ctx, async (tx) => {
    const action = await tx.actionDefinition.findFirst({ where: { key } });
    if (!action) throw new NotFoundError('action', key);

    // Re-checked at publish, not only at save: the destination may have started
    // resolving somewhere private since, and the credential may have been
    // deleted. Publishing is the moment somebody is asserting it works.
    await assertConfigIsUsable(action.kind, action.config as Record<string, unknown>);
    if (action.credentialRef && !(await resolveSecret(ctx, action.credentialRef))) {
      throw new ValidationError(
        `this action names the credential ${action.credentialRef}, which is not configured; store it before publishing`,
      );
    }

    await tx.actionDefinition.update({ where: { id: action.id }, data: { status: 'published' } });
    await recordAudit(tx, ctx, {
      action: 'integration.action.published',
      targetType: 'action_definition',
      targetId: action.id,
      after: { key },
    });

    return { key, status: 'published' };
  });
}

export async function listActions(ctx: TenantContext) {
  authz.require(ctx, 'integration.action.read');
  return transaction(ctx, (tx) => tx.actionDefinition.findMany({ orderBy: { key: 'asc' } }));
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Runs a published action.
 *
 * Returns an outcome rather than throwing, and marks configuration errors
 * `permanent`, because the caller's retry policy must not spend five attempts
 * on a URL that will never be allowed. A workflow retrying an SSRF refusal is
 * a workflow that takes four extra minutes to tell somebody their URL is wrong.
 */
export async function runAction(
  ctx: TenantContext,
  key: string,
  input: Record<string, unknown>,
  options: { idempotencyKey?: string; cause?: { kind: string; id: string } } = {},
  deps: GatewayDeps = {},
): Promise<ActionOutcome> {
  const action = await transaction(ctx, (tx) => tx.actionDefinition.findFirst({ where: { key, status: 'published' } }));
  if (!action) {
    return { ok: false, output: {}, error: `no published action called ${key}`, permanent: true };
  }

  if (action.kind === 'transform') {
    // No I/O at all: reshaping the run context is a legitimate step and should
    // not need a round trip to anywhere.
    const config = transformConfigSchema.parse(action.config);
    const output: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(config.map)) output[name] = readPath(input, path);
    return { ok: true, output };
  }

  const config = httpConfigSchema.parse(action.config);
  const credential = action.credentialRef
    ? await resolveSecret(ctx, action.credentialRef)
    : null;

  if (action.credentialRef && !credential) {
    return {
      ok: false,
      output: {},
      error: `the credential ${action.credentialRef} is not configured`,
      permanent: true,
    };
  }

  try {
    const response = await call(
      ctx,
      {
        connector: key,
        method: config.method,
        url: renderTemplate(config.url, input),
        headers: Object.fromEntries(
          Object.entries(config.headers).map(([name, value]) => [name, renderTemplate(value, input)]),
        ),
        ...(config.body ? { body: renderDeep(config.body, input) } : {}),
        timeoutMs: action.timeoutMs,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(credential && action.credentialHeader
          ? { credential: { header: action.credentialHeader, value: credential } }
          : {}),
        ...(options.cause ? { cause: options.cause } : {}),
      },
      deps,
    );

    const mapped = mapResponse(action.responseMapping as Record<string, string>, response);

    if (response.status >= 400) {
      return {
        ok: false,
        output: mapped,
        status: response.status,
        error: `that endpoint answered ${response.status}`,
        // A 4xx will answer the same way next time; a 5xx might not.
        permanent: response.status < 500,
      };
    }

    return { ok: true, output: mapped, status: response.status };
  } catch (error) {
    const permanent = error instanceof GatewayRefusedError;
    return {
      ok: false,
      output: {},
      error: error instanceof Error ? error.message : String(error),
      permanent,
    };
  }
}

/**
 * Pulls values out of the response and into the run context.
 *
 * Dotted paths rather than full JSONPath: `body.data.id` is what people
 * actually write, and the subset that reads a nested value is the whole of what
 * a workflow needs. A path that finds nothing maps to null rather than being
 * omitted, so a later condition can tell "absent" from "never asked for".
 */
export function mapResponse(
  mapping: Record<string, string>,
  response: { status: number; headers: Record<string, string>; body: unknown },
): Record<string, unknown> {
  const source = { status: response.status, headers: response.headers, body: response.body };
  const output: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(mapping ?? {})) {
    const value = readPath(source, path);
    output[name] = value === undefined ? null : value;
  }
  return output;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;

function renderTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, path: string) => {
    const value = readPath(input, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

function renderDeep(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return renderTemplate(value, input);
  if (Array.isArray(value)) return value.map((entry) => renderDeep(entry, input));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renderDeep(entry, input)]));
  }
  return value;
}

/**
 * Refuses a configuration that could never work, when it is saved.
 *
 * The destination check runs here as well as at call time. At call time it
 * protects the network; here it tells an administrator that the URL they have
 * typed points at something they are not allowed to reach — while they are
 * still looking at the form, rather than from a workflow run three days later.
 */
async function assertConfigIsUsable(kind: string, config: Record<string, unknown>): Promise<void> {
  if (kind === 'transform') {
    transformConfigSchema.parse(config);
    return;
  }

  const parsed = httpConfigSchema.parse(config);

  // A templated URL cannot be checked until it is rendered, so a URL containing
  // a placeholder is checked for what it is: a hostname the author has fixed
  // and a path they have not. Refusing a templated *host* is the important part
  // — that would let a workflow's own data choose the destination.
  const host = parsed.url.replace(PLACEHOLDER, 'x');
  if (/\{\{/.test(new URL(host).hostname)) {
    throw new ValidationError('the host of an action URL cannot be templated; only the path and query may be');
  }

  const verdict = await checkDestination(host);
  if (!verdict.allowed) {
    throw new ValidationError(`this action cannot call that address: ${verdict.reason}`);
  }
}

// ---------------------------------------------------------------------------
// The error queue
// ---------------------------------------------------------------------------

export async function recordFailure(
  ctx: TenantContext,
  input: {
    source: string;
    sourceId: string;
    actionKey?: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    error: string;
    attempts: number;
  },
): Promise<void> {
  await transaction(ctx, async (tx) => {
    const existing = await tx.errorQueueItem.findFirst({
      where: { source: input.source, sourceId: input.sourceId, idempotencyKey: input.idempotencyKey, status: 'open' },
    });
    if (existing) {
      // One item per failing thing, with a count — not one per attempt, which
      // would bury the ten real problems under a thousand retries.
      await tx.errorQueueItem.update({
        where: { id: existing.id },
        data: { attempts: existing.attempts + 1, error: input.error },
      });
      return;
    }

    await tx.errorQueueItem.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        source: input.source,
        sourceId: input.sourceId,
        actionKey: input.actionKey ?? null,
        payload: input.payload as never,
        idempotencyKey: input.idempotencyKey,
        error: input.error,
        attempts: input.attempts,
        status: 'open',
      },
    });
  });

  logger.warn('an action failed past its retries and is in the error queue', {
    source: input.source,
    sourceId: input.sourceId,
    action: input.actionKey,
  });
}

export async function listErrorQueue(ctx: TenantContext, status = 'open') {
  authz.require(ctx, 'integration.action.read');
  return transaction(ctx, (tx) =>
    tx.errorQueueItem.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 200 }),
  );
}

/**
 * Replays a failed action with the **same** idempotency key.
 *
 * The same key is the whole point: the original attempt may have reached the
 * far end and failed on the way back, so a replay with a fresh key would be a
 * second request. An operator pressing retry should not be able to create a
 * duplicate user account.
 */
export async function replayError(ctx: TenantContext, id: string): Promise<ActionOutcome> {
  authz.require(ctx, 'integration.action.replay');

  const item = await transaction(ctx, (tx) => tx.errorQueueItem.findFirst({ where: { id, status: 'open' } }));
  if (!item) throw new NotFoundError('error queue item', id);
  if (!item.actionKey) throw new ValidationError('this failure did not come from an action, so it cannot be replayed');

  const outcome = await runAction(ctx, item.actionKey, item.payload as Record<string, unknown>, {
    idempotencyKey: item.idempotencyKey,
    cause: { kind: item.source, id: item.sourceId },
  });

  if (outcome.ok) {
    await transaction(ctx, async (tx) => {
      await tx.errorQueueItem.update({
        where: { id },
        data: { status: 'replayed', resolvedAt: new Date(), resolvedBy: ctx.actor.id ?? null },
      });
      await recordAudit(tx, ctx, {
        action: 'integration.error.replayed',
        targetType: 'error_queue_item',
        targetId: id,
        after: { actionKey: item.actionKey },
      });
    });
  }

  return outcome;
}

export async function dismissError(ctx: TenantContext, id: string, reason: string): Promise<void> {
  authz.require(ctx, 'integration.action.replay');
  if (!reason.trim()) throw new ValidationError('dismissing a failure needs a reason; somebody will ask later');

  await transaction(ctx, async (tx) => {
    await tx.errorQueueItem.update({
      where: { id },
      data: { status: 'dismissed', dismissedReason: reason, resolvedAt: new Date(), resolvedBy: ctx.actor.id ?? null },
    });
    await recordAudit(tx, ctx, {
      action: 'integration.error.dismissed',
      targetType: 'error_queue_item',
      targetId: id,
      reason,
    });
  });
}
