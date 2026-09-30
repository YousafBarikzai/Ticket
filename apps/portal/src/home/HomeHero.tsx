'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { useHelpFlow } from '../components/PortalShell.js';
import { HomeSearch, type HomeSearchProps } from './HomeSearch.js';

/**
 * The hero's two ways forward (SPEC §6.3): the search field, and *New
 * request* — Home's one primary action, which is why the top bar leaves its
 * own out on this page (X-84). Both lead into "How can we help?". Without
 * `ticket.create` there is only the search.
 */
export function HomeHero({ can }: HomeSearchProps): ReactNode {
  const help = useHelpFlow();
  return (
    <div className="app-Home__ask">
      <HomeSearch can={can} />
      {can.createTickets ? (
        <Button variant="primary" size="lg" shape="capsule" iconStart="compose" className="app-Home__new" aria-haspopup="dialog" onClick={() => help.open()}>
          New request
        </Button>
      ) : null}
    </div>
  );
}
