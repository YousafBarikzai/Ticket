'use client';

import { useCallback, useMemo, useState } from 'react';
import { useUrlState, type UrlCodec } from '../provider/url-state.js';
import { useLatest } from './latest.js';
import { encodeFilterValue, readDataTableParams, writeDataTableParams, type DataTableParamsConfig, type DataTableViewState } from './model.js';

/** A change to part of a table's view. Lists and records are replaced whole, not merged. */
export type ViewPatch = Partial<DataTableViewState>;
export type ViewSetter = (patch: ViewPatch) => void;

export interface ViewStateResult {
  readonly view: DataTableViewState;
  readonly setView: ViewSetter;
  /** A router navigation for server data is in flight: the table shows its refetch line. */
  readonly isPending: boolean;
}

/**
 * Which parts of the view the server reads. Those go through the router, in a
 * transition, so the page renders the matching rows; everything else — a
 * client-side search, a filter on loaded rows, a sort within the page — is
 * written with `history.replaceState`, which costs no round trip (D12).
 */
export interface ServerParts {
  readonly search: boolean;
  sort(columnId: string): boolean;
  filter(id: string): boolean;
}

function touchesServer(patch: ViewPatch, current: DataTableViewState, server: ServerParts): boolean {
  if (patch.q !== undefined && patch.q !== current.q && server.search) return true;
  if (patch.sort !== undefined) {
    const before = current.sort?.columnId;
    const after = patch.sort?.columnId;
    if ((before && server.sort(before)) || (after && server.sort(after))) return true;
  }
  if (patch.filters) {
    for (const id of new Set([...Object.keys(patch.filters), ...Object.keys(current.filters)])) {
      if (server.filter(id) && encodeFilterValue(patch.filters[id] ?? null) !== encodeFilterValue(current.filters[id] ?? null)) return true;
    }
  }
  return false;
}

/** State held by the component: a table with no `urlKey`, or one rendered outside `ItsmProvider`. */
export function useLocalView(initial: DataTableViewState): ViewStateResult {
  const [view, setState] = useState(initial);
  const setView = useCallback<ViewSetter>((patch) => setState((current) => ({ ...current, ...patch })), []);
  return { view, setView, isPending: false };
}

/**
 * State held in the URL under the table's namespace. Two writers over one
 * codec: the router for the parts the server reads, `history` for the rest.
 * Each shows its change at once (optimistically) while it lands.
 *
 * Needs `ItsmProvider` (the router and the app's `useSearchParams`); callers
 * check for it and fall back to `useLocalView`.
 */
export function useUrlView(config: DataTableParamsConfig, server: ServerParts): ViewStateResult {
  // The codec reads and writes every key the table owns; its identity changes
  // with the configuration, which `useUrlState` reads through a ref.
  const codec = useMemo<UrlCodec<DataTableViewState>>(
    () => ({
      parse: (params) => readDataTableParams(params, config),
      serialise: (value) => writeDataTableParams(value, config),
    }),
    [config],
  );
  const [routed, writeRouted, { isPending }] = useUrlState(codec);
  const [shallow, writeShallow] = useUrlState(codec, { shallow: true });
  // While a router write is in flight its optimistic value is the newest;
  // otherwise the shallow reader has the URL as `history` left it.
  const view = isPending ? routed : shallow;
  const latest = useLatest({ view, server });

  const setView = useCallback<ViewSetter>(
    (patch) => {
      const { view: current, server: parts } = latest.current;
      if (touchesServer(patch, current, parts)) writeRouted(patch);
      else writeShallow(patch);
    },
    [writeRouted, writeShallow],
  );
  return { view, setView, isPending };
}
