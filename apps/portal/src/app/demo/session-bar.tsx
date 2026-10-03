'use client';

import { useEffect, type ReactNode } from 'react';
import { DemoBar, onDemoGenerationChange, type DemoBarProps } from '@itsm/ui/shell';

/**
 * The demo bar inside a demo visit, with the one thing the bar cannot do for
 * itself: clear this device's copies of the visit's data when the demo is
 * rebuilt underneath it (SPEC v3 §3.8, A3 §6.10, S11).
 *
 * The bar's watch announces a newer generation with
 * `itsm:demo-generation-change` and waits for the work handed back before it
 * shows "Demo data was reset…": `@itsm/ui` does not depend on `@itsm/pwa`,
 * and only the portal knows which of its browser keys are the person's
 * (`isPersonalKey`, the sign-out's list). Both modules are fetched only then —
 * a generation change happens once a night at most.
 *
 * Loaded only by the frame's `next/dynamic` in a demo visit (`PortalShell`), so none of this is
 * in any route's first load.
 */
export function clearForGeneration(generation: number): Promise<unknown> {
  return Promise.all([import('@itsm/pwa/demo'), import('../../components/PortalStatus.js')]).then(([{ clearDemoLocalData }, { isPersonalKey }]) =>
    clearDemoLocalData({ generation, alsoKeys: isPersonalKey }),
  );
}

export default function SessionDemoBar(props: DemoBarProps): ReactNode {
  useEffect(() => onDemoGenerationChange(clearForGeneration), []);
  return <DemoBar {...props} />;
}
