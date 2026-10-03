import type { ReactNode } from 'react';
import { attainmentTarget, type MetricResult, type Ticket } from '@itsm/sdk';
import {
  AttentionList,
  Avatar,
  Banner,
  Card,
  EmptyState,
  GridItem,
  HeroCard,
  HeroWhy,
  Icon,
  PRIORITY_LOOK,
  SLA_STATE_LOOK,
  Skeleton,
  SkeletonStat,
  StatusPill,
  Button,
  type AttentionItem,
  type AttentionSeverity,
  type AttentionTab,
  type HeroAside,
  type HeroChip,
  type HeroDimension,
  type HeroTone,
  type HeroWhyItem,
  type PresenceStatus,
  type Problem,
  type Tone,
} from '@itsm/ui';
import { AreaChart, BulletBar, BulletList, ChartCard, DistributionBar, Gauge, StatCard, StatGrid, type BulletRow, type DistributionSegment } from '@itsm/ui/charts';
import { AppLink } from '../app/AppLink.js';
import { CardProblem } from '../components/CardProblem.js';
import { isPending, severityLabel } from '../navigation.js';
import type { Settled } from '../server/settle.js';
import { AssignSlot } from './AssignSlot.js';
import { OverviewControls } from './OverviewControls.js';
import {
  loadAnalytics,
  loadBreachedByPriority,
  loadBySla,
  loadClocks,
  loadDueTodayByPriority,
  loadIncident,
  loadOldestUnassigned,
  loadOnCall,
  loadOpenByPriority,
  loadOpenRows,
  loadPeople,
  loadReplies,
  loadResolvedCounts,
  loadResolvedRows,
  loadTeamByStatus,
  loadTeamByStatusCounts,
  loadUnassignedCount,
  loadUnassignedUrgent,
  loadWaitingByStatus,
  loadWaitingRows,
  type Grouped,
  type LiveIncident,
  type OnCallNow,
  type Probe,
} from './data.js';
import {
  ATTENTION_LABELS,
  ATTENTION_TABS,
  CLOCK_WARN,
  OPEN_SERIES_DAYS,
  PRIORITIES,
  RANGES,
  RANGE_DAYS,
  UNASSIGNED_TARGET_MS,
  UNKNOWN,
  WAITING_ON,
  WAITING_STATES,
  asAtLabel,
  attentionFrom,
  clockLabel,
  compactDuration,
  countBy,
  dayAndTime,
  dailyCounts,
  deriveOpenSeries,
  dueLabel,
  dueToday,
  fromProbe,
  isBreached,
  isDueSoon,
  kpisFrom,
  localDays,
  longDuration,
  nextDue,
  oldestBreach,
  overviewHref,
  prioritySplit,
  seriesSince,
  queueVerdict,
  slip,
  targetName,
  verdictLook,
  type AttentionEntry,
  type AttentionTabId,
  type Clock,
  type Figure,
  type OverviewQuery,
  type VerdictReason,
  type WaitingState,
} from './derive.js';
import { MIN_POINTS, myWorkByPriority, needsYou, queueNarrative, raisedVsResolved, slaMet, teamQueueByStatus, timeLeft, trendLine } from './headlines.js';

/**
 * The Overview's parts (A6 §5.2; SPEC §7.1.1): the toolbar, the navy hero,
 * the six KPI tiles and the cards, each an async server component that
 * waits only on its own reads (`data.ts`) inside the page's `<Suspense>`,
 * and renders `CardProblem` when they fail — the rest of the page stands.
 *
 * Every figure follows the honest-number rules (A6 §3.2 rule 3): a capped
 * count reads "999+", a probe "200+" with its InfoTip, a figure that could
 * not be read "—", never 0. Every colour is a tone from the shared maps:
 * amber is only ever `SLA_STATE_LOOK.due_soon`'s (D5), and a verdict's look
 * is `HEALTH_VERDICT_LOOK`'s (X-M3), so no tone is typed here twice.
 */

/** What every part knows about the request, decided once by the page. */
export interface OverviewContext {
  readonly query: OverviewQuery;
  /** The instant the page judges at, and the same as an ISO string for the charts' "today". */
  readonly now: Date;
  readonly asAt: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly me: { readonly id: string | null; readonly name: string };
  readonly held: ReadonlySet<string>;
  /** D9: whether the reader holds `analytics.read` at any scope. Decided before any call. */
  readonly analytics: boolean;
  /** Whether the scope control is drawn: the reader has teams, or reads every team. */
  readonly teamScope: boolean;
  /** "My teams", or "All teams" for a reader whose ticket scope is the whole tenant. */
  readonly teamLabel: string;
  /** "in your teams", "across all teams". */
  readonly teamWords: string;
  /** Today in the reader's zone, `[start, end)` as instants. */
  readonly today: { readonly start: string; readonly end: string };
  /** The range's period and the one before it, as instants. */
  readonly period: { readonly start: string; readonly previousStart: string; readonly days: number };
  /** This page, for "Try again". */
  readonly retryHref: string;
}

/* ================================================================ helpers */

/** A figure as a `StatCard` takes it: `null` reads "—", a lower bound "200+" or "999+". */
function tileValue(figure: Figure): { readonly value: number | null; readonly approx?: 'atLeast' } {
  return figure.atLeast ? { value: figure.value, approx: 'atLeast' } : { value: figure.value };
}

const HOUR_MS = 3_600_000;

/** The InfoTip line a probe figure carries. */
const PROBE_SOURCE = 'Counted from the first 200 tickets';

function grouped(settled: Settled<Grouped | null>): Grouped | null {
  return settled.ok ? settled.value : null;
}

function count(map: ReadonlyMap<string | null, number> | null | undefined, key: string): number {
  return map?.get(key) ?? 0;
}

/** A count in the reader's locale, with "+" when it is only a lower bound: "1,204", "200+". */
function said(value: number, locale: string, atLeast = false): string {
  return `${new Intl.NumberFormat(locale).format(value)}${atLeast ? '+' : ''}`;
}

/** A row-derived figure: exact when the probe held every row, "200+" when it was full. */
function probeFigure(probe: Settled<Probe>, match: (ticket: Ticket) => boolean): Figure {
  if (!probe.ok) return UNKNOWN;
  return fromProbe(probe.value.rows.filter(match).length, probe.value.capped);
}

/** The priority strip a tile or card draws: P1 to P4 in their own tones, each linking to its tickets. */
function prioritySegments(counts: ReadonlyMap<string | null, number>, href?: (priority: string) => string): DistributionSegment[] {
  return PRIORITIES.map((priority) => ({
    id: priority,
    label: priority,
    value: counts.get(priority) ?? 0,
    tone: PRIORITY_LOOK[priority].chartTone,
    ...(href ? { href: href(priority) } : {}),
  }));
}

/** The ticket page for a number. */
function ticketHref(number: string): string {
  return `/tickets/${encodeURIComponent(number)}`;
}

/**
 * The inbox view a scope's figure continues in (every tile `href`s to its
 * view, A6 §5.2.4): the reader's own work, or the teams'.
 */
function viewHref(ctx: OverviewContext, mine: string, team: string): string {
  return ctx.query.scope === 'mine' ? mine : team;
}

const WAITING_HREF_TEAM = `/inbox/all?status=${WAITING_STATES.join(',')}`;

/** An attention row's loudness from a tone: amber only for the SLA's own due-soon look (D5). */
function severityOf(tone: Tone): AttentionSeverity {
  if (tone === 'danger' || tone === 'info') return tone;
  if (tone === SLA_STATE_LOOK.due_soon.tone) return SLA_STATE_LOOK.due_soon.tone as AttentionSeverity;
  return 'neutral';
}

/** The due-soon tone as a hero's: the one amber the hero may use. */
const DUE_SOON_TONE = SLA_STATE_LOOK.due_soon.tone as HeroTone;

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** "Mitigating", "Stood down": a major incident's state in words. */
function incidentState(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : status;
}

/** "MI-0004 · Sev 2 · Mitigating · next update 14:52". */
function incidentLine(incident: LiveIncident, ctx: OverviewContext, withTitle: boolean): string {
  const { row } = incident;
  const next = time(row.nextUpdateDueAt);
  const update =
    next === null
      ? null
      : next <= ctx.now.getTime()
        ? 'update overdue'
        : `next update ${clockLabel(new Date(next), ctx.locale, ctx.timeZone)}`;
  return [row.number, ...(withTitle ? [row.title] : []), severityLabel(row.severity), incidentState(row.status), ...(update ? [update] : [])].join(' · ');
}

/* ================================================================ toolbar */

/**
 * The toolbar (A6 §5.2.2, G2): scope, period, the page's one "As at"
 * (`data-as-at="page"`, the parity hook; X-M4), and "Open My work". The
 * area's primary, New ticket, is the sidebar's, so there is none here.
 */
export function OverviewToolbar({ ctx }: { readonly ctx: OverviewContext }): ReactNode {
  const { query } = ctx;
  return (
    <div className="app-Overview__toolbar">
      <div className="app-Overview__controls">
        <OverviewControls
          scope={
            ctx.teamScope
              ? {
                  label: 'Scope',
                  value: query.scope,
                  options: [
                    { value: 'mine', label: 'Mine', href: overviewHref(query, { scope: 'mine', attention: 'all' }) },
                    { value: 'team', label: ctx.teamLabel, href: overviewHref(query, { scope: 'team', attention: 'all' }) },
                  ],
                }
              : null
          }
          period={{
            label: 'Period',
            value: query.range,
            options: RANGES.map((range) => ({ value: range, label: `${RANGE_DAYS[range]} days`, href: overviewHref(query, { range }) })),
          }}
        />
        <p className="app-Overview__asAt" data-as-at="page">
          <Icon name="calendar" size={14} />
          <time dateTime={ctx.asAt}>{asAtLabel(ctx.now, ctx.locale, ctx.timeZone)}</time>
        </p>
      </div>
      <div className="app-Overview__actions">
        <Button variant="secondary" href="/inbox/mine" iconEnd="arrow-right">
          Open My work
        </Button>
      </div>
    </div>
  );
}

/**
 * The section chips a phone jumps by (A6 §5.2.9, G12): a sticky row under
 * the top bar, drawn only below 768 px by the stylesheet.
 */
export function OverviewJumps({ ctx }: { readonly ctx: OverviewContext }): ReactNode {
  const jumps = [
    { id: 'health', label: 'Health' },
    { id: 'needs-you', label: 'Needs you' },
    { id: 'time-left', label: 'Time left' },
    ...(ctx.analytics ? [{ id: 'trend', label: 'Trend' }] : []),
    { id: 'team', label: 'Team' },
  ];
  return (
    <nav className="app-Overview__jumps" aria-label="Sections">
      <ul>
        {jumps.map((jump) => (
          <li key={jump.id}>
            <a href={`#${jump.id}`}>{jump.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ================================================================ banner */

/**
 * The running major incident, below 1024 px (A6 §5.2.5): the frame's chip
 * carries it on wider screens and is hidden here, so the page says it above
 * the toolbar. The stylesheet hides it from 1024 px. Its link is the
 * frame's: the incident's ticket until the war room ships (RV6).
 */
export async function IncidentBanner({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  if (!ctx.held.has('incident.major.read')) return null;
  const incident = await loadIncident();
  if (!incident.ok || !incident.value) return null;
  const { href, count: running } = incident.value;
  const label = running > 1 ? 'Open major incidents' : isPending('/major-incidents') ? 'Open its ticket' : 'Open war room';
  return (
    <div className="app-Overview__incident">
      <Banner
        tone="danger"
        kicker="Major incident"
        live={false}
        {...(href ? { action: { id: 'incident', label, href, variant: 'secondary' as const } } : {})}
      >
        {incidentLine(incident.value, ctx, true)}
        {running > 1 ? ` · ${running - 1} more running` : ''}
      </Banner>
    </div>
  );
}

/* ================================================================ hero */

/** The hero's skeleton: its own height, so nothing below moves when it arrives. */
export function HeroSkeleton(): ReactNode {
  return <Skeleton className="app-Overview__heroSkeleton" height="10.5rem" radius="xl" />;
}

const REASON_ORDER: readonly VerdictReason[] = ['breached', 'due-within-hour', 'unassigned-urgent', 'major-incident', 'due-today'];

/**
 * Queue health (A6 §5.2.3, X-M3, X-M4): the verdict in the shared words,
 * what made it ("Why?"), the trend line — the next breach, never "As at" —
 * the counted chips, one sentence, four dimensions and the next breach
 * with the share of its time used. Drawn from whatever arrived: a
 * dimension whose read failed says "—" in neutral.
 */
export async function OverviewHero({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const { query, now, locale, timeZone } = ctx;
  const majorRead = ctx.held.has('incident.major.read');
  const [open, mine, waiting, waitingBy, bySla, breachedBy, dueBy, urgent, unassigned, oldest, replies, clocks, incident] = await Promise.all([
    loadOpenRows(query.scope),
    loadOpenRows('mine'),
    loadWaitingRows(query.scope),
    loadWaitingByStatus(query.scope),
    loadBySla(query.scope),
    loadBreachedByPriority(query.scope),
    loadDueTodayByPriority(query.scope, ctx.today.start, ctx.today.end),
    loadUnassignedUrgent(),
    loadUnassignedCount(),
    loadOldestUnassigned(),
    loadReplies(),
    loadClocks(query.scope),
    majorRead ? loadIncident() : Promise.resolve({ ok: true as const, value: null }),
  ]);

  const rows = open.ok ? open.value.rows : [];
  const breachedProbe = probeFigure(open, (ticket) => isBreached(ticket, now));
  const breached = grouped(breachedBy)?.total ?? breachedProbe.value;
  const breachedSaid = said(breached ?? 0, locale, !grouped(breachedBy) && breachedProbe.atLeast);
  const dueSoonProbe = probeFigure(open, (ticket) => isDueSoon(ticket, now));
  const dueSoon = grouped(bySla) ? count(grouped(bySla)!.groups, 'due_soon') : dueSoonProbe.value;
  const dueSoonSaid = said(dueSoon ?? 0, locale, !grouped(bySla) && dueSoonProbe.atLeast);
  const dueTodayCount = grouped(dueBy)?.total ?? (open.ok ? dueToday(rows, now, timeZone).length : null);
  const urgentCount = urgent.ok ? urgent.value.rows.length : 0;
  const liveIncident = incident.ok ? incident.value : null;
  const known = open.ok || breachedBy.ok;

  const { verdict, reasons } = queueVerdict({
    breached: breached ?? 0,
    dueWithinHour: dueSoon ?? 0,
    unassignedUrgent: urgentCount,
    majorIncident: liveIncident !== null,
    dueToday: dueTodayCount ?? 0,
  });
  const look = verdictLook(verdict);

  // The tickets the sentence and "Why?" name.
  const firstBreach = oldestBreach(rows, now);
  const next = nextDue(rows, now);
  const clockOf = (number: string | undefined): Clock | undefined => (clocks.ok ? clocks.value.find((clock) => clock.ticket.number === number) : undefined);
  const breachClock = clockOf(firstBreach?.number);
  const breachAt = breachClock?.breachedAt ?? firstBreach?.dueAt ?? null;

  const why: HeroWhyItem[] = [];
  for (const reason of REASON_ORDER) {
    if (!reasons.includes(reason)) continue;
    if (reason === 'breached') {
      why.push({
        tone: 'danger',
        label: breached === 1 && firstBreach ? `1 breached: ${firstBreach.number} ${firstBreach.title}` : `${breachedSaid} breached`,
        ...(breachAt ? { detail: `Passed its target ${dayAndTime(new Date(breachAt), now, locale, timeZone)}` } : {}),
        href: breached === 1 && firstBreach ? ticketHref(firstBreach.number) : overviewHref(query, { attention: 'breached' }, 'needs-you'),
      });
    }
    if (reason === 'due-within-hour') {
      const soon = rows.filter((ticket) => isDueSoon(ticket, now));
      why.push({
        tone: DUE_SOON_TONE,
        label: dueSoon === 1 && soon[0] ? `1 due within the hour: ${soon[0].number}` : `${dueSoonSaid} due within the hour`,
        href: dueSoon === 1 && soon[0] ? ticketHref(soon[0].number) : overviewHref(query, { attention: 'due-soon' }, 'needs-you'),
      });
    }
    if (reason === 'unassigned-urgent') {
      why.push({
        tone: 'danger',
        label: `${said(urgentCount, locale, urgent.ok && urgent.value.capped)} unassigned P1 or P2 ${ctx.teamWords}`,
        href: overviewHref(query, { attention: 'unassigned-urgent' }, 'needs-you'),
      });
    }
    if (reason === 'major-incident' && liveIncident) {
      why.push({ tone: 'danger', label: `${liveIncident.row.number} is live`, ...(liveIncident.href ? { href: liveIncident.href } : {}) });
    }
    if (reason === 'due-today') {
      why.push({ tone: 'neutral', label: `${said(dueTodayCount ?? 0, locale)} due today`, href: viewHref(ctx, '/inbox/mine', '/inbox/due') });
    }
  }

  const repliedCount = rows.filter((ticket) => replies.ok && replies.value.has(ticket.id)).length;
  const waitingCount = grouped(waitingBy)?.total ?? (waiting.ok ? waiting.value.rows.length : 0);
  const chips: HeroChip[] = [
    ...((breached ?? 0) > 0 ? [{ id: 'breached', tone: 'danger' as const, label: `${breachedSaid} breached`, href: overviewHref(query, { attention: 'breached' }, 'needs-you') }] : []),
    ...((dueSoon ?? 0) > 0
      ? [{ id: 'due-soon', tone: DUE_SOON_TONE, label: `${dueSoonSaid} due within the hour`, href: overviewHref(query, { attention: 'due-soon' }, 'needs-you') }]
      : []),
    ...(repliedCount > 0
      ? [{ id: 'replied', tone: 'info' as const, label: `${said(repliedCount, locale)} ${repliedCount === 1 ? 'customer' : 'customers'} replied`, href: overviewHref(query, { attention: 'replied' }, 'needs-you') }]
      : []),
    ...(waitingCount > 0
      ? [{ id: 'waiting', tone: 'hold' as const, label: `${said(waitingCount, locale)} waiting on others`, href: viewHref(ctx, '/inbox/waiting', WAITING_HREF_TEAM) }]
      : []),
  ].slice(0, 4);

  const named = (ticket: Ticket | null, at: string | null | undefined, target?: string) =>
    ticket && at ? { number: ticket.number, at: new Date(at), ...(target ? { target } : {}) } : null;
  const narrativeInput = {
    breached: named(firstBreach, breachAt, breachClock ? targetName(breachClock.targetType).toLowerCase() : undefined),
    breachedCount: breached ?? 0,
    next: named(next, next?.dueAt),
    now,
    locale,
    timeZone,
  };

  const dimensions: HeroDimension[] = [myWorkDimension(mine, ctx), teamDimension(ctx, urgent, unassigned, oldest), waitingDimension(ctx, waiting, waitingCount)];
  if (majorRead) {
    dimensions.push(
      !incident.ok
        ? { id: 'major-incident', label: 'Major incident', tone: 'neutral', state: '—' }
        : liveIncident
          ? {
              id: 'major-incident',
              label: 'Major incident',
              tone: 'danger',
              state: 'Live',
              reason: incidentLine(liveIncident, ctx, false),
              ...(liveIncident.href ? { href: liveIncident.href } : {}),
            }
          : { id: 'major-incident', label: 'Major incident', tone: 'success', state: 'None open' },
    );
  }

  return (
    <HeroCard
      id="health"
      variant="navy"
      kicker="Queue health"
      headingLevel={2}
      locale={locale}
      verdict={known ? { tone: look.tone, label: look.label, icon: look.icon } : { tone: 'neutral', label: 'Not available', icon: 'circle-dot' }}
      {...(why.length > 0 ? { why: <HeroWhy items={why} title={`Why queue health is ${look.label.toLowerCase()}`} /> } : {})}
      trend={{ text: known ? trendLine(narrativeInput) : 'Couldn’t read the queue' }}
      chips={chips}
      narrative={known ? queueNarrative(narrativeInput) : 'The queue couldn’t be read just now'}
      dimensions={dimensions}
      aside={heroAside(ctx, clocks, next)}
    />
  );
}

/** My work: the reader's own verdict, whatever the scope (A6 §5.2.3). */
function myWorkDimension(mine: Settled<Probe>, ctx: OverviewContext): HeroDimension {
  if (!mine.ok) return { id: 'mine', label: 'My work', tone: 'neutral', state: '—', href: '/inbox/mine' };
  const { rows, capped } = mine.value;
  const { now, timeZone } = ctx;
  const breached = rows.filter((ticket) => isBreached(ticket, now)).length;
  const { verdict } = queueVerdict({
    breached,
    dueWithinHour: rows.filter((ticket) => isDueSoon(ticket, now)).length,
    unassignedUrgent: 0,
    majorIncident: false,
    dueToday: dueToday(rows, now, timeZone).length,
  });
  const look = verdictLook(verdict);
  const next = nextDue(rows, now);
  const parts = [`${said(rows.length, ctx.locale, capped)} open`];
  if (breached > 0) parts.push(`${said(breached, ctx.locale, capped)} breached`);
  if (next?.dueAt) parts.push(`next due ${compactDuration(Date.parse(next.dueAt) - now.getTime())}`);
  return { id: 'mine', label: 'My work', tone: look.tone, state: look.label, reason: parts.join(' · '), href: '/inbox/mine' };
}

/** Team queue: at risk when an urgent ticket has nobody or the oldest unassigned has waited past four hours. */
function teamDimension(ctx: OverviewContext, urgent: Settled<Probe>, unassigned: Settled<Figure>, oldest: Settled<Ticket | null>): HeroDimension {
  if (!unassigned.ok) return { id: 'team', label: 'Team queue', tone: 'neutral', state: '—', href: '/inbox/unassigned' };
  const age = oldest.ok && oldest.value ? ctx.now.getTime() - Date.parse(oldest.value.createdAt) : null;
  const risky = (urgent.ok && urgent.value.rows.length > 0) || (age !== null && age > UNASSIGNED_TARGET_MS);
  const look = verdictLook(risky ? 'at_risk' : 'on_track');
  const figure = unassigned.value;
  const parts = [`${figure.value === null ? '—' : said(figure.value, ctx.locale, figure.atLeast)} unassigned`];
  if (age !== null) parts.push(`oldest ${compactDuration(age)}`);
  return { id: 'team', label: 'Team queue', tone: look.tone, state: look.label, reason: parts.join(' · '), href: '/inbox/unassigned' };
}

/** Waiting on others: a hold, never a fault — "3 waiting · longest 2 days" without a change. */
function waitingDimension(ctx: OverviewContext, waiting: Settled<Probe>, total: number): HeroDimension {
  const href = viewHref(ctx, '/inbox/waiting', WAITING_HREF_TEAM);
  if (!waiting.ok) return { id: 'waiting', label: 'Waiting on others', tone: 'neutral', state: '—', href };
  const oldest = Math.min(...waiting.value.rows.map((ticket) => Date.parse(ticket.updatedAt)).filter(Number.isFinite));
  const parts = [`${said(total, ctx.locale)} waiting`];
  if (Number.isFinite(oldest)) parts.push(`longest ${longDuration(ctx.now.getTime() - oldest)}`);
  return { id: 'waiting', label: 'Waiting on others', tone: total > 0 ? 'hold' : 'neutral', state: total > 0 ? 'Waiting' : 'None waiting', reason: parts.join(' · '), href };
}

/**
 * The aside: the next breach, with the share of that clock's business time
 * already used (A6 §5.2.3). Without a running clock: "Next deadline · None
 * today".
 */
function heroAside(ctx: OverviewContext, clocks: Settled<readonly Clock[]>, next: Ticket | null): HeroAside {
  const upcoming = clocks.ok ? clocks.value.find((clock) => !clock.breached && time(clock.dueAt) !== null && time(clock.dueAt)! > ctx.now.getTime()) : undefined;
  if (upcoming) {
    const left = time(upcoming.dueAt)! - ctx.now.getTime();
    return {
      kicker: 'Next breach',
      tone: left <= 60 * 60_000 ? DUE_SOON_TONE : 'neutral',
      value: compactDuration(left),
      valueLabel: upcoming.ticket.number,
      progress: { value: upcoming.used, target: 1, label: `${targetName(upcoming.targetType)} time used` },
      href: ticketHref(upcoming.ticket.number),
    };
  }
  if (next?.dueAt) {
    const left = Date.parse(next.dueAt) - ctx.now.getTime();
    return { kicker: 'Next breach', tone: 'neutral', value: compactDuration(left), valueLabel: next.number, href: ticketHref(next.number) };
  }
  return { kicker: 'Next deadline', tone: 'neutral', value: 'None today' };
}

/* ================================================================ KPI row */

/** The KPI row's skeleton: six tiles at their final height. */
export function KpiSkeleton(): ReactNode {
  return (
    <StatGrid columns={6}>
      {Array.from({ length: 6 }, (_, index) => (
        <SkeletonStat key={index} />
      ))}
    </StatGrid>
  );
}

/**
 * The six tiles (A6 §5.2.4, X-M5): every one has a spark or a visual, and
 * every value comes from `/tickets` or `/tickets/count`, so the row is the
 * same with or without analytics (D9).
 */
export async function OverviewKpis({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const { query, now, locale, timeZone, period } = ctx;
  const days = RANGE_DAYS[query.range];
  const [open, openBy, waiting, waitingBy, bySla, breachedBy, dueBy, unassigned, oldest, resolvedCounts, resolvedRows] = await Promise.all([
    loadOpenRows(query.scope),
    loadOpenByPriority(query.scope),
    loadWaitingRows(query.scope),
    loadWaitingByStatus(query.scope),
    loadBySla(query.scope),
    loadBreachedByPriority(query.scope),
    loadDueTodayByPriority(query.scope, ctx.today.start, ctx.today.end),
    loadUnassignedCount(),
    loadOldestUnassigned(),
    loadResolvedCounts(query.scope, period.start, period.previousStart),
    loadResolvedRows(query.scope, seriesSince(now, timeZone, days)),
  ]);
  const rows = open.ok ? open.value.rows : [];
  // A long range can hold more resolved tickets than are read; the Open series needs only its own fortnight.
  const recent =
    resolvedRows.ok && resolvedRows.value && !resolvedRows.value.complete && days > OPEN_SERIES_DAYS
      ? await loadResolvedRows(query.scope, seriesSince(now, timeZone, OPEN_SERIES_DAYS))
      : resolvedRows;

  /* 1 · Open */
  const openGroups = grouped(openBy);
  const openSplit = openGroups?.groups ?? (open.ok ? countBy(rows, (ticket) => ticket.priority) : null);
  const finished = resolvedRows.ok && resolvedRows.value?.complete ? resolvedRows.value.rows : null;
  const recentFinished = recent.ok && recent.value?.complete ? recent.value.rows : null;
  const openSeries = open.ok && !open.value.capped && recentFinished ? deriveOpenSeries(rows, recentFinished, now, timeZone) : null;
  const openDelta = openSeries ? openSeries[openSeries.length - 1]! - openSeries[openSeries.length - 1 - 7]! : null;

  /* 2 · Due today */
  const dueGroups = grouped(dueBy);
  const dueRows = dueToday(rows, now, timeZone);
  const dueSplit = dueGroups?.groups ?? countBy(dueRows, (ticket) => ticket.priority);
  const slaGroups = grouped(bySla)?.groups;
  const withinHour = slaGroups ? count(slaGroups, 'due_soon') : rows.filter((ticket) => isDueSoon(ticket, now)).length;

  /* 3 · Breached */
  const breachedGroups = grouped(breachedBy);
  const breachedRows = rows.filter((ticket) => isBreached(ticket, now));
  const breachedSplit = breachedGroups?.groups ?? countBy(breachedRows, (ticket) => ticket.priority);
  const firstBreach = oldestBreach(rows, now);

  /* 4 · Waiting on others */
  const waitingGroups = grouped(waitingBy);
  const waitingRows = waiting.ok ? waiting.value.rows : [];
  const waitingSplit = waitingGroups?.groups ?? countBy(waitingRows, (ticket) => ticket.status);
  const longest = Math.min(...waitingRows.map((ticket) => Date.parse(ticket.updatedAt)).filter(Number.isFinite));

  /* 5 · Unassigned in my teams */
  const oldestAge = oldest.ok && oldest.value ? now.getTime() - Date.parse(oldest.value.createdAt) : null;

  /* 6 · Resolved · {range} */
  const figures = kpisFrom({
    open: open.ok ? open.value : null,
    waiting: waiting.ok ? waiting.value : null,
    openTotal: openGroups?.total ?? null,
    dueTodayTotal: dueGroups?.total ?? null,
    breachedTotal: breachedGroups?.total ?? null,
    waitingTotal: waitingGroups?.total ?? null,
    unassigned: unassigned.ok ? unassigned.value : null,
    resolved: resolvedCounts.ok && resolvedCounts.value ? resolvedCounts.value.current : null,
    resolvedRows: resolvedRows.ok ? resolvedRows.value : null,
    periodStart: period.start,
    now,
    timeZone,
  });
  const { open: openFigure, dueToday: dueFigure, breached: breachedFigure, waiting: waitingFigure, unassigned: unassignedFigure, resolved: resolvedFigure } = figures;
  const resolvedDelta =
    resolvedCounts.ok && resolvedCounts.value && !resolvedCounts.value.current.atLeast && !resolvedCounts.value.previous.atLeast
      ? (resolvedCounts.value.current.value ?? 0) - (resolvedCounts.value.previous.value ?? 0)
      : null;
  const resolvedSeries = finished
    ? dailyCounts(
        finished.map((ticket) => ticket.resolvedAt),
        localDays(now, timeZone, days),
      )
    : null;
  const previousFigure = resolvedCounts.ok && resolvedCounts.value ? resolvedCounts.value.previous : null;

  const mine = query.scope === 'mine';
  const strip = (label: string, counts: ReadonlyMap<string | null, number>, emptyText: string) => (
    <DistributionBar label={label} segments={prioritySegments(counts)} height={6} legend="none" emptyText={emptyText} locale={locale} />
  );

  return (
    <StatGrid columns={6}>
      <StatCard
        label="Open"
        {...tileValue(openFigure)}
        locale={locale}
        href={viewHref(ctx, '/inbox/mine', '/inbox/all')}
        info={{
          body: mine ? 'Open tickets assigned to you, waiting included.' : `Open tickets ${ctx.teamWords}, waiting included.`,
          ...(openSeries ? { source: 'Estimated from when tickets were raised and resolved; reassigned tickets count from when they were raised' } : openFigure.probe ? { source: PROBE_SOURCE } : {}),
        }}
        {...(openSeries ? { trend: openSeries } : openSplit ? { visual: strip('Open by priority', openSplit, 'Nothing open') } : {})}
        {...(openDelta !== null ? { delta: { value: openDelta, period: 'vs 7 days ago', goodDirection: 'down' as const } } : {})}
        context={openSplit ? prioritySplit(openSplit) : 'Priorities not available'}
        {...tileProblem(openFigure, open, openBy)}
      />
      <StatCard
        label="Due today"
        {...tileValue(dueFigure)}
        locale={locale}
        href={viewHref(ctx, '/inbox/mine', '/inbox/due')}
        info={{ body: 'Open tickets due before midnight, your time.', ...(dueFigure.probe ? { source: PROBE_SOURCE } : {}) }}
        visual={strip('Due today by priority', dueSplit, 'Nothing due today')}
        context={withinHour > 0 ? `${said(withinHour, locale)} within the hour` : 'None within the hour'}
        status={withinHour > 0 ? 'attention' : 'default'}
        {...tileProblem(dueFigure, dueBy, open)}
      />
      <StatCard
        label="Breached"
        {...tileValue(breachedFigure)}
        locale={locale}
        href={viewHref(ctx, '/inbox/mine', '/inbox/due')}
        info={{ body: 'Resolution target passed and still open.', ...(breachedFigure.probe ? { source: PROBE_SOURCE } : {}) }}
        visual={strip('Breached by priority', breachedSplit, 'Nothing breached')}
        context={firstBreach?.dueAt ? `Oldest ${longDuration(now.getTime() - Date.parse(firstBreach.dueAt))} ago` : 'Nothing past its target'}
        status={(breachedFigure.value ?? 0) > 0 ? 'critical' : 'default'}
        {...tileProblem(breachedFigure, breachedBy, open)}
      />
      <StatCard
        label="Waiting on others"
        {...tileValue(waitingFigure)}
        locale={locale}
        href={viewHref(ctx, '/inbox/waiting', WAITING_HREF_TEAM)}
        info={{ body: 'Tickets waiting on a requester, a supplier or an approval.', ...(waitingFigure.probe ? { source: PROBE_SOURCE } : {}) }}
        visual={
          <DistributionBar
            label="Waiting on others by who it waits on"
            height={6}
            legend="none"
            emptyText="Nothing waiting"
            locale={locale}
            segments={[
              { id: 'pending_requester', label: WAITING_ON.pending_requester, value: count(waitingSplit, 'pending_requester'), tone: 'hold' },
              { id: 'pending_third_party', label: WAITING_ON.pending_third_party, value: count(waitingSplit, 'pending_third_party'), tone: 'hold', pattern: 'hatch' },
              { id: 'pending_approval', label: WAITING_ON.pending_approval, value: count(waitingSplit, 'pending_approval'), tone: 'neutralSoft' },
            ]}
          />
        }
        context={Number.isFinite(longest) ? `Longest ${longDuration(now.getTime() - longest)}` : 'Nothing waiting'}
        {...tileProblem(waitingFigure, waitingBy, waiting)}
      />
      <StatCard
        label="Unassigned in my teams"
        {...tileValue(unassignedFigure)}
        locale={locale}
        href="/inbox/unassigned"
        info="Open tickets in your teams that nobody has picked up."
        visual={
          <BulletBar
            label="Oldest"
            compact
            cap
            value={oldestAge === null ? 0 : oldestAge / HOUR_MS}
            target={UNASSIGNED_TARGET_MS / HOUR_MS}
            max={Math.max(UNASSIGNED_TARGET_MS, oldestAge ?? 0) / HOUR_MS}
            format={{ style: 'unit', unit: 'hour', unitDisplay: 'narrow', maximumFractionDigits: 0 }}
            locale={locale}
          />
        }
        context={oldestAge !== null ? `Oldest ${compactDuration(oldestAge)}` : 'Nobody waiting to be picked up'}
        {...tileProblem(unassignedFigure, unassigned)}
      />
      <StatCard
        label={`Resolved · ${days} days`}
        {...tileValue(resolvedFigure)}
        locale={locale}
        href="/inbox/resolved"
        info={{ body: mine ? `Tickets you resolved in the last ${days} days.` : `Tickets resolved ${ctx.teamWords} in the last ${days} days.`, ...(resolvedFigure.probe ? { source: PROBE_SOURCE } : {}) }}
        {...(resolvedSeries
          ? { trend: resolvedSeries }
          : {
              visual: (
                <BulletBar
                  label="Resolved"
                  compact
                  value={resolvedFigure.value ?? 0}
                  {...(previousFigure?.value !== null && previousFigure?.value !== undefined ? { target: previousFigure.value } : {})}
                  locale={locale}
                />
              ),
            })}
        {...(resolvedDelta !== null ? { delta: { value: resolvedDelta, period: `vs previous ${days} days`, goodDirection: 'up' as const } } : {})}
        {...(resolvedDelta === null && previousFigure?.value !== null && previousFigure?.value !== undefined ? { context: `${said(previousFigure.value, locale, previousFigure.atLeast)} in the previous ${days} days` } : {})}
        {...tileProblem(resolvedFigure, resolvedCounts, resolvedRows)}
      />
    </StatGrid>
  );
}

/**
 * What a tile says when it has no figure: the first failed read's problem,
 * in the product's words. A tile with a figure from any of its reads shows
 * the figure; one with neither a figure nor a failure shows "—".
 */
function tileProblem(figure: Figure, ...reads: readonly Settled<unknown>[]): { readonly problem?: Problem } {
  if (figure.value !== null) return {};
  for (const read of reads) if (!read.ok) return { problem: read.problem };
  return {};
}

/* ================================================================ Needs you */

/** "Breached 1 d ago", "Due in 40 min", "Customer replied 2 h ago" … with the tone the reason has. */
function reasonOf(entry: AttentionEntry, ctx: OverviewContext): AttentionItem['reason'] {
  const { now } = ctx;
  const since = time(entry.since);
  const ago = since === null ? null : compactDuration(now.getTime() - since);
  switch (entry.tab) {
    case 'breached':
      return { label: ago ? `Breached ${ago} ago` : SLA_STATE_LOOK.breached.label, tone: SLA_STATE_LOOK.breached.tone };
    case 'due-soon':
      return { label: since === null ? SLA_STATE_LOOK.due_soon.label : `Due in ${compactDuration(since - now.getTime())}`, tone: SLA_STATE_LOOK.due_soon.tone };
    case 'replied':
      return { label: ago ? `Customer replied ${ago} ago` : 'Customer replied' };
    case 'new':
      return { label: 'New · assigned to you' };
    case 'waiting-long':
      return { label: since === null ? 'No change for days' : `No change for ${longDuration(now.getTime() - since)}` };
    case 'unassigned-urgent': {
      const look = PRIORITY_LOOK[entry.ticket.priority as keyof typeof PRIORITY_LOOK];
      return { label: `Unassigned · ${entry.ticket.priority}`, ...(look ? { tone: look.tone } : {}) };
    }
  }
}

function severityOfEntry(entry: AttentionEntry): AttentionSeverity {
  switch (entry.tab) {
    case 'breached':
      return severityOf(SLA_STATE_LOOK.breached.tone);
    case 'due-soon':
      return severityOf(SLA_STATE_LOOK.due_soon.tone);
    case 'unassigned-urgent':
      return entry.ticket.priority === 'P1' ? 'danger' : 'info';
    case 'replied':
      return 'info';
    default:
      return 'neutral';
  }
}

function attentionItem(entry: AttentionEntry, ctx: OverviewContext, people: Readonly<Record<string, { readonly name: string; readonly initials: string }>>): AttentionItem {
  const { ticket } = entry;
  const due = time(ticket.dueAt);
  const assignee = ticket.assigneeId?.toLowerCase() ?? null;
  const owner =
    assignee === null
      ? null
      : assignee === ctx.me.id?.toLowerCase()
        ? { name: ctx.me.name }
        : people[assignee]
          ? { name: people[assignee]!.name, initials: people[assignee]!.initials }
          : undefined;
  const reason = reasonOf(entry, ctx);
  return {
    id: ticket.id,
    severity: severityOfEntry(entry),
    ref: ticket.number,
    title: ticket.title,
    href: ticketHref(ticket.number),
    ...(reason ? { reason } : {}),
    ...(owner === undefined ? {} : { owner }),
    ...(due === null
      ? {}
      : {
          due: {
            label: dueLabel(new Date(due), ctx.now, ctx.locale, ctx.timeZone),
            at: ticket.dueAt!,
            ...(due <= ctx.now.getTime() && ticket.statusCategory === 'open' ? { overdue: true, slip: slip(ctx.now.getTime() - due) } : {}),
          },
        }),
  };
}

/** Where each tab's "Show all" continues. */
function moreHref(tab: AttentionTabId, ctx: OverviewContext): string {
  switch (tab) {
    case 'breached':
    case 'due-soon':
      return viewHref(ctx, '/inbox/mine', '/inbox/due');
    case 'waiting-long':
      return viewHref(ctx, '/inbox/waiting', WAITING_HREF_TEAM);
    case 'unassigned-urgent':
      return '/inbox/unassigned?priority=P1,P2';
    case 'new':
      return '/inbox/mine?status=new';
    default:
      return '/inbox/mine';
  }
}

/** Rows a tab shows before "Show all". */
export const ATTENTION_MAX = 8;

/**
 * Needs you (A6 §5.2.5): counted tabs — empty ones hidden, All always — and
 * at most eight rows of the current one, each with its reason. Its tabs are
 * links (`?attention=`), so a tab survives a reload and lands back on the
 * card. "Assign to me" is offered on the Unassigned urgent tab, to readers
 * who may assign.
 */
export async function NeedsYou({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const { query, now } = ctx;
  const [open, mine, waiting, urgent, replies, breachedBy, bySla] = await Promise.all([
    loadOpenRows(query.scope),
    loadOpenRows('mine'),
    loadWaitingRows(query.scope),
    loadUnassignedUrgent(),
    loadReplies(),
    loadBreachedByPriority(query.scope),
    loadBySla(query.scope),
  ]);
  const frame = (body: ReactNode, headline?: string): ReactNode => (
    <GridItem span={7}>
      <Card id="needs-you" title="Needs you" titleAs="h2" className="app-Overview__needs" {...(headline ? { headline } : {})}>
        {body}
      </Card>
    </GridItem>
  );
  if (!open.ok) return frame(<CardProblem problem={open.problem} context="Needs you" retryHref={ctx.retryHref} />);

  const tabs = attentionFrom({
    open: open.value.rows,
    mine: mine.ok ? mine.value.rows : [],
    waiting: waiting.ok ? waiting.value.rows : [],
    unassignedUrgent: urgent.ok ? urgent.value.rows : [],
    replies: replies.ok ? replies.value : new Map(),
    now,
  });
  // A tab's count is the exact one where the API can say it; the rows are the first few.
  const exactCount: Partial<Record<AttentionTabId, number>> = {
    ...(grouped(breachedBy) ? { breached: grouped(breachedBy)!.total } : {}),
    ...(grouped(bySla) ? { 'due-soon': count(grouped(bySla)!.groups, 'due_soon') } : {}),
  };
  const counted = (tab: AttentionTabId): number => exactCount[tab] ?? tabs[tab].length;
  const current = query.attention;
  const shownTabs: AttentionTab[] = ATTENTION_TABS.filter((tab) => tab === 'all' || tab === current || counted(tab) > 0).map((tab) => ({
    id: tab,
    label: ATTENTION_LABELS[tab],
    count: counted(tab),
    href: overviewHref(query, { attention: tab }, 'needs-you'),
    ...(tab === current ? { current: true } : {}),
  }));

  const entries = tabs[current];
  const people = await loadPeople(entries.slice(0, ATTENTION_MAX).map((entry) => entry.ticket.assigneeId));
  const items = entries.map((entry) => attentionItem(entry, ctx, people));
  const unassignedTotal = urgent.ok ? urgent.value.rows.length : 0;
  const breachedTotal = exactCount.breached ?? tabs.breached.length;
  const empty =
    current === 'all'
      ? {
          title: 'Nothing needs you right now',
          description: `Checked ${clockLabel(now, ctx.locale, ctx.timeZone)}`,
          ...(unassignedTotal > 0 ? { action: { id: 'pick-up', label: `Pick up from Unassigned (${unassignedTotal})`, href: '/inbox/unassigned', variant: 'secondary' as const } } : {}),
        }
      : { title: `Nothing in ${ATTENTION_LABELS[current]}`, description: `Checked ${clockLabel(now, ctx.locale, ctx.timeZone)}` };
  const list = {
    label: 'Needs you',
    items,
    tabs: shownTabs,
    max: ATTENTION_MAX,
    moreHref: moreHref(current, ctx),
    moreLabel: 'Show all',
    empty,
    locale: ctx.locale,
  };
  const canAssign = current === 'unassigned-urgent' && ctx.held.has('ticket.assign') && ctx.me.id !== null && items.length > 0;
  return frame(
    canAssign ? <AssignSlot {...list} meId={ctx.me.id!} /> : <AttentionList {...list} />,
    needsYou({ total: counted('all'), breached: breachedTotal, locale: ctx.locale }),
  );
}

/* ================================================================ Time left */

/**
 * Time left (A6 §5.2.5): the six soonest running clocks in scope, each
 * as the share of its business time used against all of it — amber from
 * 80 %, red at the limit, past it hatched. Paused tickets are not here:
 * their clocks are not running.
 */
export async function TimeLeft({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const clocks = await loadClocks(ctx.query.scope);
  const card = { title: 'Time left', id: 'time-left', span: 5 as const, headingLevel: 2 as const, minHeight: 336 };
  if (!clocks.ok) return <ChartCard {...card} state="error" problem={clocks.problem} retryHref={ctx.retryHref} />;
  if (clocks.value.length === 0) return <ChartCard {...card} state="empty" emptyText="No clocks are running" />;
  const { now } = ctx;
  const rows: BulletRow[] = clocks.value.map((clock) => {
    const due = time(clock.dueAt);
    const breachedAt = time(clock.breachedAt) ?? due;
    const detail = clock.breached
      ? `Breached ${breachedAt === null ? '' : compactDuration(now.getTime() - breachedAt)}`.trim()
      : due === null
        ? 'Running'
        : `${compactDuration(due - now.getTime())} left`;
    return {
      id: clock.ticket.id,
      label: `${clock.ticket.number} ${clock.ticket.title}`,
      value: clock.used,
      target: 1,
      max: 1,
      cap: true,
      capWarn: CLOCK_WARN,
      format: { style: 'percent', maximumFractionDigits: 0 },
      detail,
      href: ticketHref(clock.ticket.number),
      locale: ctx.locale,
    };
  });
  return (
    <ChartCard
      {...card}
      headline={timeLeft({ used: clocks.value.map((clock) => clock.used), warnAt: CLOCK_WARN, locale: ctx.locale })}
      info="How much of each clock’s business time is used, soonest due first. Paused tickets are left out: their clocks are stopped."
    >
      <BulletList title="Time left" rows={rows} sort="none" locale={ctx.locale} />
    </ChartCard>
  );
}

/* ================================================================ analytics row */

/** The skeletons of the analytics row while its batch is out. */
export function AnalyticsSkeleton(): ReactNode {
  return (
    <>
      <ChartCard title="Raised vs resolved" span={8} state="loading" minHeight={336} />
      <ChartCard title="SLA met" span={4} state="loading" minHeight={336} />
    </>
  );
}

/** Points from a metric series, `{ x: ISO, y }`, gaps kept. */
function points(result: MetricResult): { x: string; y: number | null }[] {
  return (result.series ?? []).map((point) => ({ x: typeof point.at === 'string' ? point.at : new Date(point.at).toISOString(), y: point.value }));
}

/**
 * Raised vs resolved and SLA met (A6 §5.2.5), only for a reader who holds
 * `analytics.read` — the page does not render this at all otherwise, and
 * asks nothing of `/analytics` (D9). One batch; a 403 for the whole batch,
 * or for one question (a team-less fact for a team reader), renders nothing
 * for what it refused.
 */
export async function AnalyticsRow({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const answered = await loadAnalytics(ctx.query.range);
  const days = RANGE_DAYS[ctx.query.range];
  if (!answered.ok) {
    return (
      <>
        <ChartCard title="Raised vs resolved" id="trend" span={8} headingLevel={2} minHeight={336} state="error" problem={answered.problem} retryHref={ctx.retryHref} />
        <ChartCard title="SLA met" span={4} headingLevel={2} minHeight={336} state="error" problem={answered.problem} retryHref={ctx.retryHref} />
      </>
    );
  }
  if (answered.value === null) return null;
  const { raised, resolved, attainment, byTarget } = answered.value;
  const refused = (settled: Settled<MetricResult>): boolean => !settled.ok && settled.problem.status === 403;
  return (
    <>
      {refused(raised) || refused(resolved) ? null : <TrendCard ctx={ctx} raised={raised} resolved={resolved} days={days} />}
      {refused(attainment) ? null : <SlaCard ctx={ctx} attainment={attainment} byTarget={byTarget} days={days} />}
    </>
  );
}

function TrendCard({
  ctx,
  raised,
  resolved,
  days,
}: {
  readonly ctx: OverviewContext;
  readonly raised: Settled<MetricResult>;
  readonly resolved: Settled<MetricResult>;
  readonly days: number;
}): ReactNode {
  // The footer goes to Team performance only once that page exists (RV6): read at render time, so no later edit is needed here.
  const footer = isPending('/team') ? {} : { footerLink: { href: '/team', label: 'Open team performance' } };
  const card = {
    title: 'Raised vs resolved',
    id: 'trend',
    span: 8 as const,
    headingLevel: 2 as const,
    minHeight: 336,
    info: 'Tickets raised and resolved each day in your teams. Days are counted in UTC, as the analytics store keeps them.',
    ...footer,
  };
  if (!raised.ok || !resolved.ok) {
    return <ChartCard {...card} state="error" problem={(!raised.ok ? raised : (resolved as Extract<typeof resolved, { ok: false }>)).problem} retryHref={ctx.retryHref} />;
  }
  const raisedPoints = points(raised.value);
  const resolvedPoints = points(resolved.value);
  const headline = raisedVsResolved({ raised: raisedPoints.map((point) => point.y), resolved: resolvedPoints.map((point) => point.y), days, locale: ctx.locale });
  const empty = [...raisedPoints, ...resolvedPoints].every((point) => !point.y);
  if (empty) return <ChartCard {...card} state="empty" emptyText={headline} />;
  return (
    <ChartCard {...card} headline={headline}>
      <AreaChart
        title="Raised vs resolved"
        xType="time"
        interactive
        table="toggle"
        fill="gradient"
        endLabels="auto"
        minPoints={MIN_POINTS}
        asAt={ctx.asAt}
        timeZone={ctx.timeZone}
        locale={ctx.locale}
        markers={[{ kind: 'today' }]}
        series={[
          { id: 'raised', label: 'Raised', style: 'comparison', points: raisedPoints },
          { id: 'resolved', label: 'Resolved', points: resolvedPoints },
        ]}
      />
    </ChartCard>
  );
}

function SlaCard({
  ctx,
  attainment,
  byTarget,
  days,
}: {
  readonly ctx: OverviewContext;
  readonly attainment: Settled<MetricResult>;
  readonly byTarget: Settled<MetricResult>;
  readonly days: number;
}): ReactNode {
  const card = {
    title: 'SLA met',
    span: 4 as const,
    headingLevel: 2 as const,
    minHeight: 336,
    info: 'Share of service-level targets met, counting each target a policy defines once per ticket.',
  };
  if (!attainment.ok) return <ChartCard {...card} state="error" problem={attainment.problem} retryHref={ctx.retryHref} />;
  // The target is the tenant's own, carried on the answer (S1); never a number typed here.
  const goal = attainmentTarget(attainment.value);
  const value = typeof attainment.value.value === 'number' ? attainment.value.value : null;
  const groups = byTarget.ok ? (byTarget.value.groups ?? []).filter((group) => typeof group.key === 'string') : [];
  const headline = slaMet({ attainment: value, target: goal.percent, days, byTarget: groups.map((group) => ({ key: group.key, value: group.value })), locale: ctx.locale });
  if (value === null) return <ChartCard {...card} state="empty" emptyText={headline} />;
  const caption = groups
    .filter((group): group is typeof group & { value: number } => typeof group.value === 'number')
    .map((group) => `${targetName(group.key!)} ${Math.round(group.value)}%`)
    .join(' · ');
  const rows: BulletRow[] = groups
    .filter((group): group is typeof group & { value: number } => typeof group.value === 'number')
    .map((group) => ({ id: group.key!, label: targetName(group.key!), value: group.value / 100, target: goal.fraction, max: 1, format: { style: 'percent', maximumFractionDigits: 0 }, locale: ctx.locale }));
  return (
    <ChartCard {...card} headline={headline}>
      <div className="app-Overview__sla">
        <Gauge
          label={`SLA met · last ${days} days`}
          value={value / 100}
          target={goal.fraction}
          bands={{ relativeTo: goal.fraction, warning: 0.05, danger: 0.1 }}
          {...(caption ? { caption } : {})}
          locale={ctx.locale}
        />
        {rows.length > 0 ? <BulletList title="SLA met by target" rows={rows} sort="none" locale={ctx.locale} /> : null}
      </div>
    </ChartCard>
  );
}

/* ================================================================ distributions */

/**
 * My work by priority (A6 §5.2.5): the scope's open work as one strip, P1
 * to P4 in their own tones, each segment a link to those tickets.
 */
export async function PriorityCard({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const mine = ctx.query.scope === 'mine';
  const [openBy, open] = await Promise.all([loadOpenByPriority(ctx.query.scope), loadOpenRows(ctx.query.scope)]);
  const card = { title: mine ? 'My work by priority' : 'Team work by priority', span: 6 as const, headingLevel: 2 as const, minHeight: 200 };
  const groups = grouped(openBy);
  const counts = groups?.groups ?? (open.ok ? countBy(open.value.rows, (ticket) => ticket.priority) : null);
  if (!counts) return <ChartCard {...card} state="error" problem={!openBy.ok ? openBy.problem : !open.ok ? open.problem : { status: 503, retryable: true }} retryHref={ctx.retryHref} />;
  const total = groups?.total ?? [...counts.values()].reduce((sum, value) => sum + value, 0);
  const base = mine ? '/inbox/mine' : '/inbox/all';
  return (
    <ChartCard
      {...card}
      headline={myWorkByPriority({ counts, total, whose: mine ? { kind: 'mine' } : { kind: 'team', words: ctx.teamWords }, locale: ctx.locale })}
      {...(!groups && open.ok && open.value.capped ? { caption: PROBE_SOURCE } : {})}
    >
      <DistributionBar
        label={card.title}
        segments={prioritySegments(counts, (priority) => `${base}?priority=${priority}`)}
        legend="below"
        emptyText="Nothing open"
        locale={ctx.locale}
      />
    </ChartCard>
  );
}

/**
 * Team queue by status (A6 §5.2.5): New, In progress (reopened with it) and
 * Waiting across the reader's teams, each segment a link to the view.
 */
export async function StatusCard({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const [byStatus, unassigned] = await Promise.all([loadTeamByStatus(), loadUnassignedCount()]);
  const card = { title: 'Team queue by status', id: 'team', span: 6 as const, headingLevel: 2 as const, minHeight: 200 };
  let fresh = 0;
  let progress = 0;
  let waiting = 0;
  let other = 0;
  const groups = grouped(byStatus);
  if (groups) {
    for (const [status, value] of groups.groups) {
      if (status === 'new') fresh += value;
      else if (status === 'in_progress' || status === 'reopened') progress += value;
      else if (status !== null && (WAITING_STATES as readonly string[]).includes(status)) waiting += value;
      else other += value;
    }
  } else {
    const counts = await loadTeamByStatusCounts();
    if (!counts.ok) return <ChartCard {...card} state="error" problem={counts.problem} retryHref={ctx.retryHref} />;
    fresh = counts.value.new.value ?? 0;
    progress = counts.value.progress.value ?? 0;
    waiting = counts.value.waiting.value ?? 0;
  }
  if (!byStatus.ok && byStatus.problem.status !== 404 && !groups) return <ChartCard {...card} state="error" problem={byStatus.problem} retryHref={ctx.retryHref} />;
  const unassignedFigure = unassigned.ok ? unassigned.value : null;
  const segments: DistributionSegment[] = [
    { id: 'new', label: 'New', value: fresh, tone: 'neutral', href: '/inbox/all?status=new' },
    { id: 'in-progress', label: 'In progress', value: progress, tone: 'info', href: '/inbox/all?status=in_progress,reopened' },
    { id: 'waiting', label: 'Waiting', value: waiting, tone: 'hold', href: WAITING_HREF_TEAM },
    ...(other > 0 ? [{ id: 'other', label: 'Other', value: other, tone: 'neutralSoft' as const }] : []),
  ];
  return (
    <ChartCard
      {...card}
      headline={teamQueueByStatus({ fresh, progress, waiting, other, words: ctx.teamWords, locale: ctx.locale })}
      {...(unassignedFigure?.value !== null && unassignedFigure?.value !== undefined ? { caption: `${unassignedFigure.value}${unassignedFigure.atLeast ? '+' : ''} unassigned` } : {})}
    >
      <DistributionBar label={card.title} segments={segments} legend="below" emptyText="Nothing open" locale={ctx.locale} />
    </ChartCard>
  );
}

/* ================================================================ waiting and on call */

/** How long since a waiting ticket last changed counts as long: the same three days as "Waiting long". */
const LONG_WAIT_MS = 3 * 24 * 3_600_000;
/** Rows the Waiting card lists. */
export const WAITING_MAX = 6;

/**
 * The last row (A6 §5.2.5): Waiting on others beside On call now. One
 * component, so the waiting card takes the whole row when there is nobody
 * on call to show — no gap, no placeholder (D9's rule for a missing card).
 */
export async function WaitingAndOnCall({ ctx }: { readonly ctx: OverviewContext }): Promise<ReactNode> {
  const onCallRead = ctx.held.has('workload.read');
  const [waiting, onCall] = await Promise.all([loadWaitingRows(ctx.query.scope), onCallRead ? loadOnCall() : Promise.resolve({ ok: true as const, value: null })]);
  const showOnCall = !onCall.ok || onCall.value !== null;
  return (
    <>
      <WaitingCard ctx={ctx} waiting={waiting} span={showOnCall ? 8 : 12} />
      {showOnCall ? <OnCallCard ctx={ctx} onCall={onCall} /> : null}
    </>
  );
}

async function WaitingCard({ ctx, waiting, span }: { readonly ctx: OverviewContext; readonly waiting: Settled<Probe>; readonly span: 8 | 12 }): Promise<ReactNode> {
  const href = viewHref(ctx, '/inbox/waiting', WAITING_HREF_TEAM);
  const frame = (body: ReactNode): ReactNode => (
    <GridItem span={span}>
      <Card title="Waiting on others" titleAs="h2" bleed className="app-Overview__waiting" footerLink={{ href, label: 'Open Waiting on others' }}>
        {body}
      </Card>
    </GridItem>
  );
  if (!waiting.ok) return frame(<CardProblem problem={waiting.problem} context="Waiting on others" retryHref={ctx.retryHref} />);
  // Longest without a change first: the ones most likely to need a nudge.
  const rows = [...waiting.value.rows].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).slice(0, WAITING_MAX);
  if (rows.length === 0) return frame(<EmptyState size="sm" tone="success" title="Nothing is waiting on others" headingLevel={3} />);
  const people = await loadPeople(rows.map((ticket) => ticket.requesterId));
  const { now } = ctx;
  return frame(
    <div data-bleed className="app-Overview__tableScroll">
      <table className="app-Overview__table">
        <caption className="itsm-visually-hidden">Waiting on others, longest without a change first</caption>
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Title</th>
            <th scope="col">Waiting on</th>
            <th scope="col" data-column="age">
              No change for
            </th>
            <th scope="col" data-column="requester">
              Requester
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ticket) => {
            const age = now.getTime() - Date.parse(ticket.updatedAt);
            const long = age > LONG_WAIT_MS;
            const on = WAITING_ON[ticket.status as WaitingState] ?? ticket.status;
            const requester = ticket.requesterId ? people[ticket.requesterId.toLowerCase()] : undefined;
            return (
              <tr key={ticket.id}>
                <td className="app-Overview__ref">{ticket.number}</td>
                <td className="app-Overview__titleCell">
                  <AppLink href={ticketHref(ticket.number)} className="app-Overview__titleLink">
                    {ticket.title}
                  </AppLink>
                </td>
                <td>
                  <StatusPill size="sm" tone="hold" icon={ticket.status === 'pending_approval' ? 'hourglass' : 'pause'} label={on} />
                </td>
                <td data-column="age" data-long={long ? '' : undefined}>
                  {longDuration(age)}
                  {long ? <span className="itsm-visually-hidden">, a long wait</span> : null}
                </td>
                <td data-column="requester">
                  {requester ? (
                    <span className="app-Overview__person">
                      <Avatar name={requester.name} initials={requester.initials} size="xs" decorative />
                      {requester.name}
                    </span>
                  ) : (
                    <span className="app-Overview__muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
  );
}

/** Routing's availability as the avatar's dot and the words beside it (A7 m26: Busy neutral, Away hold — here the dot's own shapes). */
const AVAILABILITY: Readonly<Record<string, { readonly presence: PresenceStatus; readonly words: string }>> = {
  available: { presence: 'online', words: 'Available' },
  busy: { presence: 'busy', words: 'Busy' },
  away: { presence: 'away', words: 'Away' },
  off_shift: { presence: 'offline', words: 'Off shift' },
  left: { presence: 'offline', words: 'Left' },
};

function OnCallCard({ ctx, onCall }: { readonly ctx: OverviewContext; readonly onCall: Settled<readonly OnCallNow[] | null> }): ReactNode {
  const frame = (body: ReactNode): ReactNode => (
    <GridItem span={4}>
      <Card title="On call now" titleAs="h2" className="app-Overview__onCall">
        {body}
      </Card>
    </GridItem>
  );
  if (!onCall.ok) return frame(<CardProblem problem={onCall.problem} context="On call now" retryHref={ctx.retryHref} />);
  const rows = onCall.value ?? [];
  if (rows.length === 0) return frame(<EmptyState size="sm" tone="empty" title="Nobody is on call right now" headingLevel={3} />);
  return frame(
    <ul className="app-Overview__onCallList">
      {rows.map((row) => {
        const availability = row.availability ? AVAILABILITY[row.availability] : undefined;
        const name = row.name ?? 'Someone on call';
        const until = row.until ? `until ${new Intl.DateTimeFormat(ctx.locale, { timeZone: ctx.timeZone, weekday: 'short' }).format(new Date(row.until))} ${clockLabel(new Date(row.until), ctx.locale, ctx.timeZone)}` : null;
        return (
          <li key={row.rotation.key} className="app-Overview__onCallRow">
            <Avatar name={name} size="md" {...(availability ? { status: availability.presence } : {})} />
            <span className="app-Overview__onCallText">
              <span className="app-Overview__onCallName">{name}</span>
              <span className="app-Overview__onCallMeta">{[row.teamName ?? row.rotation.name, until].filter(Boolean).join(' · ')}</span>
            </span>
            {availability ? <span className="app-Overview__onCallStatus">{availability.words}</span> : null}
          </li>
        );
      })}
    </ul>,
  );
}

/* ================================================================ forbidden */

/** For somebody whose account cannot read tickets: the v2 sentence, and nothing read (A6 §3.7). */
export function OverviewForbidden(): ReactNode {
  return (
    <EmptyState
      tone="forbidden"
      frame="dashed"
      title="Your account can’t read tickets"
      description="Ask an administrator for the agent role."
    />
  );
}

