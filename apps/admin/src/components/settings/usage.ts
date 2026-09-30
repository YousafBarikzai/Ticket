import type { UsageMeter, UsageMeterKey } from '@itsm/sdk';

/**
 * Usage meters in words (Settings › Usage & plan), shared by the server page
 * and the client view — a pure module, because a server component cannot
 * call a function exported from a `'use client'` file.
 */

/** Storage is counted in bytes and read in GB (the API's own words use 1024). */
export const GB = 1024 ** 3;

export interface MeterView {
  readonly meter: UsageMeterKey;
  readonly label: string;
  readonly description: string;
  /** "12 people", "2.5 GB". */
  readonly display: string;
  /** "Now" for a level, "September 2026" for a monthly count. */
  readonly period: string;
  readonly unit: 'people' | 'tickets' | 'bytes' | 'calls';
  readonly value: number;
  readonly soft: number | null;
  readonly hard: number | null;
  readonly state: 'ok' | 'warned' | 'blocked';
  /** The two lines in a sentence: "The plan stops at 50. Administrators are warned at 45." */
  readonly lines: string;
}

const LABELS: Readonly<Record<UsageMeterKey, string>> = {
  agents: 'Agents',
  tickets: 'Tickets this month',
  storage: 'Storage',
  api_calls: 'API calls this month',
};

export function meterLabel(meter: UsageMeterKey | string): string {
  return LABELS[meter as UsageMeterKey] ?? meter.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** A meter's numbers in the unit a person types: GB for storage, counts for the rest. */
export function inputUnits(meter: Pick<MeterView, 'unit'>, raw: number | null): number | null {
  if (raw === null) return null;
  return meter.unit === 'bytes' ? Math.round((raw / GB) * 10) / 10 : raw;
}

export function fromInputUnits(meter: Pick<MeterView, 'unit'>, typed: number): number {
  return meter.unit === 'bytes' ? Math.round(typed * GB) : Math.round(typed);
}

function amount(meter: Pick<MeterView, 'unit'>, raw: number, locale: string): string {
  if (meter.unit === 'bytes') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(inputUnits(meter, raw)!)} GB`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(raw);
}

/** Why a warning line would be refused, or null — the API's rule, said before the request. */
export function softProblem(meter: Pick<MeterView, 'unit' | 'hard'>, typed: number | null, locale = 'en-GB'): string | null {
  if (typed === null || !Number.isFinite(typed)) return 'Enter a number, or use the plan’s line.';
  if (typed < 0) return 'Enter 0 or more.';
  if (meter.unit !== 'bytes' && !Number.isInteger(typed)) return 'Enter a whole number.';
  if (meter.hard !== null && fromInputUnits(meter, typed) > meter.hard) {
    return `The plan stops at ${amount(meter, meter.hard, locale)}, so a warning above it would never arrive. Choose something lower.`;
  }
  return null;
}

export function linesText(meter: Pick<MeterView, 'unit' | 'soft' | 'hard'>, locale: string): string {
  const hard = meter.hard !== null ? `The plan stops at ${amount(meter, meter.hard, locale)}.` : 'The plan sets no limit.';
  const soft = meter.soft !== null ? `Administrators are warned at ${amount(meter, meter.soft, locale)}.` : 'No warning line.';
  return `${hard} ${soft}`;
}

/** "2026-09" → "September 2026"; a live level reads "Now". */
export function periodText(meter: Pick<UsageMeter, 'shape' | 'period'>, locale: string): string {
  if (meter.shape === 'live') return 'Now';
  const month = /^(\d{4})-(\d{2})$/.exec(meter.period);
  if (!month) return meter.period;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
}

export function meterView(meter: UsageMeter, locale: string): MeterView {
  return {
    meter: meter.meter,
    label: meterLabel(meter.meter),
    description: meter.description,
    display: meter.display,
    period: periodText(meter, locale),
    unit: meter.unit,
    value: meter.value,
    soft: meter.soft,
    hard: meter.hard,
    state: meter.state,
    lines: linesText(meter, locale),
  };
}
