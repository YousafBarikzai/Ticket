import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * What the gateway is allowed to connect to.
 *
 * A connector's URL is configured by a tenant administrator, which makes it
 * attacker-controllable in any multi-tenant platform: an administrator is a
 * customer's employee, not ours. Without this, "call this URL when a ticket is
 * raised" is a request-forgery primitive pointed at our own network — and the
 * highest-value target is not some internal service, it is
 * `169.254.169.254`, where a cloud provider hands out instance credentials to
 * anything that asks.
 *
 * So the rule is an allowlist of *public* addresses rather than a blocklist of
 * known-bad hosts. A blocklist of hostnames is defeated by an IP literal, by a
 * name that resolves to a private address, and by IPv6 forms of the same
 * ranges — all of which are ordinary, not clever.
 */

export interface AddressVerdict {
  allowed: boolean;
  reason?: string;
  /** The addresses the hostname resolved to, so the caller can pin them. */
  addresses?: string[];
}

/** Ranges that are never a legitimate destination for a tenant's connector. */
const BLOCKED_V4: [string, number, string][] = [
  ['0.0.0.0', 8, 'this host'],
  ['10.0.0.0', 8, 'a private network'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'the loopback interface'],
  ['169.254.0.0', 16, 'link-local, where cloud instance credentials live'],
  ['172.16.0.0', 12, 'a private network'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'a private network'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function v4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Why this address is not allowed, or null if it is. */
export function refuseAddress(address: string): string | null {
  const family = isIP(address);

  if (family === 4) {
    const value = v4ToInt(address);
    if (value === null) return 'it is not a valid address';
    for (const [base, bits, why] of BLOCKED_V4) {
      const baseValue = v4ToInt(base)!;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return why;
    }
    return null;
  }

  if (family === 6) {
    const normalised = address.toLowerCase().split('%')[0]!;

    // An IPv4-mapped address is an IPv4 address wearing a hat, and is the
    // obvious way round a check that only looks at the textual form.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
    if (mapped) return refuseAddress(mapped[1]!);

    if (normalised === '::' || normalised === '::0') return 'this host';
    if (normalised === '::1') return 'the loopback interface';
    if (normalised.startsWith('fe80:')) return 'link-local';
    // fc00::/7 — unique local, the IPv6 equivalent of a private network.
    if (/^f[cd]/.test(normalised)) return 'a private network';
    if (normalised.startsWith('ff')) return 'multicast';
    if (normalised.startsWith('2001:db8')) return 'documentation';
    return null;
  }

  return 'it is not a valid address';
}

/**
 * Whether the gateway may connect to this URL.
 *
 * Resolution happens here, and the resolved addresses are returned so the
 * caller can connect to one of *them* rather than to the hostname again. A
 * name that resolves to a public address for the check and a private one for
 * the connection — DNS rebinding — is the whole reason this returns addresses
 * instead of a boolean.
 */
export async function checkDestination(
  rawUrl: string,
  resolver: (host: string) => Promise<{ address: string }[]> = defaultResolver,
): Promise<AddressVerdict> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'that is not a URL' };
  }

  if (url.protocol !== 'https:') {
    // Not http: a connector carries a credential, and the platform will not
    // put one on the wire in plaintext however the administrator configured it.
    return { allowed: false, reason: 'connectors must use https' };
  }

  if (url.username || url.password) {
    // Credentials in a URL end up in logs, in `Referer`, and in the audit
    // trail. They belong in the credential store.
    return { allowed: false, reason: 'put the credential in the credential store, not in the URL' };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  const literal = refuseAddress(host);
  if (isIP(host)) {
    return literal ? { allowed: false, reason: `that address is ${literal}` } : { allowed: true, addresses: [host] };
  }

  let addresses: string[];
  try {
    addresses = (await resolver(host)).map((entry) => entry.address);
  } catch {
    return { allowed: false, reason: 'that hostname does not resolve' };
  }

  if (addresses.length === 0) return { allowed: false, reason: 'that hostname does not resolve' };

  for (const address of addresses) {
    const why = refuseAddress(address);
    // Every address, not just the first: a name resolving to one public and one
    // private address must be refused, or the refusal is a coin toss.
    if (why) return { allowed: false, reason: `${host} resolves to ${address}, which is ${why}` };
  }

  return { allowed: true, addresses };
}

async function defaultResolver(host: string): Promise<{ address: string }[]> {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((entry) => ({ address: entry.address }));
}
