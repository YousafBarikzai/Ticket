import { randomBytes, randomUUID } from 'node:crypto';

/**
 * UUID v7: a 48-bit big-endian timestamp followed by random bits (ADR-0020).
 * Time-ordered, so primary-key inserts stay at the right edge of the B-tree
 * instead of fragmenting it the way v4 does at volume.
 */
export function newId(at: Date = new Date()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(at.getTime());

  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The millisecond timestamp encoded in a v7 identifier. */
export function idTimestamp(id: string): Date {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** A correlation identifier for a request, job or event chain. */
export function newCorrelationId(): string {
  return randomUUID();
}
