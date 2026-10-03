import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createContext,
  buildPermissionSet,
  metrics,
  registerSecretResolver,
  resetSecretResolvers,
  resolveSecret,
  setTenantKindReader,
} from '@itsm/platform';
import { DEMO_GATEWAY_REFUSAL, GatewayRefusedError, call, type GatewayLogEntry, type GatewayRequest } from '../gateway/gateway.js';
import { breakers } from '../gateway/circuit-breaker.js';

/**
 * E1 and E10 (SPEC v3 §4.7.2): the shared demo calls nothing outside the
 * platform and resolves no credential.
 *
 * Every case runs the same call from a demo tenant and from a real one, side
 * by side, because the guard is only half the claim: "no row changes
 * behaviour for a standard tenant" is the other half, and a guard keyed on the
 * wrong thing fails that half first. Tenant kinds come from an injected
 * reader, as the platform's own tests do; the database half is
 * `tests/integration/demo-egress.test.ts`.
 */

const DEMO = '0192a000-0000-7000-8000-00000000de00';
const STANDARD = '0192a000-0000-7000-8000-000000000001';
const VANISHED = '0192a000-0000-7000-8000-0000000000ff';

const KINDS: Record<string, string | null> = { [DEMO]: 'demo', [STANDARD]: 'standard', [VANISHED]: null };

function contextOf(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });
}

function suppressed(choke: string): number {
  return metrics.snapshot().counters[`demo_egress_suppressed_total{choke=${choke}}`] ?? 0;
}

const publicResolver = vi.fn(async () => [{ address: '93.184.216.34' }]);
let sent: string[];
let logged: GatewayLogEntry[];

const fetchImpl = (async (url: string) => {
  sent.push(url);
  return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

const deps = () => ({
  fetchImpl,
  resolver: publicResolver,
  sink: async (entry: GatewayLogEntry) => {
    logged.push(entry);
  },
});

const webhook: GatewayRequest = {
  connector: 'webhook',
  method: 'POST',
  url: 'https://hooks.example.test/itsm?token=abc',
  headers: { 'x-request-id': 'r-1' },
  body: { event: 'ticket.created', number: 'INC-000101' },
  credential: { header: 'authorization', value: 'Bearer the-real-secret' },
};

beforeEach(() => {
  sent = [];
  logged = [];
  publicResolver.mockClear();
  breakers.reset();
  setTenantKindReader(async (tenantId) => {
    if (!(tenantId in KINDS)) throw new Error(`no kind for ${tenantId} in this test`);
    return KINDS[tenantId]!;
  });
});

afterEach(() => {
  setTenantKindReader(null);
  resetSecretResolvers();
});

describe('E1 · the integration gateway', () => {
  it('refuses a demo call before it resolves or sends anything, and says why in the demo’s words', async () => {
    const before = suppressed('E1');
    const refusal = call(contextOf(DEMO), webhook, deps());

    await expect(refusal).rejects.toBeInstanceOf(GatewayRefusedError);
    await expect(refusal).rejects.toThrow(DEMO_GATEWAY_REFUSAL);
    expect(DEMO_GATEWAY_REFUSAL).toBe('this is a shared demo, so connecting to other systems is turned off');
    expect(sent).toEqual([]);
    // Not even the hostname is looked up: the destination check comes after.
    expect(publicResolver).not.toHaveBeenCalled();
    expect(suppressed('E1')).toBe(before + 1);
  });

  it('writes the refused log row, with no credential in it', async () => {
    await call(contextOf(DEMO), webhook, deps()).catch(() => undefined);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ connector: 'webhook', method: 'POST', status: 0, error: 'refused: demo', durationMs: 0 });
    expect(logged[0]!.requestHeaders).toEqual({ 'x-request-id': 'r-1' });
    expect(JSON.stringify(logged)).not.toContain('the-real-secret');
  });

  it('counts a refusal as a refusal, not as the endpoint failing', async () => {
    // The endpoint was never asked, so it cannot have failed: charging the
    // breaker would report a healthy connector as down.
    for (let i = 0; i < 10; i += 1) await call(contextOf(DEMO), webhook, deps()).catch(() => undefined);
    expect(() => breakers.assertClosed(DEMO, 'webhook')).not.toThrow();
  });

  it('sends the same call for a real tenant, unchanged', async () => {
    const before = suppressed('E1');
    const response = await call(contextOf(STANDARD), webhook, deps());

    expect(response).toMatchObject({ status: 200, body: { ok: true } });
    expect(sent).toEqual(['https://hooks.example.test/itsm?token=abc']);
    expect(publicResolver).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({ status: 200, error: null });
    expect(suppressed('E1')).toBe(before);
  });

  it('refuses a tenant that no longer exists, as a purged demo generation', async () => {
    await expect(call(contextOf(VANISHED), webhook, deps())).rejects.toThrow(DEMO_GATEWAY_REFUSAL);
    expect(sent).toEqual([]);
  });

  it('sends nothing and refuses nothing when the kind cannot be read: the job retries', async () => {
    setTenantKindReader(async () => {
      throw new Error('the platform database is unavailable');
    });
    const outcome = call(contextOf(STANDARD), webhook, deps());

    await expect(outcome).rejects.toThrow('the platform database is unavailable');
    await expect(outcome).rejects.not.toBeInstanceOf(GatewayRefusedError);
    expect(sent).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe('E10 · the credential store', () => {
  it('resolves nothing for the demo, before any resolver is asked', async () => {
    const resolver = vi.fn(async () => 'the-operator-secret');
    registerSecretResolver('test', resolver);
    const before = suppressed('E10');

    await expect(resolveSecret(contextOf(DEMO), 'graph-acme')).resolves.toBeNull();
    expect(resolver).not.toHaveBeenCalled();
    expect(suppressed('E10')).toBe(before + 1);
  });

  it('does not hand the demo the deployment’s own environment credential', async () => {
    // The environment resolver maps any reference to ITSM_CREDENTIAL_<REF>,
    // so a reference a visitor could name would otherwise borrow the operator's.
    const { environmentResolver } = await import('@itsm/platform');
    registerSecretResolver('environment', environmentResolver);
    vi.stubEnv('ITSM_CREDENTIAL_SLACK_BOT', 'xoxb-operator');
    try {
      await expect(resolveSecret(contextOf(DEMO), 'slack-bot')).resolves.toBeNull();
      await expect(resolveSecret(contextOf(STANDARD), 'slack-bot')).resolves.toBe('xoxb-operator');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resolves as before for a real tenant, and for the deployment’s own checks with no tenant', async () => {
    const resolver = vi.fn(async () => 'the-tenant-secret');
    registerSecretResolver('test', resolver);
    const before = suppressed('E10');

    await expect(resolveSecret(contextOf(STANDARD), 'graph-acme')).resolves.toBe('the-tenant-secret');
    await expect(resolveSecret(null, 'graph-acme')).resolves.toBe('the-tenant-secret');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(suppressed('E10')).toBe(before);
  });

  it('asks nothing for a missing reference, demo or not', async () => {
    const before = suppressed('E10');
    await expect(resolveSecret(contextOf(DEMO), undefined)).resolves.toBeNull();
    expect(suppressed('E10')).toBe(before);
  });
});
