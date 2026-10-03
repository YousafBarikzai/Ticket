'use client';

import type { ReactNode } from 'react';
import { Button, IconTile } from '@itsm/ui';
import { useHelpFlow } from '../components/PortalShell.js';
import { HomeSearch, type HomeSearchProps } from './HomeSearch.js';

/**
 * The hero's two ways forward (SPEC §6.3, v3 §7.2): the search field, and
 * *New request* — Home's one primary action, which is why the top bar leaves
 * its own out on this page (X-84). Both lead into "How can we help?". Without
 * `ticket.create` there is only the search. On a phone *New request* keeps
 * its place in the search row as an icon button with the same name (A6
 * §6.1.4), so the hero stays one row shorter.
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

/**
 * The "Report an issue" quick action (A6 §6.1.2): the one tile that is not a
 * link, because it opens "How can we help?" at its first step where the
 * other three go to a page. It lives here, beside the hero's other client
 * code, so the server-drawn tile row adds no module of its own to Home's
 * first load; it draws the same parts as its server siblings.
 */
export function ReportTile(): ReactNode {
  const help = useHelpFlow();
  return (
    <button type="button" className="app-QuickAction" data-quick-action="report" aria-haspopup="dialog" onClick={() => help.open({ step: 'describe' })}>
      <IconTile icon="flag" size={40} />
      <span className="app-QuickAction__text">
        <span className="app-QuickAction__label">Report an issue</span>
        <span className="app-QuickAction__sub">Tell us what’s wrong</span>
      </span>
    </button>
  );
}
