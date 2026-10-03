import type { ReactNode } from 'react';
import type { ApprovalRequest, ArticleSummary, CatalogueItem, Page, PublicStatus, Ticket } from '@itsm/sdk';
import { Button, EmptyState, SectionHeader, Skeleton, VisuallyHidden } from '@itsm/ui';
import { CommonRequests } from './CommonRequests.js';
import { HomeAside } from './HomeAside.js';
import { approvalsLabel, comingUp, homeRows, openLabel, popularAnswers, quickCounts } from './model.js';
import { QuickActions, type QuickActionsProps } from './QuickActions.js';
import { RequestCard } from './RequestCard.js';
import { SectionProblem } from './SectionProblem.js';
import type { Settled } from './settle.js';

/**
 * Home's streamed sections (v3 §7.2, A6 §6.1), each an async server component
 * in its own `<Suspense>`: it waits only for its own data, fails on its own
 * ("Couldn't load your requests · Retry") and leaves the rest of the page
 * usable. Every read was started by the page at once; these only await.
 *
 * Server components that import from the design system's root, which the
 * app's `optimizePackageImports` rewrites to each defining module, so a
 * section costs the client nothing beyond the islands it draws.
 */

/* ------------------------------------------------------------ Quick actions */

export async function HomeQuickActions({
  can,
  requests,
  approvals,
}: {
  readonly can: QuickActionsProps['can'];
  readonly requests: Promise<Settled<Page<Ticket>>>;
  readonly approvals: Promise<readonly ApprovalRequest[] | null>;
}): Promise<ReactNode> {
  const [mine, waiting] = await Promise.all([requests, approvals]);
  const counts = quickCounts(mine.ok ? mine.value : null, waiting);
  return <QuickActions can={can} openLabel={openLabel(counts)} approvalsLabel={approvalsLabel(counts)} />;
}

/* ------------------------------------------------------------ Your requests */

function RequestsHeading(): ReactNode {
  return (
    <SectionHeader
      id="home-requests"
      title="Your requests"
      actions={
        <Button variant="ghost" size="sm" href="/tickets" iconEnd="chevron-right">
          See all<VisuallyHidden> your requests</VisuallyHidden>
        </Button>
      }
    />
  );
}

export async function YourRequests({
  requests,
  approvals,
  drawnAt,
}: {
  readonly requests: Promise<Settled<Page<Ticket>>>;
  readonly approvals: Promise<readonly ApprovalRequest[] | null>;
  /** When the page was drawn (ISO): "Oldest 1 day" is counted from it. */
  readonly drawnAt: string;
}): Promise<ReactNode> {
  const [mine, waiting] = await Promise.all([requests, approvals]);
  const rows = mine.ok ? homeRows(mine.value.data, waiting) : homeRows([], waiting);
  const now = new Date(drawnAt);

  let body: ReactNode;
  if (!mine.ok && rows.length === 0) {
    body = <SectionProblem what="your requests" />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        size="sm"
        tone="success"
        icon="circle-check"
        headingLevel={3}
        title="Nothing open. That’s the goal."
        description="When you ask us for something, you’ll follow it here."
      />
    );
  } else {
    body = (
      <>
        <ul className="app-RequestCards">
          {rows.map((row) => (
            <RequestCard key={row.key} row={row} now={now} />
          ))}
        </ul>
        {!mine.ok ? <SectionProblem what="the rest of your requests" /> : null}
      </>
    );
  }

  return (
    <section className="app-Home__section" aria-labelledby="home-requests">
      <RequestsHeading />
      {body}
    </section>
  );
}

/** Three card-shaped ghosts, the shape of what arrives (A6 §6.1.5). */
export function YourRequestsSkeleton(): ReactNode {
  return (
    <section className="app-Home__section" aria-labelledby="home-requests" aria-busy="true">
      <RequestsHeading />
      <div className="app-RequestCards app-RequestCards--ghost" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="var(--app-home-card-height)" radius="lg" className="app-RequestCards__ghost" />
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- Common requests */

export async function HomeCommonRequests({ catalogue }: { readonly catalogue: Promise<Settled<{ data: CatalogueItem[] }>> }): Promise<ReactNode> {
  const read = await catalogue;
  if (!read.ok) {
    return (
      <section className="app-Home__section app-Home__common" aria-label="Common requests">
        <SectionProblem what="common requests" />
      </section>
    );
  }
  return <CommonRequests items={read.value.data} />;
}

/* -------------------------------------------------------------------- Aside */

export async function HomeAsideSection({
  status,
  articles,
  channels,
  canBrowseKnowledge,
  drawnAt,
  locale,
  timeZone,
}: {
  readonly status: PublicStatus | null;
  readonly articles: Promise<Settled<ArticleSummary[]>> | null;
  readonly channels: readonly string[];
  readonly canBrowseKnowledge: boolean;
  readonly drawnAt: string;
  readonly locale: string;
  readonly timeZone: string;
}): Promise<ReactNode> {
  const read = articles ? await articles : null;
  return (
    <HomeAside
      answers={read?.ok ? popularAnswers(read.value) : []}
      comingUp={comingUp(status, new Date(drawnAt), locale, timeZone)}
      channels={channels}
      canBrowseKnowledge={canBrowseKnowledge}
      locale={locale}
    />
  );
}

export function HomeAsideSkeleton(): ReactNode {
  return (
    <div className="app-HomeAside" aria-hidden="true">
      <Skeleton height="var(--app-home-aside-height)" radius="lg" />
    </div>
  );
}
