'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { KnownIssue } from './model.js';

/**
 * The open incidents "How can we help?" checks a description against ("Is it
 * this? VPN is degraded · Follow updates · It's something else").
 *
 * The status page is readable only on the server (it lives outside
 * `/api/v1`, where the browser's proxy cannot reach), so the pages that read
 * it — Home and `/report` — hand what they found to the browser, and the
 * sheet, which the frame loads on its own, reads it from here. Opened on a
 * page that never read the status, the sheet knows what the last such page
 * knew in this tab, or nothing: the check is a courtesy, never a gate.
 */

interface KnownIssuesState {
  readonly issues: readonly KnownIssue[];
  /** The public status page, for "Follow updates". */
  readonly followUrl: string | null;
}

const EMPTY: KnownIssuesState = { issues: [], followUrl: null };

let state: KnownIssuesState = EMPTY;
const listeners = new Set<() => void>();

/** Replaces what is known; the flow redraws. */
export function publishKnownIssues(issues: readonly KnownIssue[], followUrl: string | null): void {
  state = issues.length === 0 && followUrl === null ? EMPTY : { issues, followUrl };
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What the pages have published, redrawn when it changes. Empty on the server. */
export function useKnownIssues(): KnownIssuesState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/** Drops what a server page read into the store, and keeps it current on `router.refresh()`. */
export function KnownIssuesSource({ issues, followUrl }: { readonly issues: readonly KnownIssue[]; readonly followUrl: string | null }): null {
  const signature = JSON.stringify([issues, followUrl]);
  useEffect(() => {
    publishKnownIssues(issues, followUrl);
    // The signature stands for both props: a refresh that brings the same incidents is not a change.
  }, [signature]);
  return null;
}
