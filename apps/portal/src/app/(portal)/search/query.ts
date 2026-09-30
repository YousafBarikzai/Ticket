/** How many of each kind the results page shows before "See all". */
export const SECTION_LIMIT = 6;

/** The words searched for, tidied: one value, trimmed, at most 200 characters. */
export function queryOf(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? '';
}
