'use client';

import dynamic from 'next/dynamic';
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
 * `next/dynamic` keeps server rendering, so the bar is in the HTML and
 * nothing moves when its chunk arrives; Next preloads the chunk with the page
 * that draws it.
 */

/**
 * The bar inside a demo visit, with the generation-change clearing
 * (`session-bar.tsx`). The `(console)` layout renders it only when
 * `areas.demo`.
 */
export const LazySessionDemoBar = dynamic<DemoBarProps>(() => import('./session-bar.js'));

/**
 * The public bar of `/demo`, `/sign-in` and `/signed-out` (§3.8 "Public
 * variant"): badge, countdown, one sentence and Demo details, no polling.
 * `webpackExports` keeps the chunk to `DemoBar` and what it imports rather
 * than the whole shell barrel.
 */
export const LazyPublicDemoBar = dynamic<DemoBarProps>(() =>
  import(/* webpackExports: ["DemoBar"] */ '@itsm/ui/shell').then((module) => module.DemoBar),
);
