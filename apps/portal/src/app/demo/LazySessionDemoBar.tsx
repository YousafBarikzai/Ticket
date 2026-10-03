'use client';

import dynamic from 'next/dynamic';
import { Suspense, type ReactNode } from 'react';
import type { DemoBarProps } from '@itsm/ui/shell';

/**
 * The demo bar inside a demo visit, as an async chunk (SPEC v3 §3.8, §10.2;
 * the portal's budget).
 *
 * `DemoBar` is server-safe, but the two islands it renders — the countdown
 * and the Info and Reset controls, about 3 kB — are client components, and
 * Next puts every client component a layout *can* render into the first load
 * of every route under it, rendered or not; a Server Component's `import()`
 * does not split them either. On the Help Portal that would be weight every
 * real tenant's requester downloads on every page, for a bar they never see.
 *
 * So the `(portal)` layout renders this instead, and only in a demo visit:
 * `next/dynamic` loads the bar (`session-bar.tsx`) when it is rendered. The
 * server still renders its markup into the page — no flash, no shift — the
 * chunk is preloaded with the page, and this Suspense boundary lets the rest
 * of the page hydrate while it arrives.
 */
const SessionBar = dynamic(() => import('./session-bar.js'));

export function LazySessionDemoBar(props: Omit<DemoBarProps, 'variant'>): ReactNode {
  return (
    <Suspense fallback={null}>
      <SessionBar {...props} variant="session" />
    </Suspense>
  );
}
