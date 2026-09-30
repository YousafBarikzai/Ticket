import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { EmptyState } from '@itsm/ui';
import { ReportFlow } from '../../../help/ReportFlow.js';
import { knownIssuesFrom } from '../../../help/model.js';
import { followUrlFor, readStatus } from '../../../help/status.js';
import { mayOpen, portalCan } from '../../../navigation.js';
import { apiFor, currentMe, heldPermissions, requireSession } from '../../../server/session.js';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Report an issue' };

/**
 * `/report` — "How can we help?" as a page (SPEC §6.3, D17, Y-1.3.5).
 *
 * The sheet is how most people meet this flow; the page is for the rest: the
 * home-screen shortcut, a link somebody was sent, and *New request* with no
 * network, which comes here because the service worker keeps this page and
 * the flow queues. Its `?q=` (from a link or the search results) starts the
 * details with those words as the title.
 *
 * The status page is read here, on the server, so "Is it this?" can name an
 * open incident as they type; it never holds the page up for long.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const held = heldPermissions(me);

  if (!mayOpen('/report', held)) {
    return (
      <div className="app-Page app-Page--reading app-Report">
        <header className="app-Report__header">
          <h1 className="app-Report__title" tabIndex={-1}>
            Report an issue
          </h1>
        </header>
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="You can’t report issues here"
          description="Your account can look things up but not raise requests. If you think it should, ask your IT team."
          action={{ id: 'home', label: 'Go to Home', href: '/' }}
        />
      </div>
    );
  }

  const query = (await searchParams).q;
  const text = (Array.isArray(query) ? query[0] : query)?.trim().slice(0, 500) ?? '';
  const can = portalCan(held);
  const { status } = await readStatus(apiFor(session), me.tenant?.slug);

  return (
    <div className="app-Page app-Page--reading app-Report">
      <header className="app-Report__header">
        <h1 className="app-Report__title" tabIndex={-1}>
          Report an issue
        </h1>
        <p className="app-Report__lede">Tell us what’s wrong in your own words. We’ll look for an answer as you type, and if there isn’t one, it goes straight to the service desk.</p>
      </header>
      <ReportFlow
        userId={me.actor.id}
        can={{ search: can.search, readKnowledge: can.readKnowledge, readCatalogue: can.readCatalogue }}
        knownIssues={{ issues: knownIssuesFrom(status), followUrl: followUrlFor(status) }}
        {...(text ? { start: { step: 'details' as const, text } } : {})}
      />
    </div>
  );
}
