import type { PlanRow, PlatformTenantUsage, TenantRow } from '@itsm/sdk';
import type { Tone } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { flagEntry } from '../../settings/catalogue.js';
import { linesText, meterLabel, periodText, type MeterView } from '../settings/usage.js';

/**
 * The platform pages in words (SPEC §6.1 `/tenants`, `/plans`): tenants as
 * rows, plans as cards, a tenant's meters as the Settings › Usage bars. Pure
 * and server-safe — the pages build every string here, on the server, in the
 * operator's locale and zone.
 */

/* ---- Money ------------------------------------------------------------------ */

/**
 * A price per agent per month (OD-05, ADR-0047). `pricePerAgentMicros` is in
 * millionths of the currency unit and arrives as a string, because a bigint
 * does not survive JSON and a number loses precision on an annual figure for
 * a large tenant. Null is a price that is agreed rather than listed.
 */
export function formatPrice(micros: string | null, currency: string, locale = 'en-GB'): string {
  if (micros === null) return 'Negotiated';
  const pence = Number(BigInt(micros) / 10_000n) / 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(pence);
}

/* ---- Tenants ---------------------------------------------------------------- */

export interface TenantView extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended' | string;
  readonly statusLabel: string;
  readonly region: string;
  /** The plan's name, "No plan", or null when the API did not say (an older API). */
  readonly plan: string | null;
  readonly planKey: string | null;
  readonly created: string;
  readonly createdAt: string;
  readonly aiRegions: readonly string[] | null;
  readonly suspendedSince: string | null;
  /** Name, slug, plan and region, for the search. */
  readonly search: string;
}

export const STATUS_LOOK: Readonly<Record<string, { readonly label: string; readonly tone: Tone; readonly icon: 'circle-check' | 'pause' | 'dot' }>> = {
  active: { label: 'Active', tone: 'success', icon: 'circle-check' },
  suspended: { label: 'Suspended', tone: 'warning', icon: 'pause' },
};

export function statusLook(status: string): { readonly label: string; readonly tone: Tone; readonly icon: 'circle-check' | 'pause' | 'dot' } {
  return STATUS_LOOK[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), tone: 'neutral', icon: 'dot' };
}

export function planName(plans: readonly PlanRow[], key: string | null | undefined): string {
  if (!key || key === 'none') return 'No plan';
  return plans.find((plan) => plan.key === key)?.name ?? key;
}

export function tenantView(row: TenantRow, plans: readonly PlanRow[], format: { readonly locale: string; readonly timeZone: string }): TenantView {
  const plan = row.planKey === undefined ? null : planName(plans, row.planKey);
  const look = statusLook(row.status);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    statusLabel: look.label,
    region: row.region,
    plan,
    planKey: row.planKey ?? null,
    created: formatDateTime(row.createdAt, { ...format, style: 'date' }),
    createdAt: row.createdAt,
    aiRegions: row.aiAllowedRegions ?? null,
    suspendedSince: row.suspendedAt ? formatDateTime(row.suspendedAt, { ...format, style: 'date' }) : null,
    search: [row.name, row.slug, plan ?? '', row.region].join(' '),
  };
}

/* ---- A tenant's meters -------------------------------------------------------- */

const UNITS: Readonly<Record<string, MeterView['unit']>> = { agents: 'people', tickets: 'tickets', storage: 'bytes', api_calls: 'calls' };
const LIVE = new Set(['agents', 'storage']);

export function platformMeterViews(usage: PlatformTenantUsage, locale: string): MeterView[] {
  return usage.meters.map((meter) => {
    const unit = UNITS[meter.meter] ?? 'calls';
    return {
      meter: meter.meter,
      label: meterLabel(meter.meter),
      description: '',
      display: meter.display,
      period: periodText({ shape: LIVE.has(meter.meter) ? 'live' : 'counted', period: meter.period }, locale),
      unit,
      value: meter.value,
      soft: meter.soft,
      hard: meter.hard,
      state: meter.state,
      lines: linesText({ unit, soft: meter.soft, hard: meter.hard }, locale),
    };
  });
}

/** Regions in words: the allowed list, or the home region when the list is empty (what an empty list means). */
export function regionsText(regions: readonly string[] | null, home: string): string {
  if (regions === null) return 'Not reported by this API';
  if (regions.length === 0) return `Only where its data lives (${home})`;
  return regions.join(', ');
}

/** "eu-west, us" → ["eu-west", "us"]; the API's rule for a region name, said before the request. */
export function parseRegions(text: string): { readonly ok: true; readonly regions: string[] } | { readonly ok: false; readonly problem: string } {
  const regions = [...new Set(text.split(/[\s,]+/).map((part) => part.trim().toLowerCase()).filter(Boolean))].sort();
  if (regions.length > 10) return { ok: false, problem: 'List at most 10 regions.' };
  const bad = regions.find((region) => !/^[a-z][a-z0-9-]{1,30}$/.test(region));
  if (bad) return { ok: false, problem: `“${bad}” isn’t a region name. Use lower-case letters, digits and hyphens, such as eu-west.` };
  return { ok: true, regions };
}

/* ---- Plans ------------------------------------------------------------------ */

export interface PlanView {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: string;
  readonly retired: boolean;
  readonly limits: readonly { readonly label: string; readonly text: string }[];
  readonly features: readonly string[];
}

function limitAmount(meter: string, value: number, locale: string): string {
  if (meter === 'storage') {
    const gb = value / 1024 ** 3;
    return gb >= 1024 ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(gb / 1024)} TB` : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(gb)} GB`;
  }
  return new Intl.NumberFormat(locale).format(value);
}

/** One limit in words: "Up to 50 · warned at 40", "Warned at 400 · no limit". */
export function limitText(limit: { readonly meter: string; readonly soft: string | number | null; readonly hard: string | number | null }, locale = 'en-GB'): string {
  const soft = limit.soft === null ? null : Number(limit.soft);
  const hard = limit.hard === null ? null : Number(limit.hard);
  if (hard !== null && soft !== null) return `Up to ${limitAmount(limit.meter, hard, locale)} · warned at ${limitAmount(limit.meter, soft, locale)}`;
  if (hard !== null) return `Up to ${limitAmount(limit.meter, hard, locale)}`;
  if (soft !== null) return `No limit · warned at ${limitAmount(limit.meter, soft, locale)}`;
  return 'No limit';
}

const METER_ORDER = ['agents', 'tickets', 'storage', 'api_calls'];

export function planView(plan: PlanRow, locale = 'en-GB'): PlanView {
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description,
    price: formatPrice(plan.pricePerAgentMicros, plan.currency, locale),
    retired: plan.isRetired,
    limits: [...plan.limits]
      .sort((a, b) => METER_ORDER.indexOf(a.meter) - METER_ORDER.indexOf(b.meter))
      .map((limit) => ({ label: meterLabel(limit.meter), text: limitText(limit, locale) })),
    features: plan.features.map((feature) => flagEntry(feature).label),
  };
}

export function plansInOrder(plans: readonly PlanRow[]): PlanRow[] {
  return [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
