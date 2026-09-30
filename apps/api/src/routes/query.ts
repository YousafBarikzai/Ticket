import { z } from 'zod';

/**
 * Query-string helpers shared by the route files.
 *
 * A query string carries text, never a boolean, so a boolean parameter has to
 * be read from the text. `z.coerce.boolean()` is the obvious way to do that
 * and the wrong one: it is `Boolean(value)`, and every non-empty string is
 * truthy, so `?open=false` meant "open only" and `?includeDecided=false`
 * meant "include decided". A client that spelled out the default got the
 * opposite of what it asked for, and the SDK — which sent `false` whenever a
 * caller passed one — was the most common such client.
 */

/**
 * A boolean query parameter: exactly `true` or `false`.
 *
 * Anything else (`1`, `yes`, an empty value, the parameter given twice) is a
 * validation error rather than a guess: a parameter that guesses what a
 * spelling means is how `false` came to mean true, and a 422 tells the caller
 * at once where a guess would have answered a different question quietly.
 *
 * Without an argument the parameter is required; chain `.optional()` when
 * "not given" should mean something different from `false`. With a fallback,
 * an absent parameter reads as that value:
 *
 * ```ts
 * z.object({ open: booleanQuery().optional(), includeInactive: booleanQuery(false) })
 * ```
 */
export function booleanQuery(): z.ZodEffects<z.ZodEnum<['true', 'false']>, boolean, 'true' | 'false'>;
export function booleanQuery(
  fallback: boolean,
): z.ZodEffects<z.ZodDefault<z.ZodEnum<['true', 'false']>>, boolean, 'true' | 'false' | undefined>;
export function booleanQuery(fallback?: boolean) {
  const words = z.enum(['true', 'false']);
  const read = (value: 'true' | 'false'): boolean => value === 'true';
  return fallback === undefined ? words.transform(read) : words.default(fallback ? 'true' : 'false').transform(read);
}
