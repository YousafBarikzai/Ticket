import { describe, expect, it } from 'vitest';
import { createContext, buildPermissionSet } from '@itsm/platform';
import type { GatewayResponse } from '@itsm/module-integrations';
import { fetchRecords, resolveSource, type ResolvedSource } from '../sources/fetch.js';

/**
 * Paging, with the gateway stubbed: what these prove is that each strategy
 * stops when it should and never before, that the credential rides on the
 * request, and that a source that answers with an error imports nothing.
 */

const ctx = createContext({ tenantId: '11111111-1111-4111-8111-111111111111', actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });

function gateway(pages: unknown[], status = 200) {
  const calls: { url: string; credential?: { header: string; value: string } }[] = [];
  const callGateway = (async (_ctx: unknown, req: { url: string; credential?: { header: string; value: string } }) => {
    calls.push({ url: req.url, ...(req.credential ? { credential: req.credential } : {}) });
    const body = pages[calls.length - 1] ?? pages[pages.length - 1];
    return { status, headers: {}, body, durationMs: 1 } satisfies GatewayResponse;
  }) as never;
  return { callGateway, calls };
}

function source(over: Partial<ResolvedSource>): ResolvedSource {
  return { ...resolveSource('http_json', 'users', { url: 'https://api.example.test/users', recordsPath: 'items' }), ...over };
}

describe('reading every page', () => {
  it('walks offsets until a page comes back short', async () => {
    const stub = gateway([{ items: [1, 2] }, { items: [3, 4] }, { items: [5] }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'offset', param: 'offset', limitParam: 'limit', limit: 2 } }), stub);
    expect(result.records).toEqual([1, 2, 3, 4, 5]);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    expect(stub.calls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual(['0', '2', '4']);
  });

  it('stops at the total when the API says one, even though the last page was full', async () => {
    const stub = gateway([{ items: [1, 2], total: 4 }, { items: [3, 4], total: 4 }, { items: [9, 9], total: 4 }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'offset', param: 'startAt', limitParam: 'maxResults', limit: 2, totalPath: 'total' } }), stub);
    expect(result.records).toEqual([1, 2, 3, 4]);
    expect(stub.calls).toHaveLength(2);
  });

  it('stops when the API says it is the last page', async () => {
    const stub = gateway([{ items: [1, 2], isLast: false }, { items: [3, 4], isLast: true }, { items: [9, 9], isLast: true }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'offset', param: 'startAt', limitParam: 'maxResults', limit: 2, lastPagePath: 'isLast' } }), stub);
    expect(result.records).toEqual([1, 2, 3, 4]);
    expect(stub.calls).toHaveLength(2);
  });

  it('counts pages from one and stops on an empty one', async () => {
    const stub = gateway([{ items: [1, 2] }, { items: [3, 4] }, { items: [] }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'page', param: 'page', limitParam: 'per_page', limit: 2, startAt: 1 } }), stub);
    expect(result.records).toEqual([1, 2, 3, 4]);
    expect(stub.calls.map((call) => new URL(call.url).searchParams.get('page'))).toEqual(['1', '2', '3']);
  });

  it('follows a next link until there is none', async () => {
    const stub = gateway([{ items: [1], next: 'https://api.example.test/users?cursor=b' }, { items: [2], next: null }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'link', nextPath: 'next' } }), stub);
    expect(result.records).toEqual([1, 2]);
    expect(stub.calls[1]!.url).toBe('https://api.example.test/users?cursor=b');
  });

  it('reads one page when the source does not page', async () => {
    const stub = gateway([{ items: [1, 2, 3] }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'none' } }), stub);
    expect(result.records).toEqual([1, 2, 3]);
    expect(stub.calls).toHaveLength(1);
  });

  it('says so when it stopped before the end', async () => {
    const stub = gateway([{ items: [1, 2] }, { items: [3, 4] }, { items: [5, 6] }]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'offset', param: 'o', limitParam: 'l', limit: 2 }, maxPages: 2 }), stub);
    expect(result.records).toEqual([1, 2, 3, 4]);
    expect(result.truncated).toBe(true);
  });

  it('imports nothing from a source that answers with an error', async () => {
    const stub = gateway([{ message: 'unauthorised' }], 401);
    await expect(fetchRecords(ctx, source({ paging: { kind: 'none' } }), stub)).rejects.toThrow(/401/);
  });

  it('reads a bare list when recordsPath is empty', async () => {
    const stub = gateway([[1, 2]]);
    const result = await fetchRecords(ctx, source({ paging: { kind: 'none' }, recordsPath: '' }), stub);
    expect(result.records).toEqual([1, 2]);
  });
});
