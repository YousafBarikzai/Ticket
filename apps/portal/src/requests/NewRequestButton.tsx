'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { useHelpFlow } from '../components/PortalShell.js';

/**
 * My requests' own New request (SPEC §6.3, X-84): the page's one primary
 * action, where the top bar's is hidden. It opens "How can we help?"; it is
 * not there at all for somebody who may not raise anything.
 */
export function NewRequestButton(): ReactNode {
  const helpFlow = useHelpFlow();
  if (!helpFlow.available) return null;
  return (
    <Button variant="primary" shape="capsule" iconStart="plus" className="app-Requests__new" onClick={() => helpFlow.open()}>
      New request
    </Button>
  );
}
