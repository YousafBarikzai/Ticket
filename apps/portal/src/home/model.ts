import type { ApprovalRequest, ArticleSummary, PublicComponentStatus, PublicStatus, Ticket } from '@itsm/sdk';
import type { IconName, Tone } from '@itsm/ui';
import { nextAction, yoursFirst } from '../tickets/presentation.js';

/**
 * Home, as data (SPEC §6.3 `/`, X-34): the greeting, the one list of the
 * person's requests with what needs them pinned first, the service status in
 * words, the popular answers and the channels line. Pure and server-safe, so
 * the page decides everything on the server and ships only what is drawn.
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
  readonly approval?: { readonly count: number };
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
      approval: { count: 1 },
    });
  } else if (waiting.length > 1) {
    const latest = [...waiting].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0]!;
    rows.push({
      key: 'approvals',
      ticket: { number: '', type: 'request', title: `${waiting.length} requests need your approval`, status: 'pending_approval', updatedAt: latest.requestedAt },
      action: 'review',
      href: '/approvals',
      approval: { count: waiting.length },
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

/* ---------------------------------------------------------- Service status */

const COMPONENT_WORDS: Record<PublicComponentStatus, { readonly label: string; readonly tone: Tone; readonly icon: IconName }> = {
  operational: { label: 'Running', tone: 'success', icon: 'circle-check' },
  degraded: { label: 'Degraded', tone: 'warning', icon: 'triangle-alert' },
  partial_outage: { label: 'Partly down', tone: 'warning', icon: 'triangle-alert' },
  major_outage: { label: 'Down', tone: 'danger', icon: 'circle-x' },
  maintenance: { label: 'Maintenance', tone: 'info', icon: 'settings-2' },
};

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

export function componentState(status: PublicComponentStatus | string): StatusLine {
  return COMPONENT_WORDS[status as PublicComponentStatus] ?? { label: 'Unknown', tone: 'neutral', icon: 'circle-dashed' };
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
        ? { label: 'Planned maintenance', tone: 'info', icon: 'settings-2' }
        : status.overall === 'major_outage'
          ? { label: 'Some services are down', tone: 'danger', icon: 'circle-x' }
          : { label: 'Some services have problems', tone: 'warning', icon: 'triangle-alert' };
  return { overall, components };
}

/* ---------------------------------------------------------- Popular answers */

export interface PopularAnswer {
  readonly key: string;
  readonly title: string;
}

/** The three most read published articles — or none, below three (a "popular" list of one is not a list). */
export function popularAnswers(articles: readonly ArticleSummary[], count = 3): PopularAnswer[] {
  const top = articles
    .filter((article) => article.status === 'published')
    .sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title, 'en-GB'))
    .slice(0, count)
    .map((article) => ({ key: article.key, title: article.title }));
  return top.length < count ? [] : top;
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
