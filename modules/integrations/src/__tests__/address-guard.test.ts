import { describe, expect, it } from 'vitest';
import { checkDestination, refuseAddress } from '../gateway/address-guard.js';

/**
 * A connector's URL is configured by a tenant administrator — a customer's
 * employee, not ours — so these are the tests that stop "call this URL when a
 * ticket is raised" being a request-forgery primitive pointed at our network.
 */

const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

describe('addresses the gateway refuses', () => {
  it('refuses the cloud metadata endpoint', () => {
    // The highest-value target by a distance: it hands out instance
    // credentials to anything on the box that asks.
    expect(refuseAddress('169.254.169.254')).toMatch(/cloud instance credentials/);
  });

  it('refuses loopback, in both families and both notations', () => {
    expect(refuseAddress('127.0.0.1')).toMatch(/loopback/);
    expect(refuseAddress('127.1.2.3')).toMatch(/loopback/);
    expect(refuseAddress('::1')).toMatch(/loopback/);
    // An IPv4-mapped IPv6 address is an IPv4 address wearing a hat, and is the
    // obvious way past a check that only reads the textual form.
    expect(refuseAddress('::ffff:127.0.0.1')).toMatch(/loopback/);
  });

  it('refuses every private range', () => {
    for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
      expect({ address, why: refuseAddress(address) }).toMatchObject({ why: 'a private network' });
    }
    expect(refuseAddress('fd00::1')).toBe('a private network');
    expect(refuseAddress('fc00::1')).toBe('a private network');
  });

  it('does not over-refuse the edges of those ranges', () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 are private. A guard
    // that refuses the whole /8 blocks legitimate destinations and gets turned
    // off by the first person it inconveniences.
    expect(refuseAddress('172.15.255.255')).toBeNull();
    expect(refuseAddress('172.32.0.1')).toBeNull();
    expect(refuseAddress('11.0.0.1')).toBeNull();
    expect(refuseAddress('9.255.255.255')).toBeNull();
  });

  it('allows an ordinary public address', () => {
    expect(refuseAddress('93.184.216.34')).toBeNull();
    expect(refuseAddress('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });
});

describe('checking a destination URL', () => {
  it('refuses plain http, whatever the administrator configured', () => {
    // A connector carries a credential. The platform will not put one on the
    // wire in plaintext.
    return expect(checkDestination('http://example.test/hook', resolvesTo('93.184.216.34'))).resolves.toMatchObject({
      allowed: false,
      reason: 'connectors must use https',
    });
  });

  it('refuses a credential smuggled into the URL', async () => {
    // Credentials in a URL end up in logs, in Referer and in the audit trail.
    const verdict = await checkDestination('https://user:pass@example.test/hook', resolvesTo('93.184.216.34'));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/credential store/);
  });

  it('refuses a hostname that resolves somewhere private', async () => {
    // The ordinary bypass: a name the attacker controls, pointed inside.
    const verdict = await checkDestination('https://totally-fine.test/hook', resolvesTo('10.1.2.3'));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/10\.1\.2\.3.*private network/);
  });

  it('refuses when only one of several addresses is private', async () => {
    // Otherwise the refusal is a coin toss decided by resolver ordering.
    const verdict = await checkDestination('https://mixed.test/hook', resolvesTo('93.184.216.34', '127.0.0.1'));
    expect(verdict.allowed).toBe(false);
  });

  it('returns the resolved addresses so the caller can pin them', async () => {
    // The defence against DNS rebinding: a name that resolves public for the
    // check and private for the connection. The caller connects to what was
    // checked, not to the name again.
    const verdict = await checkDestination('https://example.test/hook', resolvesTo('93.184.216.34'));
    expect(verdict).toMatchObject({ allowed: true, addresses: ['93.184.216.34'] });
  });

  it('allows a literal public address without resolving anything', async () => {
    const verdict = await checkDestination('https://93.184.216.34/hook', async () => {
      throw new Error('should not resolve a literal');
    });
    expect(verdict.allowed).toBe(true);
  });

  it('refuses a literal private address', async () => {
    const verdict = await checkDestination('https://169.254.169.254/latest/meta-data/', async () => []);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/cloud instance credentials/);
  });

  it('refuses something that is not a URL at all', async () => {
    expect((await checkDestination('not a url', resolvesTo())).allowed).toBe(false);
  });

  it('refuses a name that does not resolve', async () => {
    const verdict = await checkDestination('https://nowhere.invalid/hook', async () => {
      throw new Error('ENOTFOUND');
    });
    expect(verdict).toMatchObject({ allowed: false, reason: 'that hostname does not resolve' });
  });
});
