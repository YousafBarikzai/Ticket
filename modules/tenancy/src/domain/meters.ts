/**
 * What is metered, and how each one counts.
 *
 * Four, because four is what a plan is priced on: how many people work the
 * desk, how much work comes in, how much is kept, and how hard the API is
 * pushed. Each is either a **live** figure — true right now, with no period
 * — or a **counted** one that resets each month. The difference matters
 * more than it looks: a live figure can be recomputed from the source rows
 * at any moment and compared against itself, and a counted one cannot,
 * which is why the counted ones carry the period they belong to and are
 * rebuilt from a date range rather than accumulated for ever.
 */

export const METERS = ['agents', 'tickets', 'storage', 'api_calls'] as const;
export type Meter = (typeof METERS)[number];

export type Shape = 'live' | 'counted';

export interface MeterDefinition {
  shape: Shape;
  /** Shown beside the number. */
  unit: 'people' | 'tickets' | 'bytes' | 'calls';
  /** What the act of growing it is, for the message a refusal carries. */
  act: string;
  description: string;
}

export const METER_CATALOGUE: Record<Meter, MeterDefinition> = {
  agents: {
    shape: 'live',
    unit: 'people',
    act: 'giving somebody a role that works the desk',
    description: 'Active people holding any role other than requester. A requester is never an agent, however many there are.',
  },
  tickets: {
    shape: 'counted',
    unit: 'tickets',
    act: 'raising a ticket',
    description: 'Tickets raised this month, through any channel. History brought in by a migration is not counted: it is not this month\'s work.',
  },
  storage: {
    shape: 'live',
    unit: 'bytes',
    act: 'attaching a file',
    description: 'Attachments kept, as they stand. A deleted attachment gives its space back at the next recompute.',
  },
  api_calls: {
    shape: 'counted',
    unit: 'calls',
    act: 'calling the API',
    description: 'Requests to the tenant API this month, excluding health checks and the public pages. Counted in the cache and flushed in batches, never a write per request.',
  },
};

export function isMeter(value: string): value is Meter {
  return (METERS as readonly string[]).includes(value);
}

/**
 * The period a counted meter belongs to, and the key that spells it out.
 *
 * Spelled out rather than left as a pair of nullable dates, because
 * PostgreSQL treats NULLs in a unique index as distinct from one another: a
 * live meter keyed on `(tenant, meter, null)` would never conflict with
 * itself and would insert a fresh duplicate on every upsert. MOD-12's
 * rollup learned this the same way.
 */
export function periodFor(meter: Meter, at: Date): { key: string; start: Date | null; end: Date | null } {
  if (METER_CATALOGUE[meter].shape === 'live') return { key: 'live', start: null, end: null };
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1)),
    // The last day of the month, inclusive: a period that ended on the 1st
    // of the next month would count one day twice at the boundary.
    end: new Date(Date.UTC(year, month + 1, 0)),
  };
}

export interface Lines {
  soft: bigint | null;
  hard: bigint | null;
}

export type State = 'ok' | 'warned' | 'blocked';

/** What a figure means against its lines. The hard line wins. */
export function stateFor(value: bigint, lines: Lines): State {
  if (lines.hard !== null && value >= lines.hard) return 'blocked';
  if (lines.soft !== null && value >= lines.soft) return 'warned';
  return 'ok';
}

/**
 * Which lines a figure has crossed that have not been announced yet.
 *
 * Both can be crossed at once — a tenant that imports two hundred agents
 * passes the warning and the limit in one step — and each is announced once
 * per period, so a nightly recompute that finds the same figure announces
 * nothing. Where the meter was before does not come into it: what matters
 * is where it is and what has already been said.
 */
export function crossings(value: bigint, lines: Lines, already: { warned: boolean; blocked: boolean }): State[] {
  const crossed: State[] = [];
  if (!already.warned && lines.soft !== null && value >= lines.soft) crossed.push('warned');
  if (!already.blocked && lines.hard !== null && value >= lines.hard) crossed.push('blocked');
  return crossed;
}

/** A number a person can read: 2.5 GB rather than 2684354560. */
export function describe(meter: Meter, value: bigint): string {
  if (METER_CATALOGUE[meter].unit !== 'bytes') return `${value.toLocaleString('en-GB')} ${METER_CATALOGUE[meter].unit}`;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return index === 0 ? `${size} bytes` : `${size.toFixed(1)} ${units[index]}`;
}

/** What a refusal says. Names the plan, the figure and who can change it. */
export function refusalMessage(meter: Meter, value: bigint, hard: bigint, planKey: string): string {
  return (
    `${METER_CATALOGUE[meter].act} would go past the ${planKey} plan's limit of ${describe(meter, hard)} ` +
    `(${describe(meter, value)} now). Ask whoever administers this tenant to move to a larger plan; ` +
    `everything already here keeps working.`
  );
}
