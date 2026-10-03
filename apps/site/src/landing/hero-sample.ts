/**
 * The landing's sample data (SPEC v3 §6.2 "Device frame"; A5 §4.4; X-M2).
 *
 * The hero shows the Service Desk Overview drawn by the real chart kit, so it
 * needs numbers — and this file is the only place on the site allowed to hold
 * them (honesty rule H2: no demo figure in any copy). Everything here is
 * illustrative: it is labelled "Sample data" wherever it is drawn, it is never
 * quoted in a sentence the page says about the product, and it is not a
 * result from any customer or from the demo tenant.
 *
 * The tiles mirror the first four of the Overview's six (Open · Due today ·
 * Breached · Waiting on others, A6 §5.2.4), and the SLA target is the
 * product's default of 90 per cent (`attainmentTarget()`, X-m6), so what a
 * prospect sees in the frame is what they meet one click later.
 *
 * Deterministic on purpose: the series is a fixed weekday profile with a fixed
 * wobble, anchored to today's UK date so weekends dip on real weekends. Every
 * visitor in a given UK day sees the same picture, and the chart's headline is
 * computed from the same series, so the sentence above the plot always
 * matches the lines in it.
 */

export const SAMPLE_LABEL = 'Sample data';

/** Tickets raised on each weekday, Monday first: a working desk's week, quiet at weekends. */
export const RAISED_BY_WEEKDAY = [46, 44, 43, 41, 38, 12, 9] as const;
/** Tickets resolved on each weekday, Monday first; slightly ahead of raised, so the queue drifts down. */
export const RESOLVED_BY_WEEKDAY = [43, 46, 45, 43, 42, 10, 8] as const;
/** A fixed day-to-day wobble, so the lines look like a month of work rather than a pattern. */
export const WOBBLE = [0, 2, -1, 3, -2, 1, 0, -1, 2, 1, -3, 0, 2, -1, 1] as const;

/** How many days the chart covers, ending today. */
export const HERO_DAYS = 30;

export interface HeroPoint {
  /** `YYYY-MM-DD`, a UK calendar day. */
  readonly x: string;
  readonly y: number;
}

export interface HeroSeries {
  readonly raised: readonly HeroPoint[];
  readonly resolved: readonly HeroPoint[];
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for a UTC midnight. */
function dateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Thirty days of raised and resolved tickets ending on `todayUk`
 * (`YYYY-MM-DD`, from `ukDateKey(now)`). Pure: the same day gives the same
 * series. A malformed day falls back to a fixed one rather than throwing,
 * because a marketing page must render whatever it is handed.
 */
export function heroSeries(todayUk: string): HeroSeries {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(todayUk) ? Date.parse(`${todayUk}T00:00:00Z`) : Number.NaN;
  const end = Number.isFinite(parsed) ? parsed : Date.UTC(2026, 9, 2);
  const raised: HeroPoint[] = [];
  const resolved: HeroPoint[] = [];
  for (let index = 0; index < HERO_DAYS; index++) {
    const time = end - (HERO_DAYS - 1 - index) * DAY_MS;
    const weekday = (new Date(time).getUTCDay() + 6) % 7;
    // The wobble keys on the absolute day, so a given date keeps its values as the window slides.
    const wobble = WOBBLE[Math.floor(time / DAY_MS) % WOBBLE.length]!;
    raised.push({ x: dateKey(time), y: Math.max(0, RAISED_BY_WEEKDAY[weekday]! + wobble) });
    resolved.push({ x: dateKey(time), y: Math.max(0, RESOLVED_BY_WEEKDAY[weekday]! - wobble) });
  }
  return { raised, resolved };
}

const count = new Intl.NumberFormat('en-GB');

/**
 * The trend card's headline, in the Overview's own words
 * (`raisedVsResolved()` in the Service Desk): "Resolved 1,236, raised 1,222
 * in 30 days: the queue fell by 14".
 */
export function heroHeadline(series: HeroSeries): string {
  const raised = series.raised.reduce((sum, point) => sum + point.y, 0);
  const resolved = series.resolved.reduce((sum, point) => sum + point.y, 0);
  const difference = resolved - raised;
  const movement =
    difference > 0 ? `the queue fell by ${count.format(difference)}` : difference < 0 ? `the queue grew by ${count.format(-difference)}` : 'the queue held steady';
  return `Resolved ${count.format(resolved)}, raised ${count.format(raised)} in ${HERO_DAYS} days: ${movement}`;
}

/** One segment of a tile's strip: an Overview tile's split by priority, or by who the work waits on. */
export interface HeroSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly tone: 'danger' | 'high' | 'warning' | 'info' | 'neutral' | 'hold' | 'neutralSoft';
}

export interface HeroKpi {
  readonly id: 'open' | 'due' | 'breached' | 'waiting';
  readonly label: string;
  readonly value: number;
  /** A line under the value, as the Overview writes it. */
  readonly context: string;
  /** Oldest first: the tile's sparkline. */
  readonly trend?: readonly number[];
  readonly delta?: { readonly value: number; readonly period: string; readonly goodDirection: 'up' | 'down' };
  /** The 6 px strip in place of a sparkline. */
  readonly split?: { readonly label: string; readonly segments: readonly HeroSegment[] };
  readonly status?: 'default' | 'attention' | 'critical';
}

const byPriority = (label: string, p1: number, p2: number, p3: number, p4: number): HeroKpi['split'] => ({
  label,
  segments: [
    { id: 'P1', label: 'P1', value: p1, tone: 'danger' },
    { id: 'P2', label: 'P2', value: p2, tone: 'high' },
    { id: 'P3', label: 'P3', value: p3, tone: 'info' },
    { id: 'P4', label: 'P4', value: p4, tone: 'neutral' },
  ],
});

/** The four tiles, in the Overview's order and with its labels. */
export const HERO_KPIS: readonly HeroKpi[] = Object.freeze([
  {
    id: 'open',
    label: 'Open',
    value: 86,
    context: '2 P1 · 11 P2 · 51 P3 · 22 P4',
    trend: [97, 95, 96, 93, 94, 92, 93, 91, 90, 91, 89, 88, 87, 86],
    delta: { value: -7, period: 'vs 7 days ago', goodDirection: 'down' },
  },
  {
    id: 'due',
    label: 'Due today',
    value: 9,
    context: '3 within the hour',
    status: 'attention',
    split: byPriority('Due today by priority', 1, 3, 4, 1),
  },
  {
    id: 'breached',
    label: 'Breached',
    value: 2,
    context: 'Oldest 1 d ago',
    status: 'critical',
    split: byPriority('Breached by priority', 0, 1, 1, 0),
  },
  {
    id: 'waiting',
    label: 'Waiting on others',
    value: 14,
    context: '8 on the requester · 4 on a supplier · 2 on an approval',
    split: {
      label: 'Waiting on others by who it waits on',
      segments: [
        { id: 'pending_requester', label: 'Requester', value: 8, tone: 'hold' },
        { id: 'pending_third_party', label: 'Supplier', value: 4, tone: 'hold' },
        { id: 'pending_approval', label: 'Approval', value: 2, tone: 'neutralSoft' },
      ],
    },
  },
] satisfies HeroKpi[]);

/** The SLA gauge: attainment over the period against the product's default target. */
export const HERO_SLA = Object.freeze({ value: 0.934, target: 0.9 } as const);

/** The SLA card's headline, in the Overview's words (`slaMet()`). */
export function heroSlaHeadline(sla: { readonly value: number; readonly target: number } = HERO_SLA): string {
  const percent = (fraction: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(fraction * 100)}%`;
  const points = Math.round((sla.value - sla.target) * 1000) / 10;
  const gap = points === 0 ? 'on' : `${Math.abs(points)} points ${points > 0 ? 'above' : 'under'}`;
  return `${percent(sla.value)} of targets met in ${HERO_DAYS} days, ${gap} the ${percent(sla.target)} target`;
}

/** Sample counts beside the preview's nav items, by `SERVICE_DESK_NAV_PREVIEW` id. */
export const HERO_NAV_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  mine: 12,
  unassigned: 5,
  due: 9,
  waiting: 14,
  all: 86,
});

/**
 * What each screenshot's stand-in shows until the final wave's pictures exist
 * (X-M9): a few rows of sample content per shot, drawn at card size. Titles
 * are the demo's own hero records, so the stand-in previews what the "Try it"
 * beside it opens.
 */
export const SHOT_ROWS: Readonly<Record<string, readonly { readonly title: string; readonly meta: string; readonly tone: HeroSegment['tone'] }[]>> =
  Object.freeze({
    'desk-inbox': [
      { title: 'Outlook keeps asking for my password', meta: 'Due in 40 min', tone: 'warning' },
      { title: 'Teams calls drop after a few minutes on Wi-Fi', meta: 'Breached 1 d ago', tone: 'danger' },
      { title: 'Shared S: drive missing after the Windows update', meta: 'Due 16:30', tone: 'neutral' },
      { title: 'Password reset link says it has expired', meta: 'Due tomorrow', tone: 'neutral' },
    ],
    'war-room': [
      { title: 'Update posted for staff', meta: '10:05', tone: 'info' },
      { title: 'Next stakeholder update due', meta: 'In 20 min', tone: 'warning' },
      { title: 'Linked tickets', meta: '23', tone: 'neutral' },
    ],
    knowledge: [
      { title: 'Connect to the VPN from home', meta: 'Article', tone: 'neutral' },
      { title: 'Set up the authenticator app', meta: 'Article', tone: 'neutral' },
      { title: 'When the VPN keeps disconnecting', meta: 'Article', tone: 'neutral' },
    ],
    'ai-triage': [
      { title: 'Type · Incident', meta: 'Sample', tone: 'info' },
      { title: 'Category · Hardware', meta: 'Sample', tone: 'info' },
      { title: 'Team · Service Desk', meta: 'Sample', tone: 'info' },
    ],
    rules: [
      { title: 'When a P1 is raised', meta: 'Published', tone: 'neutral' },
      { title: 'Route VPN tickets to Network', meta: 'Published', tone: 'neutral' },
      { title: 'Escalate breached tickets', meta: 'Draft', tone: 'hold' },
    ],
    'portal-home': [
      { title: 'Report a problem', meta: '', tone: 'neutral' },
      { title: 'Request something', meta: '', tone: 'neutral' },
      { title: 'Find an answer', meta: '', tone: 'neutral' },
      { title: 'Your requests', meta: '2', tone: 'neutral' },
    ],
    board: [
      { title: 'New', meta: '6', tone: 'neutral' },
      { title: 'In progress', meta: '9', tone: 'info' },
      { title: 'Waiting', meta: '4', tone: 'hold' },
    ],
  });
