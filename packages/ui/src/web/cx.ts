/**
 * Class-name joining. Three lines rather than a dependency: the package's
 * dependency budget is spent on React and nothing else, because every byte
 * here lands in the portal's 250 kB initial-JS budget.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
}
