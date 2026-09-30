import type { ReactNode } from 'react';
import type { ApprovalRequest, ArticleSummary, CatalogueItem, Page, Ticket } from '@itsm/sdk';
import { Banner, Button, Card, EmptyState, Skeleton, SkeletonList, VisuallyHidden } from '@itsm/ui';
import { topicHref } from '../catalogue/icons.js';
import { RequestRow } from '../components/RequestRow.js';
import { isSevere, type KnownIssue } from '../help/model.js';
import type { StatusRead } from '../help/status.js';
import { GoodToKnow } from './GoodToKnow.js';
import { GuidedTiles } from './GuidedTiles.js';
import { homeRows, popularAnswers, statusSummary, type HomeRow } from './model.js';
import { ResolutionActions } from './ResolutionActions.js';
import { SectionProblem } from './SectionProblem.js';
import type { Settled } from './settle.js';

/**
 * Home's sections (SPEC §6.3), each an async server component in its own
 * `<Suspense>`: it waits only for its own data, fails on its own ("Couldn't
 * load your requests · Retry") and leaves the rest of the page usable.
 *
 * Server components that import only what the design system's root entry
 * defines directly (no display, controls or form-kit group barrels), so a
 * section costs the client nothing beyond the components it draws.
 */

/* ---------------------------------------------------------- Incident banner */

/**
 * "VPN is degraded. We know about it · updated 10:42 · Follow updates" — the
 * worst open incident on the status page, above everything else on Home. It
 * is news, not an interruption: a status region, not an alert.
 */
export function IncidentBanner({
  issues,
  followUrl,
  updatedLabel,
}: {
  readonly issues: readonly KnownIssue[];
  readonly followUrl: string | null;
  readonly updatedLabel: string;
}): ReactNode {
  const [first] = issues;
  if (!first) return null;
  const more = issues.length - 1;
  return (
    <Banner
      tone={isSevere(first) ? 'danger' : 'warning'}
      className="app-Home__incident"
      title={`${first.title.replace(/[\s.!?]+$/, '')}. We’re on it.`}
      {...(followUrl ? { action: { id: 'follow', label: 'Follow updates', href: followUrl, external: true, variant: 'secondary' } } : {})}
    >
      {first.components.length > 0 ? `Affects ${first.components.join(', ')} · ` : ''}Updated {updatedLabel}
      {more > 0 ? ` · ${more} more open ${more === 1 ? 'issue' : 'issues'}` : ''}
    </Banner>
  );
}

/* ------------------------------------------------------------ Your requests */

function RowActions({ row }: { readonly row: HomeRow }): ReactNode {
  switch (row.action) {
    case 'reply':
      return (
        <Button size="sm" variant="tinted" iconStart="reply" href={`/tickets/${encodeURIComponent(row.ticket.number)}#reply`}>
          Reply<VisuallyHidden> to {row.ticket.title}</VisuallyHidden>
        </Button>
      );
    case 'confirm':
      return row.version === undefined ? null : <ResolutionActions number={row.ticket.number} version={row.version} title={row.ticket.title} />;
    case 'review':
      return (
        <Button size="sm" variant="tinted" iconStart="approvals" href={row.href ?? '/approvals'}>
          Review<VisuallyHidden>: {row.ticket.title}</VisuallyHidden>
        </Button>
      );
    default:
      return null;
  }
}

function RequestsHeading(): ReactNode {
  return (
    <div className="app-Home__sectionHead">
      <h2 id="home-requests" className="app-Home__sectionTitle">
        Your requests
      </h2>
      <Button variant="ghost" size="sm" href="/tickets" iconEnd="chevron-right">
        See all<VisuallyHidden> your requests</VisuallyHidden>
      </Button>
    </div>
  );
}

export async function YourRequests({
  requests,
  approvals,
}: {
  readonly requests: Promise<Settled<Page<Ticket>>>;
  readonly approvals: Promise<readonly ApprovalRequest[] | null>;
}): Promise<ReactNode> {
  const [mine, waiting] = await Promise.all([requests, approvals]);
  const rows = mine.ok ? homeRows(mine.value.data, waiting) : homeRows([], waiting);

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
        <ul className="app-RequestList">
          {rows.map((row) =>
            row.approval ? (
              <RequestRow
                key={row.key}
                ticket={row.ticket}
                href={row.href ?? '/approvals'}
                state={{ label: 'Approval waiting', tone: 'warning', icon: 'approvals' }}
                next={null}
                yours
                actions={<RowActions row={row} />}
              />
            ) : (
              <RequestRow key={row.key} ticket={row.ticket} {...(row.action ? { actions: <RowActions row={row} /> } : {})} />
            ),
          )}
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

export function YourRequestsSkeleton(): ReactNode {
  return (
    <section className="app-Home__section" aria-labelledby="home-requests">
      <RequestsHeading />
      <SkeletonList rows={3} label="Loading your requests" className="app-Home__skeleton" />
    </section>
  );
}

/* ------------------------------------------------------------ Guided tiles */

function TilesHeading(): ReactNode {
  return (
    <h2 id="home-topics" className="app-Home__sectionTitle">
      Browse by topic
    </h2>
  );
}

export async function Topics({ catalogue }: { readonly catalogue: Promise<Settled<{ data: CatalogueItem[] }>> }): Promise<ReactNode> {
  const read = await catalogue;
  // A failed catalogue still leaves working tiles: each falls back to Services searched for its word.
  const services = read.ok
    ? [...new Map(read.value.data.filter((item) => item.service).map((item) => [item.serviceKey ?? item.service, { key: item.serviceKey, name: item.service ?? '' }])).values()]
    : [];
  return (
    <section className="app-Home__section" aria-labelledby="home-topics">
      <TilesHeading />
      <GuidedTiles accessHref={topicHref('access', services)} devicesHref={topicHref('devices', services)} />
    </section>
  );
}

export function TopicsSkeleton(): ReactNode {
  return (
    <section className="app-Home__section" aria-labelledby="home-topics" aria-busy="true">
      <TilesHeading />
      <div className="app-Home__tilesSkeleton" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="var(--app-home-tile-height)" radius="xl" />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Good to know */

export async function GoodToKnowSection({
  status,
  articles,
  channels,
  canBrowseKnowledge,
  drawnAt,
}: {
  readonly status: StatusRead;
  readonly articles: Promise<Settled<ArticleSummary[]>> | null;
  readonly channels: readonly string[];
  readonly canBrowseKnowledge: boolean;
  readonly drawnAt: string;
}): Promise<ReactNode> {
  const read = articles ? await articles : null;
  return (
    <GoodToKnow
      status={status.status ? statusSummary(status.status) : null}
      statusFailed={status.failed}
      answers={read?.ok ? popularAnswers(read.value) : []}
      channels={channels}
      canBrowseKnowledge={canBrowseKnowledge}
      drawnAt={drawnAt}
    />
  );
}

export function GoodToKnowSkeleton(): ReactNode {
  return <Card title="Good to know" titleAs="h2" loading className="app-Home__aside" />;
}
