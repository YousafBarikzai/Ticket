import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { SERVICE_DESK_OVERVIEW_PURPOSE } from '@itsm/contracts/areas';
import { permissionScope } from '@itsm/sdk';
import { DashboardGrid, GridItem, SkeletonChartCard } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { RefreshOnLive } from '../../../components/RefreshOnLive.js';
import { mayOpen } from '../../../navigation.js';
import { currentMe, heldPermissions } from '../../../server/session.js';
import {
  loadBreachedByPriority,
  loadBySla,
  loadClocks,
  loadDueTodayByPriority,
  loadAnalytics,
  loadIncident,
  loadOldestUnassigned,
  loadOnCall,
  loadOpenByPriority,
  loadOpenRows,
  loadReplies,
  loadResolvedCounts,
  loadResolvedRows,
  loadTeamByStatus,
  loadUnassignedCount,
  loadUnassignedUrgent,
  loadWaitingByStatus,
  loadWaitingRows,
} from '../../../overview/data.js';
import { RANGE_DAYS, overviewHref, overviewQuery, periods, seriesSince, todayWindow, type SearchParams } from '../../../overview/derive.js';
import {
  AnalyticsRow,
  AnalyticsSkeleton,
  HeroSkeleton,
  IncidentBanner,
  KpiSkeleton,
  NeedsYou,
  OverviewForbidden,
  OverviewHero,
  OverviewJumps,
  OverviewKpis,
  OverviewToolbar,
  PriorityCard,
  StatusCard,
  TimeLeft,
  WaitingAndOnCall,
  type OverviewContext,
} from '../../../overview/sections.js';
import '../../../overview/overview.css';

/**
 * `/overview` — the Service Desk's home (SPEC v3 §7.1.1; A6 §5.2): the
 * queue at a glance for whoever holds `ticket.read`.
 *
 * A server page of cards. Everything it reads is started here, together,
 * and each card waits only on its own reads inside its own `<Suspense>`, so
 * the slowest card holds back nobody else and a failed read costs one card.
 * The analytics row is decided before any call (D9): a reader without
 * `analytics.read` gets no trend and no attainment, and the page asks
 * nothing of `/analytics`. `RefreshOnLive` renders it again on the server
 * when a ticket changes (10 s after the burst), on reconnect, and on coming
 * back to a tab left for a minute.
 */

/** Rendered per request: a dashboard of "now" that a cache served would be a wrong one. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const me = await currentMe();
  const held = heldPermissions(me);
  if (!mayOpen(held, '/overview')) {
    return (
      <div className="app-Overview">
        <PageHeader title="Overview" purpose={SERVICE_DESK_OVERVIEW_PURPOSE} />
        <OverviewForbidden />
      </div>
    );
  }

  const allTeams = permissionScope(me, 'ticket.read') === 'any';
  const teamScope = me.teamIds.length > 0 || allTeams;
  const query = overviewQuery(await searchParams, { teamScope });
  const now = new Date();
  const timeZone = me.timeZone || 'UTC';
  const today = todayWindow(now, timeZone);
  const period = periods(now, timeZone, RANGE_DAYS[query.range]);
  const ctx: OverviewContext = {
    query,
    now,
    asAt: now.toISOString(),
    locale: me.locale || 'en-GB',
    timeZone,
    me: { id: me.actor.id, name: me.actor.displayName ?? 'You' },
    held,
    analytics: permissionScope(me, 'analytics.read') !== null,
    teamScope,
    teamLabel: allTeams ? 'All teams' : 'My teams',
    teamWords: allTeams ? 'across all teams' : 'in your teams',
    today: { start: today.start.toISOString(), end: today.end.toISOString() },
    period: { start: period.start.toISOString(), previousStart: period.previousStart.toISOString(), days: RANGE_DAYS[query.range] },
    retryHref: overviewHref(query),
  };

  // Start every read now, so the cards wait together rather than in turn;
  // each card asks again and `cache()` hands it the same answer.
  void Promise.all([
    loadOpenRows(query.scope),
    loadOpenRows('mine'),
    loadWaitingRows(query.scope),
    loadOpenByPriority(query.scope),
    loadWaitingByStatus(query.scope),
    loadBySla(query.scope),
    loadBreachedByPriority(query.scope),
    loadDueTodayByPriority(query.scope, ctx.today.start, ctx.today.end),
    loadResolvedCounts(query.scope, ctx.period.start, ctx.period.previousStart),
    loadResolvedRows(query.scope, seriesSince(now, timeZone, RANGE_DAYS[query.range])),
    loadUnassignedCount(),
    loadOldestUnassigned(),
    loadUnassignedUrgent(),
    loadTeamByStatus(),
    loadReplies(),
    loadClocks(query.scope),
    ...(held.has('incident.major.read') ? [loadIncident()] : []),
    ...(held.has('workload.read') ? [loadOnCall()] : []),
    // D9: asked only of a reader who holds analytics.
    ...(ctx.analytics ? [loadAnalytics(query.range)] : []),
  ]).catch(() => undefined);

  return (
    <div className="app-Overview">
      <PageHeader title="Overview" purpose={SERVICE_DESK_OVERVIEW_PURPOSE} />
      <RefreshOnLive />
      <Suspense fallback={null}>
        <IncidentBanner ctx={ctx} />
      </Suspense>
      <OverviewToolbar ctx={ctx} />
      <OverviewJumps ctx={ctx} />
      <Suspense fallback={<HeroSkeleton />}>
        <OverviewHero ctx={ctx} />
      </Suspense>
      <Suspense fallback={<KpiSkeleton />}>
        <OverviewKpis ctx={ctx} />
      </Suspense>
      <DashboardGrid>
        <Suspense fallback={<CardSkeleton span={7} title="Needs you" />}>
          <NeedsYou ctx={ctx} />
        </Suspense>
        <Suspense fallback={<CardSkeleton span={5} title="Time left" />}>
          <TimeLeft ctx={ctx} />
        </Suspense>
        {ctx.analytics ? (
          <Suspense fallback={<AnalyticsSkeleton />}>
            <AnalyticsRow ctx={ctx} />
          </Suspense>
        ) : null}
        <Suspense fallback={<CardSkeleton span={6} title={query.scope === 'mine' ? 'My work by priority' : 'Team work by priority'} height={200} />}>
          <PriorityCard ctx={ctx} />
        </Suspense>
        <Suspense fallback={<CardSkeleton span={6} title="Team queue by status" height={200} />}>
          <StatusCard ctx={ctx} />
        </Suspense>
        <Suspense fallback={<CardSkeleton span={12} title="Waiting on others" />}>
          <WaitingAndOnCall ctx={ctx} />
        </Suspense>
      </DashboardGrid>
    </div>
  );
}

/** A card's place while it loads, at the height it will have. */
function CardSkeleton({ span, title, height = 336 }: { readonly span: 5 | 6 | 7 | 12; readonly title: string; readonly height?: number }): ReactNode {
  return (
    <GridItem span={span}>
      <SkeletonChartCard height={height} label={`Loading ${title}`} />
    </GridItem>
  );
}
