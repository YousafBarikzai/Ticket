import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { ukDateKey } from '@itsm/contracts/demo';
import type { ClientIpHeader } from './settings.js';

/**
 * The client's address, and the salted bucket that stands in for it (SPEC
 * §4.8, A3 §8.1).
 *
 * The bucket is the only form in which an address leaves this module: it is
 * what rate-limit key names and the token record carry, so no raw IP is ever
 * written to Redis, the API, the database or a log line (§4.7.6). It is the
 * first 16 hex characters of an HMAC under a salt that rotates every UK day,
 * so a bucket cannot be reversed by hashing the IPv4 space, and yesterday's
 * buckets cannot be joined to today's.
 *
 * One prefix rule for every limiter: an IPv4 address is its own bucket (/32)
 * and an IPv6 address is bucketed by its /56, which is the smallest block an
 * ISP commonly hands one household. Per /128, one visitor rotating privacy
 * addresses would be thousands of buckets; per /64 that still holds for some
 * providers (Y-B1).
 */

/** Anything with a `get`, so a test can pass a plain object and a route can pass `request.headers`. */
export interface HeaderSource {
  get(name: string): string | null;
}

/** What `ipBucket` returns for a request with no usable address: one shared bucket, never a guess. */
export const UNKNOWN_IP_BUCKET = 'unknown';

/**
 * Which limiter is asking. Every kind uses the same prefix rule today (§4.2:
 * "one rule"); the argument keeps call sites self-describing and leaves room
 * for a kind to diverge without changing every caller.
 */
export type IpBucketKind = 'mint' | 'login' | 'write' | 'read';

/**
 * The client's address from the request headers, or `null`.
 *
 * `x-forwarded-for` mode takes the leftmost entry, because Railway's edge
 * replaces whatever the client sent with the address it saw (D23; verified
 * on every deploy by the `ip-check` probe, §4.8); failing that, `X-Real-IP`.
 * `cf-connecting-ip` mode exists for a proxying CDN in front of a custom
 * domain, behind which the leftmost entry is the client's own claim again;
 * in that mode nothing else is consulted, because every other header would
 * then be client-controlled.
 */
export function clientIp(headers: HeaderSource, mode: ClientIpHeader = 'x-forwarded-for'): string | null {
  if (mode === 'cf-connecting-ip') return normaliseIp(headers.get('cf-connecting-ip'));
  const forwarded = headers.get('x-forwarded-for');
  const leftmost = forwarded === null ? null : (forwarded.split(',')[0] ?? null);
  return normaliseIp(leftmost) ?? normaliseIp(headers.get('x-real-ip'));
}

/**
 * One address in canonical form, or `null` when it is not an address.
 *
 * Proxies write the same address several ways — `1.2.3.4:5678`,
 * `[2001:db8::1]:443`, `"2001:db8::1"`, `fe80::1%eth0`, upper case — and
 * a dual-stack listener reports an IPv4 client as `::ffff:1.2.3.4`. Each of
 * those must land in one bucket, or a visitor gets a fresh allowance by
 * changing nothing but the route their packets took.
 */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value.length === 0 || value.length > 100) return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1).trim();

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close < 0) return null;
    const rest = value.slice(close + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return null;
    value = value.slice(1, close);
  } else if (/^[\d.]+:\d{1,5}$/.test(value)) {
    value = value.slice(0, value.indexOf(':'));
  }

  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  value = value.toLowerCase();

  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;

  const groups = expandIpv6(value);
  if (!groups) return null;
  const mapped = ipv4FromMapped(groups);
  return mapped ?? groups.map((group) => group.toString(16)).join(':');
}

/**
 * The eight 16-bit groups of an IPv6 address, with `::` expanded and a
 * trailing dotted IPv4 part folded into the last two groups.
 */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (lastColon < 0) return null;
  const dotted = text.slice(lastColon + 1);
  if (dotted.includes('.')) {
    if (isIP(dotted) !== 4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = dotted.split('.').map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    // Drop the dotted part and its separating colon, but keep a `::` intact:
    // `::ffff:1.2.3.4` → `::ffff`, `64:ff9b::1.2.3.4` → `64:ff9b::`.
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16));
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 && known !== 8) return null;
  if (halves.length === 2 && known > 7) return null;
  const middle = halves.length === 2 ? new Array<number>(8 - known).fill(0) : [];
  const groups = [...head, ...middle, ...rest, ...tail];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

/** `::ffff:a.b.c.d` is an IPv4 client seen through a dual-stack socket: it buckets as that IPv4 address. */
function ipv4FromMapped(groups: readonly number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 !== 0 || g1 !== 0 || g2 !== 0 || g3 !== 0 || g4 !== 0 || g5 !== 0xffff) return null;
  return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
}

/**
 * The part of an address a bucket is made from: the whole IPv4 address, or
 * the first 56 bits of an IPv6 one. Tagged by family so the two can never
 * produce the same input to the HMAC.
 */
export function ipPrefix(ip: string): string | null {
  const address = normaliseIp(ip);
  if (address === null) return null;
  if (isIP(address) === 4) return `v4:${address}`;
  const groups = expandIpv6(address);
  if (!groups) return null;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0] = groups;
  const hex = (value: number): string => value.toString(16).padStart(4, '0');
  // Three whole groups (48 bits) and the high byte of the fourth: a /56.
  return `v6:${hex(g0)}${hex(g1)}${hex(g2)}${hex(g3).slice(0, 2)}`;
}

/**
 * The salted bucket for an address: 16 hex characters, or `unknown` when
 * there is no usable address. Every caller with the same salt agrees, so the
 * three apps' BFFs share one bucket per visitor and the API's write budgets
 * (keyed by the bucket in the token record) agree with the BFF's mint limits.
 */
export function ipBucket(ip: string | null, salt: string, _kind: IpBucketKind = 'mint'): string {
  if (ip === null) return UNKNOWN_IP_BUCKET;
  const prefix = ipPrefix(ip);
  if (prefix === null) return UNKNOWN_IP_BUCKET;
  return createHmac('sha256', salt).update(prefix).digest('hex').slice(0, 16);
}

/** Where today's salt comes from: the demo token store (`demo:salt:<ukDateKey>`, `SET NX`). */
export interface DaySaltSource {
  daySalt(dateKey: string): Promise<string>;
}

/**
 * The request's bucket under today's salt. Reads no salt for a request with
 * no usable address, which then shares the `unknown` bucket.
 */
export async function requestIpBucket(
  headers: HeaderSource,
  options: {
    readonly mode: ClientIpHeader;
    readonly salts: DaySaltSource;
    readonly kind?: IpBucketKind;
    readonly now?: number;
  },
): Promise<string> {
  const ip = clientIp(headers, options.mode);
  if (ip === null) return UNKNOWN_IP_BUCKET;
  const salt = await options.salts.daySalt(ukDateKey(options.now ?? Date.now()));
  return ipBucket(ip, salt, options.kind);
}
