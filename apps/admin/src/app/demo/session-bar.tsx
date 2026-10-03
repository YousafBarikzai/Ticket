'use client';

import { useEffect, type ReactNode } from 'react';
import { DemoBar, onDemoGenerationChange, type DemoBarProps } from '@itsm/ui/shell';
import { forgetForGeneration } from '../../client/sign-out.js';

/**
 * The demo bar inside a demo visit, with the one thing the bar cannot do for
 * itself: forget this device's copies of the visit when the demo is rebuilt
 * underneath it (SPEC v3 §3.8, A3 §6.10, S11).
 *
 * The bar's watch announces a newer generation with
 * `itsm:demo-generation-change` and waits for the work handed back before it
 * shows "Demo data was reset…": `@itsm/ui` does not depend on `@itsm/pwa`, and
 * only the console knows which of its browser keys are the person's — the
 * same ones signing out forgets (`client/sign-out.ts`).
 *
 * Loaded only through `LazySessionDemoBar` (`bars.tsx`), so none of this is
 * in any route's first load.
 */
export default function SessionDemoBar(props: DemoBarProps): ReactNode {
  useEffect(() => onDemoGenerationChange(forgetForGeneration), []);
  return <DemoBar {...props} />;
}
