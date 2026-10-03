'use client';

import { useEffect, type ReactNode } from 'react';
import { DemoBar, onDemoGenerationChange, type DemoBarProps } from '@itsm/ui/shell';

export interface LoadedDemoBarProps extends DemoBarProps {
  /**
   * Session bars: the app's own keys to forget when the demo's data is reset
   * under the visitor (`isPersonalKey` in the Service Desk), besides the
   * caches, the outbox and the drafts `clearDemoLocalData` always clears.
   */
  readonly clearKeys?: (key: string) => boolean;
}

/**
 * The demo bar as the slot loads it: one chunk, fetched only where a bar is
 * drawn (`DemoBarSlot`).
 *
 * In a session it also answers the bar's "the data was reset" event (S11, A3
 * §6.10): it clears this device's copies of the visit's work before the bar
 * shows its notice, which waits for the promise. Here, rather than in the
 * frame, so the listener costs nothing on a real person's pages and arrives
 * with the module the bar needs anyway; the clearing itself is fetched only
 * when a reset happens.
 */
export default function DemoBarLoaded({ clearKeys, ...props }: LoadedDemoBarProps): ReactNode {
  const session = props.variant === 'session';
  useEffect(() => {
    if (!session) return undefined;
    return onDemoGenerationChange((generation) =>
      import('@itsm/pwa/demo').then(({ clearDemoLocalData }) => clearDemoLocalData({ generation, ...(clearKeys ? { alsoKeys: clearKeys } : {}) })),
    );
  }, [session, clearKeys]);
  return <DemoBar {...props} />;
}
