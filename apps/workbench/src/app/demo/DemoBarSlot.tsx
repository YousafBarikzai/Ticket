'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { DemoBarProps } from '@itsm/ui/shell';

/**
 * The demo bar, fetched only where it is drawn (v3 §3.8, §10.2).
 *
 * `DemoBar` is server-safe, but its two islands — the countdown and the
 * Details and Reset controls, about 3 kB with the demo's copy — would be
 * client references of any server component that imports it, and so first
 * load on every page of the Service Desk, demo or not. The Service Desk has
 * about 1.3 kB of growth left on its inbox. So the bar is loaded through
 * this one small client module, as its own chunk, and the `(desk)` layout
 * and the pages outside the frame render it only when there is a demo to
 * show: a real person's pages carry this module's few bytes and never the
 * bar.
 *
 * Rendered on the server like any other component (`next/dynamic` keeps
 * server rendering), so the bar is in the HTML and nothing moves when the
 * chunk arrives; the chunk is preloaded with the page that needs it.
 * `webpackExports` keeps the chunk to `DemoBar` and what it imports rather
 * than the whole shell barrel.
 *
 * It lives beside `/demo` because it is the demo's: the frame, `/sign-in`
 * and `/signed-out` import it from here.
 */
const DemoBar = dynamic(() => import(/* webpackExports: ["DemoBar"] */ '@itsm/ui/shell').then((module) => module.DemoBar));

export function DemoBarSlot(props: DemoBarProps): ReactNode {
  return <DemoBar {...props} />;
}
