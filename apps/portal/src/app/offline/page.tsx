import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AREAS } from '@itsm/contracts/areas';
import { StatusScreen } from '@itsm/ui';
import { uiStylesheet } from '@itsm/ui/styles';
import { AvailableOffline } from './AvailableOffline.js';

export const metadata: Metadata = { title: 'Offline' };

/** Built once: the service worker precaches it on install, before anything else has been visited. */
export const dynamic = 'force-static';

/**
 * The page the service worker serves when there is no network and no cached
 * copy of what was asked for (SPEC §6.3).
 *
 * It carries the design system's sheet inline as well as linked: the linked
 * copy may never have been cached on this device, and an offline page that
 * renders unstyled reads as broken exactly when somebody needs it to be calm.
 * It says what is true and what is still possible — the pages this device
 * kept, and that the three things the portal queues (a report, a reply, an
 * approval decision) still go when sent from one of them — because "you are
 * offline" on its own reads as "stop".
 *
 * v3 (§7.2, A6 §6.12): the area lockup names the Help Portal from the one
 * area model (D1), and the way back is the area's home, both from
 * `@itsm/contracts/areas` (zod-free, so the precached page stays light).
 */
export default function OfflinePage(): ReactNode {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: uiStylesheet() }} />
      <StatusScreen
        brand="portal"
        brandName={AREAS.portal.name}
        illustration="offline"
        title="You’re offline"
        body={
          <>
            <p>This page hasn’t been opened on this device yet, so there’s no copy of it to show. Pages you’ve opened before are still readable, and a report, reply or approval decision you send from one is kept and sent when you’re back online.</p>
            <AvailableOffline />
          </>
        }
        actions={[{ id: 'home', label: 'Back to Home', href: AREAS.portal.home, variant: 'primary' }]}
      />
    </>
  );
}
