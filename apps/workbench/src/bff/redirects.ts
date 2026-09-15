/**
 * Where a sign-in is allowed to land.
 *
 * `?redirectTo=` is the classic open redirect: the value is attacker-supplied,
 * it survives the round trip to the identity provider, and a phishing page that
 * borrows this app's sign-in flow and then lands the person somewhere else is
 * indistinguishable from the real thing right up to the last hop.
 *
 * Only a path on this origin is allowed, and the checks are about the shapes a
 * browser will treat as absolute rather than about substrings:
 *
 *   - `//evil.example` is protocol-relative and resolves off-origin;
 *   - `/\evil.example` is the same thing in browsers that normalise the slash;
 *   - `https://evil.example` is absolute;
 *   - a backslash or a control character anywhere invites the same
 *     normalisation difference between what is checked and what is followed.
 */

export const DEFAULT_LANDING = '/queue';

export function safeRedirectTarget(value: string | null | undefined, fallback = DEFAULT_LANDING): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  if ([...value].some((character) => (character.codePointAt(0) ?? 0) < 0x20)) return fallback;
  return value;
}
