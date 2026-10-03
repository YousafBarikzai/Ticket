'use client';

import { lazy, Suspense, type ReactNode } from 'react';
import type { DemoBarProps } from '@itsm/ui/shell';

/**
 * The demo bar, fetched only where it is drawn (SPEC v3 §3.8, §10.2).
 *
 * `DemoBar` is server-safe, but its two islands — the countdown and the
 * Details and Reset controls — would be client references of any server
 * component that imports it, and so first load on every Administration page,
 * demo or not. So the bar comes through this small client module, as chunks
 * of its own, and the console's layout and the pages outside the frame render
 * it only when there is a demo to show: a real administrator's pages carry
 * these few bytes and never the bar.
 *
 * `React.lazy` rather than `next/dynamic`: React is already on every page,
 * and Next's loadable wrapper put about 1 kB of its own runtime on every
 * route for this one component (measured, WP-42a). The bar is still rendered
 * on the server: its module is in the server's bundle, so the HTML carries
 * the bar in place (only a process's very first render of it streams in a
 * moment later, within the same response). In the browser the server's
 * markup stays where it is while the chunk arrives — the boundary hydrates
 * on its own, so the rest of the page does not wait — and then the islands
 * take over.
 */

const SessionDemoBar = lazy(() => import('./session-bar.js'));

/** `webpackExports` keeps the chunk to `DemoBar` and what it imports rather than the whole shell barrel. */
const PublicDemoBar = lazy(() =>
  import(/* webpackExports: ["DemoBar"] */ '@itsm/ui/shell').then((module) => ({ default: module.DemoBar })),
);

/**
 * The bar inside a demo visit, with the generation-change clearing
 * (`session-bar.tsx`). The `(console)` layout renders it only when
 * `areas.demo`.
 */
export function LazySessionDemoBar(props: DemoBarProps): ReactNode {
  return (
    <Suspense fallback={null}>
      <SessionDemoBar {...props} />
    </Suspense>
  );
}

/**
 * The public bar of `/demo`, `/sign-in` and `/signed-out` (§3.8 "Public
 * variant"): badge, countdown, one sentence and Demo details, no polling.
 */
export function LazyPublicDemoBar(props: DemoBarProps): ReactNode {
  return (
    <Suspense fallback={null}>
      <PublicDemoBar {...props} />
    </Suspense>
  );
}
