import type { ApprovalRequest, ArticleSummary, PublicComponentStatus, PublicStatus, Ticket } from '@itsm/sdk';
import { COMPONENT_STATE_LOOK, type IconName, type StepperStep, type Tone } from '@itsm/ui';
import { nextAction, PROGRESS_STEPS, progressOf, yoursFirst } from '../tickets/presentation.js';

/**
 * Home, as data (SPEC §6.3 `/`, X-34; v3 §7.2, A6 §6.1): the greeting, the
 * counts on the quick actions, the one list of the person's requests with
 * what needs them pinned first, the service status in words and tones, the
 * maintenance coming up, the popular answers with their views and helpful
 * share, and the channels line. Pure and server-safe, so the page decides
 * everything on the server and ships only what is drawn.
 */

/* ---------------------------------------------------------------- Greeting */

/** The hour (0–23) where the person is; the server's zone is not theirs. */
function hourIn(now: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).find((part) => part.type === 'hour')?.value;
    const value = Number(hour);
    return Number.isFinite(value) ? value : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/** "Good afternoon, Ada" — by the clock where they are, with their first name when there is one. */
export function greetingFor(now: Date, timeZone: string, displayName: string | null | undefined): string {
  const hour = hourIn(now, timeZone);
  const part = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** "Wednesday 30 September", in their locale and zone. */
export function todayLabel(now: Date, locale: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(now);
  }
}

/**
 * "10:42" for a moment earlier today, "29 Sept, 10:42" for an older one —
 * how long ago an incident was last updated, where they are.
 */
export function updatedLabel(iso: string, now: Date, locale: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const format = (options: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
    } catch {
      return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
    }
  };
  const day = (value: Date): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(value);
    } catch {
      return value.toISOString().slice(0, 10);
    }
  };
  return day(date) === day(now) ? format({ hour: '2-digit', minute: '2-digit' }) : format({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------ Your requests */

/** The requester-safe fields a row draws (never a priority or an impact). */
export interface RowTicket {
  readonly number: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
}

export type RowAction = 'reply' | 'confirm' | 'review' | null;

export interface HomeRow {
  readonly key: string;
  readonly ticket: RowTicket;
  /** The ticket's version, for "Yes, it's fixed" (`If-Match`). */
  readonly version?: number;
  readonly action: RowAction;
  /** Only for the approvals row: where it leads, and how it reads. */
  readonly href?: string;
  readonly approval?: { readonly count: number; /** When the longest-waiting one was asked (ISO): "oldest 1 day". */ readonly oldestAt: string };
}

/** Home shows this many rows at most; "See all" is always there for the rest. */
export const HOME_ROWS = 5;

function rowTicket(ticket: Ticket): RowTicket {
  return { number: ticket.number, type: ticket.type, title: ticket.title, status: ticket.status, updatedAt: ticket.updatedAt };
}

/** What an approval is about, for the one row that stands for it. */
export function approvalTitle(approval: ApprovalRequest): string {
  return approval.subject?.title?.trim() || approval.currentStep?.name?.trim() || 'A request needs your approval';
}

/**
 * The one list (X-34): an approval waiting on them first ("Approval waiting ·
 * Review" — one row however many, since the Approvals page is where they are
 * decided), then the requests that are theirs to move (a question to answer,
 * a fix to confirm), then the rest by last update. At most five.
 */
export function homeRows(tickets: readonly Ticket[], approvals: readonly ApprovalRequest[] | null, cap = HOME_ROWS): HomeRow[] {
  const rows: HomeRow[] = [];
  const waiting = approvals ?? [];
  if (waiting.length === 1) {
    const [approval] = waiting as [ApprovalRequest];
    rows.push({
      key: `approval:${approval.id}`,
      ticket: {
        number: approval.subject?.ticketNumber ?? '',
        type: 'request',
        title: approvalTitle(approval),
        status: 'pending_approval',
        updatedAt: approval.requestedAt,
      },
      action: 'review',
      href: `/approvals?open=${encodeURIComponent(`approval:${approval.id}`)}`,
      approval: { count: 1, oldestAt: approval.requestedAt },
    });
  } else if (waiting.length > 1) {
    const byAsked = [...waiting].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const latest = byAsked[0]!;
    const oldest = byAsked.at(-1)!;
    rows.push({
      key: 'approvals',
      ticket: { number: '', type: 'request', title: `${waiting.length} approvals need you`, status: 'pending_approval', updatedAt: latest.requestedAt },
      action: 'review',
      href: '/approvals',
      approval: { count: waiting.length, oldestAt: oldest.requestedAt },
    });
  }

  const byUpdate = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const ticket of yoursFirst(byUpdate)) {
    const next = nextAction(ticket.status);
    rows.push({
      key: ticket.id,
      ticket: rowTicket(ticket),
      version: ticket.version,
      action: next.kind === 'reply' ? 'reply' : next.kind === 'confirm' ? 'confirm' : null,
    });
  }
  return rows.slice(0, cap);
}

/**
 * The mini stepper on a Home card (A6 §6.1.2): the request page's four
 * stages (`PROGRESS_STEPS`, the same rule as `requests/model.ts` `stepsFor`)
 * without dates — a card has room for where it is, not when. Here rather
 * than imported from the request page's model, whose formatter import would
 * bring a client entry into Home's server graph.
 */
export function miniSteps(status: string): StepperStep[] {
  const progress = progressOf(status);
  const cancelled = status === 'cancelled';
  const finished = status === 'closed' || cancelled;
  return PROGRESS_STEPS.map((label, index): StepperStep => {
    let state: StepperStep['status'];
    if (cancelled && index > 0 && index < 3) state = 'skipped';
    else if (index < progress.current || (finished && index === progress.current)) state = 'complete';
    else if (index === progress.current) state = 'current';
    else state = 'upcoming';
    const description = index === 1 && state === 'current' && progress.currentLabel !== label ? progress.currentLabel : undefined;
    return { id: `step-${index}`, label: index === 3 && cancelled ? 'Withdrawn' : label, status: state, ...(description ? { description } : {}) };
  });
}

/* ---------------------------------------------------------- Service status */

export interface StatusLine {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

export interface StatusSummary {
  /** "All services running", "Some services have problems". */
  readonly overall: StatusLine;
  /** Only the components that are not running normally. */
  readonly components: readonly { readonly key: string; readonly name: string; readonly state: StatusLine }[];
}

/**
 * A component's state as the one map draws it everywhere (X-B3, v3 §2.4):
 * degraded is `high` orange — amber is SLA risk and nothing else — and an
 * outage is red, so the same VPN outage has one colour in the Help Portal
 * and in Administration. A state the map does not know is said as unknown,
 * never guessed at.
 */
export function componentState(status: PublicComponentStatus | string): StatusLine {
  if (!Object.hasOwn(COMPONENT_STATE_LOOK, status)) return { label: 'Unknown', tone: 'neutral', icon: 'circle-dashed' };
  const look = COMPONENT_STATE_LOOK[status as PublicComponentStatus];
  return { label: look.label, tone: look.tone, icon: look.icon };
}

/** The status page in two lines of words: the overall state, and what is not running. */
export function statusSummary(status: PublicStatus): StatusSummary {
  const components = status.components
    .filter((component) => component.status !== 'operational')
    .map((component) => ({ key: component.key, name: component.name, state: componentState(component.status) }));
  const overall: StatusLine =
    status.overall === 'operational' && components.length === 0
      ? { label: 'All services running', tone: 'success', icon: 'circle-check' }
      : status.overall === 'maintenance'
        ? { label: 'Planned maintenance', tone: 'info', icon: 'wrench' }
        : status.overall === 'major_outage' || status.overall === 'partial_outage'
          ? { label: 'Some services are down', tone: 'danger', icon: 'circle-x' }
          : { label: 'Some services have problems', tone: 'high', icon: 'triangle-alert' };
  return { overall, components };
}

/**
 * The tone of the status strip while an incident is open: the worst state
 * among the components it affects (degraded `high`, an outage `danger`), and
 * `high` when it names none — an open incident is never drawn as all well.
 * A major or critical incident is `danger` whatever its components say.
 */
export function incidentTone(status: PublicStatus | null, incidentId: string): 'high' | 'danger' {
  const incident = status?.incidents.find((candidate) => candidate.id === incidentId);
  if (!incident) return 'high';
  if (incident.impact === 'major' || incident.impact === 'critical') return 'danger';
  const states = incident.components.map((key) => status?.components.find((component) => component.key === key)?.status);
  return states.some((state) => state !== undefined && componentState(state).tone === 'danger') ? 'danger' : 'high';
}

/* ---------------------------------------------------------------- Coming up */

export interface ComingUp {
  readonly id: string;
  readonly title: string;
  /** "Wed 7 Oct, 19:00–21:00", where the person is. */
  readonly when: string;
  readonly startsAt: string;
  /** The affected components, by name. */
  readonly affects: readonly string[];
  readonly inProgress: boolean;
}

/** How far ahead "Coming up" looks. */
export const COMING_UP_DAYS = 14;

function formatIn(date: Date, locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** "Wed 7 Oct, 19:00–21:00", or with both days when it runs past midnight. */
export function windowLabel(startsAt: string, endsAt: string, locale: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return startsAt;
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const sameDay = formatIn(start, 'en-GB', timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' }) === formatIn(end, 'en-GB', timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const from = `${formatIn(start, locale, timeZone, day)}, ${formatIn(start, locale, timeZone, time)}`;
  return sameDay ? `${from}–${formatIn(end, locale, timeZone, time)}` : `${from} – ${formatIn(end, locale, timeZone, day)}, ${formatIn(end, locale, timeZone, time)}`;
}

/**
 * Planned maintenance from the status page that is under way or starts in the
 * next fourteen days, soonest first (A6 §6.1.2 "Coming up"). Finished and
 * cancelled windows are not news.
 */
export function comingUp(status: PublicStatus | null, now: Date, locale: string, timeZone: string, days = COMING_UP_DAYS): ComingUp[] {
  if (!status) return [];
  const horizon = now.getTime() + days * 86_400_000;
  const names = new Map(status.components.map((component) => [component.key, component.name]));
  return status.maintenance
    .filter((window) => window.status === 'scheduled' || window.status === 'in_progress')
    .filter((window) => {
      const starts = Date.parse(window.startsAt);
      const ends = Date.parse(window.endsAt);
      return Number.isFinite(starts) && Number.isFinite(ends) && ends > now.getTime() && starts <= horizon;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((window) => ({
      id: window.id,
      title: window.title,
      when: windowLabel(window.startsAt, window.endsAt, locale, timeZone),
      startsAt: window.startsAt,
      affects: window.components.map((key) => names.get(key) ?? key),
      inProgress: window.status === 'in_progress' || Date.parse(window.startsAt) <= now.getTime(),
    }));
}

/* ---------------------------------------------------------- Popular answers */

export interface PopularAnswer {
  readonly key: string;
  readonly title: string;
  readonly views: number;
  /** The share who found it helpful (0–1), only when at least five people said either way. */
  readonly helpfulShare: number | null;
}

/** Fewer votes than this, and a share would be a guess. */
export const HELPFUL_MIN_VOTES = 5;

/**
 * The four most read published articles — or none, below three (a "popular"
 * list of one or two is not a list) — each with its views and, from five
 * votes, the share who found it helpful.
 */
export function popularAnswers(articles: readonly ArticleSummary[], count = 4, atLeast = 3): PopularAnswer[] {
  const top = articles
    .filter((article) => article.status === 'published')
    .sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title, 'en-GB'))
    .slice(0, count)
    .map((article) => {
      const votes = article.helpfulCount + article.unhelpfulCount;
      return { key: article.key, title: article.title, views: article.viewCount, helpfulShare: votes >= HELPFUL_MIN_VOTES ? article.helpfulCount / votes : null };
    });
  return top.length < atLeast ? [] : top;
}

/** "412 views · 91 % found this helpful", in the person's locale. */
export function answerFacts(answer: PopularAnswer, locale: string): string {
  const views = `${new Intl.NumberFormat(locale).format(answer.views)} ${answer.views === 1 ? 'view' : 'views'}`;
  if (answer.helpfulShare === null) return views;
  const share = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(answer.helpfulShare);
  return `${views} · ${share} found this helpful`;
}

/* ------------------------------------------------------------ Quick actions */

export interface QuickCounts {
  /** Open or waiting requests (not resolved); null when they could not be read. */
  readonly open: number | null;
  /** More than the page read: "20+ open". */
  readonly openCapped: boolean;
  /** Approvals waiting on them; null when they could not be read or may not be. */
  readonly approvals: number | null;
}

/**
 * The counts on the quick-action tiles, from reads the page makes anyway
 * (A6 §6.1.2): open is everything not yet resolved — a request waiting for
 * their word on a fix is already in "Your requests" with its own buttons.
 */
export function quickCounts(
  tickets: { readonly data: readonly Pick<Ticket, 'statusCategory' | 'status'>[]; readonly nextCursor?: string | null } | null,
  approvals: readonly ApprovalRequest[] | null,
): QuickCounts {
  const open = tickets ? tickets.data.filter((ticket) => ticket.statusCategory === 'open' || ticket.statusCategory === 'paused').length : null;
  return { open, openCapped: Boolean(tickets?.nextCursor), approvals: approvals ? approvals.length : null };
}

/** "4 open", "20+ open", "Nothing open"; null when unknown, so the tile says nothing rather than 0. */
export function openLabel(counts: QuickCounts): string | null {
  if (counts.open === null) return null;
  if (counts.openCapped) return `${counts.open}+ open`;
  return counts.open === 0 ? 'Nothing open' : `${counts.open} open`;
}

/** "3 waiting", "Nothing waiting"; null when unknown. */
export function approvalsLabel(counts: QuickCounts): string | null {
  if (counts.approvals === null) return null;
  return counts.approvals === 0 ? 'Nothing waiting' : `${counts.approvals} waiting`;
}

/** "1 day", "3 hours": how long the oldest approval has waited. */
export function waitedFor(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 60) return 'under an hour';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/* ----------------------------------------------------------------- Channels */

/**
 * `PORTAL_CHANNELS` ("email,teams,slack"): the other ways to reach the desk,
 * as the deploy checked them — lower-case names, de-duplicated. Anything that
 * is not a plain name is left out rather than printed on everybody's Home.
 */
export function parseChannels(raw: string | undefined): string[] {
  if (!raw) return [];
  const names = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => /^[a-z][a-z0-9-]{0,31}$/.test(name));
  return [...new Set(names)];
}
