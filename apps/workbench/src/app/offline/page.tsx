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
 * copy of what was asked for (SPEC §6.2, F21).
 *
 * It carries the design system's sheet inline as well as linked: the linked
 * copy may never have been cached on this device, and an offline page that
 * renders unstyled — as the old one did, borrowing the portal's classes —
 * reads as broken exactly when somebody needs it to be calm. It says what is
 * true and what is still possible, because "you are offline" on its own
 * reads as "stop". The lockup names the area (D1) and the way back is its
 * home, the Overview.
 */
export default function OfflinePage(): ReactNode {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: uiStylesheet() }} />
      <StatusScreen
        brand="workbench"
        brandName={AREAS.workbench.name}
        illustration="offline"
        title="You’re offline"
        body={
          <>
            <p>This page hasn’t been opened on this device, so there’s no copy of it to show. Pages you’ve opened before are still readable.</p>
            <AvailableOffline />
          </>
        }
        actions={[{ id: 'home', label: 'Go to Overview', href: AREAS.workbench.home, variant: 'primary' }]}
      />
    </>
  );
}
