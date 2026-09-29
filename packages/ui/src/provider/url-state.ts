'use client';

import { useMemo } from 'react';
import { useItsm } from './ItsmProvider.js';

/**
 * How a piece of page state lives in the query string. `serialise` returns
 * `undefined` for a parameter that should be absent, so defaults never
 * clutter a shareable URL.
 */
export interface UrlCodec<T> {
  parse(params: URLSearchParams): T;
  serialise(value: T): Record<string, string | undefined>;
}

export interface UrlStateOptions {
  /**
   * `true` writes with `history.replaceState`/`pushState` and no server
   * render — for drawers, selection and view-only state (D12). Otherwise the
   * app router replaces the URL inside a transition, for state the server
   * reads (filters, sort, search).
   */
  readonly shallow?: boolean;
  readonly history?: 'replace' | 'push';
}

export type UrlStateSetter<T> = (next: Partial<T>) => void;

/**
 * Page state kept in the URL, so every filtered list is shareable and Back
 * does what people expect. Changing any filter drops the pagination `cursor`.
 *
 * Stub (SPEC §4.1): reads the current value through the provider; the setter
 * does nothing yet. The foundations package writes it (router vs history) and
 * tests both paths.
 */
export function useUrlState<T>(
  codec: UrlCodec<T>,
  options: UrlStateOptions = {},
): [T, UrlStateSetter<T>, { isPending: boolean }] {
  void options;
  const { useSearchParams } = useItsm();
  const params = useSearchParams();
  const value = useMemo(() => codec.parse(new URLSearchParams(params)), [codec, params]);
  return [value, ignore, idle];
}

function ignore(): void {}
const idle = { isPending: false } as const;
