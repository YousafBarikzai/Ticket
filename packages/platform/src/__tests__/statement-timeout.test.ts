import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { SYSTEM_PERMISSIONS, createContext, type DemoContext, type TenantContext } from '../context.js';
import {
  DEMO_STATEMENT_TIMEOUT_MS,
  READ_STATEMENT_TIMEOUT_MS,
  isStatementTimeout,
  readStatementTimeoutMs,
  transaction,
} from '../db.js';
import { QueryTimeoutError, toProblemDetails } from '../errors.js';
import { logger, metrics } from '../telemetry.js';

/**
 * The shared demo's statement timeout (Y-M2; SPEC v3 §4.7.7, §4.8). A demo
 * transaction runs `SET LOCAL statement_timeout = '5s'`, in the same statement
 * that sets the tenant; no other transaction does; and a statement the limit
 * stops answers 503 for that request.
 *
 * Run against a recording client rather than a database: what matters here is
 * which statements `transaction()` issues and what it does with an error.
 */

const DEMO: DemoContext = {
  sid: 'demo-0b6f3c1e-2a4d-4c1b-9e3f-5a6b7c8d9e0f',
  persona: 'admin',
  app: 'admin',
  generation: 7,
  personaUserIds: {
    employee: '44444444-4444-4444-8444-444444444444',
    agent: '55555555-5555-4555-8555-555555555555',
    admin: '66666666-6666-4666-8666-666666666666',
  },
  agentTeamIds: [],
};

function context(demo?: DemoContext): TenantContext {
  return createContext({
    tenantId: '22222222-2222-4222-8222-222222222222',
    actor: { type: 'user', id: DEMO.personaUserIds.admin },
    permissions: SYSTEM_PERMISSIONS,
    ...(demo ? { demo } : {}),
  });
}

interface Statement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A client whose transactions record every raw statement and run the callback. */
function recordingClient(): { client: PrismaClient; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = {
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      statements.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
      return Promise.resolve(1);
    },
  };
  const client = {
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { client: client as unknown as PrismaClient, statements };
}

const RAW_TIMEOUT = new Prisma.PrismaClientKnownRequestError(
  'Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`',
  { code: 'P2010', clientVersion: '6.19.3', meta: { code: '57014', message: 'ERROR: canceling statement due to statement timeout' } },
);
const MODEL_TIMEOUT = new Prisma.PrismaClientUnknownRequestError(
  'Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "57014", message: "canceling statement due to statement timeout", severity: "ERROR" }), transient: false })',
  { clientVersion: '6.19.3' },
);

describe('the demo statement timeout', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    metrics.reset();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('sets statement_timeout to 5s, transaction-local, with the tenant, in a demo transaction', async () => {
    const { client, statements } = recordingClient();
    const ctx = context(DEMO);
    await transaction(ctx, async () => 'done', { client });
    expect(statements).toHaveLength(1);
    const [first] = statements;
    expect(first!.sql).toContain("set_config('app.tenant_id', ?, true)");
    expect(first!.sql).toContain("set_config('app.actor_id', ?, true)");
    // `set_config(name, value, true)` is `SET LOCAL`: it ends with the transaction.
    expect(first!.sql).toContain("set_config('statement_timeout', ?, true)");
    expect(first!.values).toEqual([ctx.tenantId, ctx.actor.id, '5s']);
    expect(DEMO_STATEMENT_TIMEOUT_MS).toBe(5_000);
  });

  it('sets no statement timeout in any other transaction', async () => {
    const { client, statements } = recordingClient();
    const ctx = context();
    await transaction(ctx, async () => 'done', { client });
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).not.toContain('statement_timeout');
    expect(statements[0]!.values).toEqual([ctx.tenantId, ctx.actor.id]);
  });

  it('keeps the shorter demo limit on the analytical read pool', () => {
    expect(readStatementTimeoutMs(context(DEMO))).toBe(DEMO_STATEMENT_TIMEOUT_MS);
    expect(readStatementTimeoutMs(context())).toBe(READ_STATEMENT_TIMEOUT_MS);
  });

  it.each([
    ['a raw query', RAW_TIMEOUT],
    ['a model query', MODEL_TIMEOUT],
  ])('answers 503 query_timeout when the limit stops %s in a demo transaction', async (_what, error) => {
    const { client } = recordingClient();
    const attempt = transaction(context(DEMO), async () => {
      throw error;
    }, { client });
    await expect(attempt).rejects.toBeInstanceOf(QueryTimeoutError);
    const problem = toProblemDetails(await attempt.catch((e: unknown) => e), 'corr');
    expect(problem.status).toBe(503);
    expect(problem.type).toBe('https://docs.itsm.example/problems/query_timeout');
    expect(JSON.stringify(problem)).not.toContain('57014');
    // Counted and logged, so an operator sees a visitor leaning on the database.
    expect(metrics.snapshot().counters['demo_statement_timeouts_total']).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('leaves a timeout outside the demo, and any other error in it, as it was', async () => {
    const { client } = recordingClient();
    await expect(transaction(context(), async () => {
      throw RAW_TIMEOUT;
    }, { client })).rejects.toBe(RAW_TIMEOUT);
    const other = new Error('unique constraint');
    await expect(transaction(context(DEMO), async () => {
      throw other;
    }, { client })).rejects.toBe(other);
    expect(metrics.snapshot().counters['demo_statement_timeouts_total']).toBeUndefined();
  });
});

describe('isStatementTimeout', () => {
  it('recognises PostgreSQL cancelling a statement for its timeout', () => {
    expect(isStatementTimeout(RAW_TIMEOUT)).toBe(true);
    expect(isStatementTimeout(MODEL_TIMEOUT)).toBe(true);
    // The node-postgres shape, should a driver adapter ever surface it as is.
    expect(isStatementTimeout({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isStatementTimeout(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' }))).toBe(false);
    // 57014 is also a user's cancel request: only the timeout is this request's fault.
    expect(isStatementTimeout(new Error('code "57014": canceling statement due to user request'))).toBe(false);
    expect(isStatementTimeout(new Error('statement timeout'))).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
    expect(isStatementTimeout('57014 statement timeout')).toBe(false);
  });
});
