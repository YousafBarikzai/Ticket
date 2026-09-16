import { ValidationError } from './errors.js';

/**
 * Reading somebody else's records: a dotted path into a JSON value, and the
 * list of records inside a response. Shared by discovery (MOD-10) and
 * migration (MOD-24), which both spend their lives inside other people's
 * payloads.
 */

/**
 * Reads a dotted path out of a record: `hardware.serial`, `owners[0].id`.
 *
 * Returns `undefined` for anything missing rather than throwing, because a
 * feed that omits an optional field for one device out of four hundred is
 * ordinary, and the caller decides whether that particular absence matters.
 */
export function valueAt(record: unknown, expression: string): unknown {
  let current: unknown = record;
  for (const segment of expression.split('.')) {
    // `owners[0]` and `owners.0` both work; feeds are written by people.
    for (const part of segment.split(/[[\]]/).filter(Boolean)) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(part);
        if (!Number.isInteger(index)) return undefined;
        current = current[index];
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
  }
  return current;
}

/**
 * Pulls the records out of a response body.
 *
 * `recordsPath` because feeds wrap their payload differently — `value` for
 * Microsoft Graph, `Reservations[].Instances[]` for AWS, the bare array for
 * about half of everything else.
 */
export function recordsFrom(body: unknown, recordsPath?: string): unknown[] {
  const found = recordsPath ? valueAt(body, recordsPath) : body;
  if (Array.isArray(found)) return found;
  if (found === null || found === undefined) return [];
  throw new ValidationError(
    recordsPath
      ? `${recordsPath} is not a list of records in what the source returned`
      : 'the source did not return a list of records; say where they are with recordsPath',
  );
}
