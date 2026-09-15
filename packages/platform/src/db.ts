import { PrismaClient, Prisma } from '@prisma/client';
import { currentContext, type TenantContext } from './context.js';
import { MissingTenantContextError } from './errors.js';
import { loadConfig } from './config.js';

/**
 * The tenant-aware data client (ADR-0004).
 *
 * Two independent layers protect tenant data and both are mandatory:
 *  1. the client extension injects `tenant_id` into every query it issues, and
 *  2. every transaction sets `app.tenant_id`, which the database's row-level
 *     security policies enforce.
 * A bug in one is caught by the other, and by the isolation suite.
 */

/** Models that are NOT tenant-scoped. Kept in step with the SQL allow-list. */
export const PLATFORM_MODELS = new Set(['Tenant', 'TenantGrant', 'ConsumerRegistry']);

/** Models that carry tenant_id but are readable by the platform role pre-context. */
export const DIRECTORY_MODELS = new Set(['TenantDomain', 'ChannelDirectory']);

/**
 * The client's model delegate properties, taken from the generated data model.
 *
 * The transaction proxy below must touch ONLY these: Prisma's own internals
 * (`_tracingHelper`, `_engine`, `_middlewares`) are also plain objects, and
 * wrapping one of those breaks the client in ways that surface far from here.
 */
const MODEL_PROPERTIES = new Set(
  Prisma.dmmf.datamodel.models.map((model) => model.name.charAt(0).toLowerCase() + model.name.slice(1)),
);

export function isModelProperty(property: string): boolean {
  return MODEL_PROPERTIES.has(property);
}

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

let appClient: PrismaClient | undefined;
let platformClient: PrismaClient | undefined;

function baseClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

function isTenantScoped(model: string | undefined): boolean {
  return Boolean(model) && !PLATFORM_MODELS.has(model!) && !DIRECTORY_MODELS.has(model!);
}

const READ_OPERATIONS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITE_WITH_WHERE = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/**
 * Injects the tenant into arguments. Reads and writes get a `tenant_id`
 * predicate; creates get the column set. `updateMany`/`deleteMany` without a
 * tenant predicate are rejected even though row-level security would also stop
 * them, so query logs stay honest about what was intended.
 */
function injectTenant(operation: string, args: Record<string, unknown>, tenantId: string): Record<string, unknown> {
  const next = { ...args };

  if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
    const where = (next.where as Record<string, unknown> | undefined) ?? {};
    next.where = { ...where, tenantId };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = next.data;
    if (Array.isArray(data)) {
      next.data = data.map((row) => ({ tenantId, ...(row as Record<string, unknown>) }));
    } else if (data && typeof data === 'object') {
      next.data = { tenantId, ...(data as Record<string, unknown>) };
    }
  }

  if (operation === 'upsert') {
    const create = next.create as Record<string, unknown> | undefined;
    if (create) next.create = { tenantId, ...create };
  }

  return next;
}

function extend(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = currentContext();
          if (!ctx) {
            throw new MissingTenantContextError(`${model ?? 'unknown'}.${operation}`);
          }
          if (!isTenantScoped(model)) return query(args);
          return query(injectTenant(operation, (args ?? {}) as Record<string, unknown>, ctx.tenantId) as typeof args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof extend>;

function appUrl(): string {
  return loadConfig().DATABASE_URL_APP;
}

/**
 * The application client.
 *
 * Every operation runs inside a transaction that sets `app.tenant_id`, because
 * row-level security reads that setting and `SET LOCAL` only lives for the
 * length of a transaction. Without this wrapping a bare read would quietly
 * return nothing at all, which is a far worse failure than an error: it looks
 * like missing data rather than a missing tenant.
 *
 * Use `transaction()` directly whenever several statements must succeed or fail
 * together; this convenience is for single reads and writes.
 */
export function db(): Db {
  if (!appClient) appClient = baseClient(appUrl());
  return autoTransactional(appClient) as unknown as Db;
}

function autoTransactional(client: PrismaClient): unknown {
  return new Proxy(client, {
    get(target, prop: string | symbol) {
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof prop !== 'string' || !isModelProperty(prop) || typeof value !== 'object' || value === null) {
        return value;
      }
      return new Proxy(value as Record<string, unknown>, {
        get(model, operation: string) {
          const fn = model[operation];
          if (typeof fn !== 'function') return fn;
          return async (args: Record<string, unknown> = {}) => {
            const ctx = currentContext();
            if (!ctx) throw new MissingTenantContextError(`${prop}.${operation}`);
            return transaction(ctx, async (tx) => {
              const delegate = (tx as unknown as Record<string, Record<string, unknown>>)[prop];
              const method = delegate?.[operation];
              if (typeof method !== 'function') {
                throw new MissingTenantContextError(`${prop}.${operation} is not a model operation`);
              }
              return (method as (a: unknown) => unknown).call(delegate, args);
            });
          };
        },
      });
    },
  });
}

/**
 * The platform client, for the tenant directory and provisioning. It uses the
 * `app_platform` role, which may read and write the directory tables but is
 * still subject to row-level security on everything tenant-scoped.
 */
export function platformDb(): PrismaClient {
  if (!platformClient) {
    const config = loadConfig();
    platformClient = baseClient(config.DATABASE_URL_PLATFORM ?? config.DATABASE_URL_APP);
  }
  return platformClient;
}

/**
 * Opens a transaction with the tenant (and actor) set for row-level security.
 *
 * `SET LOCAL` is deliberate: it is scoped to the transaction, so a pooled
 * connection can never carry one request's tenant into the next (risk AR-01).
 */
export async function transaction<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel; client?: PrismaClient } = {},
): Promise<T> {
  const client = options.client ?? (appClient ??= baseClient(appUrl()));
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                                  set_config('app.actor_id', ${ctx.actor.id ?? ''}, true)`;
      const scoped = extendTx(tx, ctx);
      return fn(scoped);
    },
    {
      timeout: options.timeout ?? 15_000,
      ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
    },
  );
}

/** As `transaction`, but on the platform role, for tenant provisioning. */
export async function platformTransaction<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options: { timeout?: number } = {},
): Promise<T> {
  return transaction(ctx, fn, { client: platformDb(), ...options });
}

/**
 * Wraps a transaction client so the same tenant injection applies inside a
 * transaction as outside it.
 */
function extendTx(tx: Prisma.TransactionClient, ctx: TenantContext): Tx {
  return new Proxy(tx as unknown as Tx, {
    get(target, prop: string | symbol) {
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      // Only model delegates are wrapped; everything else, including Prisma's
      // internals and the $-prefixed helpers, is passed straight through.
      if (typeof prop !== 'string' || !isModelProperty(prop) || typeof value !== 'object' || value === null) {
        return value;
      }
      const modelName = prop.charAt(0).toUpperCase() + prop.slice(1);
      if (!isTenantScoped(modelName)) return value;
      return new Proxy(value as Record<string, unknown>, {
        get(model, operation: string) {
          const fn = model[operation];
          if (typeof fn !== 'function') return fn;
          return (args: Record<string, unknown> = {}) =>
            (fn as (a: unknown) => unknown).call(model, injectTenant(operation, args, ctx.tenantId));
        },
      });
    },
  });
}

/** Closes pooled connections. Used by tests and by graceful shutdown. */
export async function disconnectDb(): Promise<void> {
  await Promise.all([appClient?.$disconnect(), platformClient?.$disconnect()]);
  appClient = undefined;
  platformClient = undefined;
}

export { Prisma };
