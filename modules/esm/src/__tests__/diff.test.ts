import { describe, expect, it } from 'vitest';
import { countByState, diffPack, hasOutstanding, type InstalledItem } from '../domain/diff.js';
import { hashOf, packSchema, type Pack } from '../domain/pack.js';

/**
 * The eight answers to "what would a newer pack do to me".
 *
 * Every one of these is a combination rather than a query — the pack moved,
 * the tenant moved, both moved, both moved and the tenant already said no — so
 * they are worth a table, and worth being readable without a database in the
 * way. The one that matters most is `conflict`: it is the only state where
 * taking the offer destroys work somebody did, and the whole point of the
 * design is that it is never taken without being named.
 */

function packOf(serviceName: string, extra: Record<string, unknown> = {}): Pack {
  return packSchema.parse({
    key: 'demo',
    name: 'Demo desk',
    version: 1,
    desk: 'Demo',
    description: 'A pack that exists to be diffed.',
    services: [{ key: 'demo', name: serviceName, description: 'A desk.' }],
    ...extra,
  });
}

const SHIPPED = { key: 'demo', name: 'Demo desk', description: 'A desk.' };
const shippedHash = hashOf('service', SHIPPED);

function installed(overrides: Partial<InstalledItem> = {}): InstalledItem {
  return {
    kind: 'service',
    key: 'demo',
    sourceHash: shippedHash,
    declinedHash: null,
    currentHash: shippedHash,
    ...overrides,
  };
}

describe('diffing a pack against what a tenant has', () => {
  it('offers an item the tenant has never had', () => {
    const lines = diffPack(packOf('Demo desk'), []);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.state).toBe('add');
    expect(lines[0]!.selector).toBe('service:demo');
    expect(lines[0]!.shippedHash).toBe(shippedHash);
  });

  it('says nothing about an item that matches on both sides', () => {
    const lines = diffPack(packOf('Demo desk'), [installed()]);
    expect(lines[0]!.state).toBe('unchanged');
    expect(lines[0]!.shippedHash).toBeNull();
    expect(hasOutstanding(lines)).toBe(false);
  });

  it('reports a tenant edit the pack has not caught up with, and offers nothing', () => {
    const lines = diffPack(packOf('Demo desk'), [installed({ currentHash: 'ff'.repeat(32) })]);
    expect(lines[0]!.state).toBe('edited');
    expect(lines[0]!.shippedHash).toBeNull();
    expect(hasOutstanding(lines)).toBe(false);
  });

  it('offers a clean update when the pack moved and the copy is untouched', () => {
    const lines = diffPack(packOf('People services'), [installed()]);
    expect(lines[0]!.state).toBe('update');
    expect(lines[0]!.shippedHash).not.toBe(shippedHash);
  });

  it('calls it a conflict when both moved, because taking it would destroy an edit', () => {
    const lines = diffPack(packOf('People services'), [installed({ currentHash: 'ff'.repeat(32) })]);
    expect(lines[0]!.state).toBe('conflict');
  });

  it('does not offer again what the tenant already refused at this exact version', () => {
    const moved = packOf('People services');
    const offer = diffPack(moved, [installed()])[0]!.shippedHash!;
    const lines = diffPack(moved, [installed({ declinedHash: offer })]);
    expect(lines[0]!.state).toBe('declined');
    expect(hasOutstanding(lines)).toBe(false);
  });

  it('offers again once the pack moves past the version that was refused', () => {
    const stale = hashOf('service', { ...SHIPPED, name: 'An older name' });
    const lines = diffPack(packOf('People services'), [installed({ declinedHash: stale })]);
    expect(lines[0]!.state).toBe('update');
  });

  it('notices an item that was installed and is no longer there', () => {
    const lines = diffPack(packOf('Demo desk'), [installed({ currentHash: null })]);
    expect(lines[0]!.state).toBe('missing');
    // Offered back rather than quietly forgotten: somebody deleted it, and the
    // pack is the only record that it was ever supposed to be there.
    expect(lines[0]!.shippedHash).toBe(shippedHash);
    expect(hasOutstanding(lines)).toBe(true);
  });

  it('reports, and never withdraws, something the pack has stopped shipping', () => {
    const lines = diffPack(packOf('Demo desk'), [
      installed(),
      installed({ kind: 'article', key: 'demo-old', currentHash: 'aa'.repeat(32), sourceHash: 'aa'.repeat(32) }),
    ]);
    expect(countByState(lines)).toEqual({ unchanged: 1, retired: 1 });
    expect(hasOutstanding(lines)).toBe(false);
  });

  it('walks a whole pack in install order, so a form is decided before the request that uses it', () => {
    const pack = packOf('Demo desk', {
      forms: [
        {
          key: 'demo-form',
          name: 'Demo form',
          document: { key: 'demo-form', schema: { type: 'object', properties: {} }, ui: { elements: [] } },
        },
      ],
      requestTypes: [{ key: 'demo-request', serviceKey: 'demo', name: 'Demo request', formKey: 'demo-form' }],
      articles: [{ key: 'demo-article', title: 'How the demo desk works' }],
    });
    expect(diffPack(pack, []).map((line) => line.selector)).toEqual([
      'service:demo',
      'form:demo-form',
      'request_type:demo-request',
      'article:demo-article',
    ]);
  });
});
