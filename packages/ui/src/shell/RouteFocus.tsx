'use client';

import type { ReactNode } from 'react';

/**
 * Moves focus to the page's `<h1>` when the pathname changes — never when
 * only the query changes, which would yank focus out of a filter someone is
 * using (X-60).
 *
 * Stub (SPEC §4.9): renders nothing and moves nothing; the shell package
 * implements it with its test.
 */
export function RouteFocus(): ReactNode {
  return null;
}
