/**
 * Class-name joining. A few lines rather than a dependency: every byte here
 * lands in the portal's initial-JS budget, and `clsx` would buy nothing this
 * does not already do (SPEC §2 rejects it).
 *
 * Accepts the values a condition produces — `count > 0 && 'itsm-X--busy'`
 * yields `false`, but `count && …` yields `0` — and keeps only non-empty
 * strings, so a guard written either way never leaves `0` or `true` in the
 * class list.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  let result = '';
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) continue;
    result = result ? `${result} ${value}` : value;
  }
  return result;
}
