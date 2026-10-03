import { describe, expect, it } from 'vitest';
import { DEMO_IP_BUCKET_PATTERN, DEMO_KEYS, demoWindow, ukDateKey } from '@itsm/contracts/demo';
import {
  clientIp,
  ipBucket,
  ipPrefix,
  normaliseIp,
  requestIpBucket,
  UNKNOWN_IP_BUCKET,
  type DaySaltSource,
  type HeaderSource,
} from '../demo/ip.js';

/**
 * Client address and IP buckets (SPEC §4.8, A3 §8.1 and §11.1): leftmost
 * `X-Forwarded-For`, the `X-Real-IP` fallback, invalid → `null` → `unknown`,
 * IPv4 /32 and IPv6 /56, stable per salt and different across salts, and the
 * `cf-connecting-ip` mode.
 */

function headers(values: Record<string, string>): HeaderSource {
  const lower = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

const SALT = 'k3y-of-the-day-0123456789abcdefghijklmnopqrstuvwxyz';
const OTHER_SALT = 'another-day-salt-0123456789abcdefghijklmnopqrstuvwxyz';

describe('clientIp', () => {
  it('takes the leftmost X-Forwarded-For entry, which the edge wrote', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 10.0.0.3' }))).toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP without X-Forwarded-For', () => {
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.20' }))).toBe('198.51.100.20');
  });

  it('falls back to X-Real-IP when the leftmost entry is not an address', () => {
    expect(clientIp(headers({ 'x-forwarded-for': 'unknown, 10.0.0.2', 'x-real-ip': '198.51.100.20' }))).toBe(
      '198.51.100.20',
    );
  });

  it('answers null for anything that is not an address', () => {
    for (const value of ['', ' ', 'unknown', 'localhost', '999.1.1.1', '1.2.3', '01.2.3.4', 'javascript:1', '[::1']) {
      expect(clientIp(headers({ 'x-forwarded-for': value }))).toBeNull();
    }
    expect(clientIp(headers({}))).toBeNull();
  });

  it('never reads a header the mode does not name', () => {
    // In the default mode a CDN header is client-controlled.
    expect(clientIp(headers({ 'cf-connecting-ip': '203.0.113.9' }))).toBeNull();
    // Behind a CDN, X-Forwarded-For is the client's own claim again.
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.7' }), 'cf-connecting-ip')).toBeNull();
    expect(clientIp(headers({ 'x-real-ip': '203.0.113.7' }), 'cf-connecting-ip')).toBeNull();
  });

  it('reads CF-Connecting-IP in cf-connecting-ip mode', () => {
    expect(
      clientIp(headers({ 'cf-connecting-ip': '2001:db8::5', 'x-forwarded-for': '203.0.113.7' }), 'cf-connecting-ip'),
    ).toBe('2001:db8:0:0:0:0:0:5');
  });

  it('reads a Headers object as a route handler passes one', () => {
    const real = new Headers({ 'X-Forwarded-For': '203.0.113.7' });
    expect(clientIp(real)).toBe('203.0.113.7');
  });
});

describe('normaliseIp', () => {
  it('writes the forms proxies use as one address', () => {
    expect(normaliseIp('1.2.3.4:5678')).toBe('1.2.3.4');
    expect(normaliseIp('"1.2.3.4"')).toBe('1.2.3.4');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:db8:0:0:0:0:0:1');
    expect(normaliseIp('[2001:DB8::1]')).toBe('2001:db8:0:0:0:0:0:1');
    expect(normaliseIp('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:1');
    expect(normaliseIp('  2001:db8:0:0:0:0:0:1  ')).toBe('2001:db8:0:0:0:0:0:1');
  });

  it('reads an IPv4 client seen through a dual-stack socket as IPv4', () => {
    expect(normaliseIp('::ffff:198.51.100.20')).toBe('198.51.100.20');
    expect(normaliseIp('::ffff:c633:6414')).toBe('198.51.100.20');
  });

  it('keeps other embedded-IPv4 forms as IPv6', () => {
    expect(normaliseIp('64:ff9b::198.51.100.20')).toBe('64:ff9b:0:0:0:0:c633:6414');
    expect(normaliseIp('::198.51.100.20')).toBe('0:0:0:0:0:0:c633:6414');
  });

  it('refuses a bracket with junk after it, and an over-long value', () => {
    expect(normaliseIp('[2001:db8::1]junk')).toBeNull();
    expect(normaliseIp(`1.2.3.4${' '.repeat(200)}x`)).toBeNull();
    expect(normaliseIp(null)).toBeNull();
    expect(normaliseIp(undefined)).toBeNull();
  });
});

describe('ipPrefix', () => {
  it('is the whole IPv4 address', () => {
    expect(ipPrefix('203.0.113.7')).toBe('v4:203.0.113.7');
  });

  it('is the first 56 bits of an IPv6 address', () => {
    expect(ipPrefix('2001:db8:1234:5678::1')).toBe('v6:20010db8123456');
    expect(ipPrefix('2001:db8:1234:56ff:ffff:ffff:ffff:ffff')).toBe('v6:20010db8123456');
  });

  it('is null for something that is not an address', () => {
    expect(ipPrefix('not an address')).toBeNull();
  });
});

describe('ipBucket', () => {
  it('is 16 hex characters that key builders accept', () => {
    const bucket = ipBucket('203.0.113.7', SALT);
    expect(bucket).toMatch(/^[0-9a-f]{16}$/);
    expect(DEMO_IP_BUCKET_PATTERN.test(bucket)).toBe(true);
    expect(() => DEMO_KEYS.activeForBucket(bucket)).not.toThrow();
  });

  it('is stable for one salt and different under another', () => {
    expect(ipBucket('203.0.113.7', SALT)).toBe(ipBucket('203.0.113.7', SALT));
    expect(ipBucket('203.0.113.7', SALT)).not.toBe(ipBucket('203.0.113.7', OTHER_SALT));
  });

  it('gives every IPv4 address its own bucket', () => {
    expect(ipBucket('203.0.113.7', SALT)).not.toBe(ipBucket('203.0.113.8', SALT));
  });

  it('shares one bucket across an IPv6 /56 and splits /56s', () => {
    const one = ipBucket('2001:db8:1234:5600::1', SALT);
    expect(ipBucket('2001:db8:1234:56ab:cdef::99', SALT)).toBe(one);
    expect(ipBucket('2001:db8:1234:56ff:ffff:ffff:ffff:ffff', SALT)).toBe(one);
    expect(ipBucket('2001:db8:1234:5700::1', SALT)).not.toBe(one);
    expect(ipBucket('2001:db8:1235:5600::1', SALT)).not.toBe(one);
  });

  it('agrees however the address was written', () => {
    const bucket = ipBucket('198.51.100.20', SALT);
    expect(ipBucket('::ffff:198.51.100.20', SALT)).toBe(bucket);
    expect(ipBucket('198.51.100.20:4431', SALT)).toBe(bucket);
    expect(ipBucket('[2001:DB8::1]:443', SALT)).toBe(ipBucket('2001:db8::1', SALT));
  });

  it('never confuses an IPv4 address with an IPv6 prefix', () => {
    expect(ipBucket('0.0.0.0', SALT)).not.toBe(ipBucket('::', SALT));
  });

  it('is unknown with no usable address', () => {
    expect(ipBucket(null, SALT)).toBe(UNKNOWN_IP_BUCKET);
    expect(ipBucket('nonsense', SALT)).toBe(UNKNOWN_IP_BUCKET);
    expect(UNKNOWN_IP_BUCKET).toBe('unknown');
  });

  it('uses one prefix rule for every limiter', () => {
    const address = '2001:db8:1234:5600::1';
    const buckets = (['mint', 'login', 'write', 'read'] as const).map((kind) => ipBucket(address, SALT, kind));
    expect(new Set(buckets).size).toBe(1);
  });

  it('never carries the address into a key name', () => {
    const address = '203.0.113.7';
    const bucket = ipBucket(address, SALT);
    const now = Date.UTC(2026, 9, 2, 12);
    const keys = [
      DEMO_KEYS.activeForBucket(bucket),
      DEMO_KEYS.mintPerBucket('workbench', 'agent', bucket, demoWindow('m', now)),
      DEMO_KEYS.writesPerBucket(bucket, demoWindow('h', now)),
      DEMO_KEYS.readsPerBucket(bucket, demoWindow('m', now)),
    ];
    for (const key of keys) expect(key).not.toContain(address);
    // And the builders refuse an address handed to them by mistake.
    expect(() => DEMO_KEYS.activeForBucket(address)).toThrow(RangeError);
  });
});

describe('requestIpBucket', () => {
  function salts(): DaySaltSource & { asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      async daySalt(dateKey) {
        asked.push(dateKey);
        return `${SALT}-${dateKey}`;
      },
    };
  }

  it("buckets under the UK day's salt", async () => {
    const source = salts();
    // The evening the clocks go back: 23:30 UTC is 23:30 in London, still 25 October.
    const now = Date.UTC(2026, 9, 25, 23, 30);
    const bucket = await requestIpBucket(headers({ 'x-forwarded-for': '203.0.113.7' }), {
      mode: 'x-forwarded-for',
      salts: source,
      now,
    });
    expect(source.asked).toEqual(['2026-10-25']);
    expect(ukDateKey(now)).toBe('2026-10-25');
    expect(bucket).toBe(ipBucket('203.0.113.7', `${SALT}-${ukDateKey(now)}`));
  });

  it('changes bucket when the UK day turns, so days cannot be joined', async () => {
    const source = salts();
    const request = headers({ 'x-forwarded-for': '203.0.113.7' });
    // 22:59 and 23:01 UTC on 2 Oct 2026 straddle midnight in London (BST).
    const before = await requestIpBucket(request, { mode: 'x-forwarded-for', salts: source, now: Date.UTC(2026, 9, 2, 22, 59) });
    const after = await requestIpBucket(request, { mode: 'x-forwarded-for', salts: source, now: Date.UTC(2026, 9, 2, 23, 1) });
    expect(source.asked).toEqual(['2026-10-02', '2026-10-03']);
    expect(before).not.toBe(after);
  });

  it('reads no salt for a request without an address', async () => {
    const source = salts();
    const bucket = await requestIpBucket(headers({}), { mode: 'x-forwarded-for', salts: source });
    expect(bucket).toBe('unknown');
    expect(source.asked).toEqual([]);
  });
});
