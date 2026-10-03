'use client';

import dynamic from 'next/dynamic';
import { Suspense, type ReactNode } from 'react';
import type { DemoBarProps } from '@itsm/ui/shell';

/**
 * The public demo bar — badge, countdown, the one sentence and Demo details;
 * no persona, no Reset, never polling (SPEC v3 §3.8) — above `/demo`,
 * `/sign-in` and `/signed-out` while the demo is on here, as an async chunk.
 *
 * Those pages are rendered for real tenants too, where the bar is not drawn,
 * so its islands are loaded only when it is (see `LazySessionDemoBar.tsx`).
 */
const PublicBar = dynamic(() => import(/* webpackExports: ["DemoBar"] */ '@itsm/ui/shell').then((module) => module.DemoBar));

export function LazyPublicDemoBar(props: Omit<DemoBarProps, 'variant'>): ReactNode {
  return (
    <Suspense fallback={null}>
      <PublicBar {...props} variant="public" />
    </Suspense>
  );
}
