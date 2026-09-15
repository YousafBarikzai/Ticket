/**
 * What a call costs, and whether the tenant has any left.
 *
 * Money is held in **micro-pence** — a millionth of a penny — because one
 * completion costs a fraction of a penny and a month of them has to add up
 * without rounding at every step. A limit is set in whole pence, because that
 * is what an administrator types; the conversion happens once, here, rather
 * than at each comparison.
 *
 * Every function is pure. The awkward parts of a budget are arithmetic and
 * thresholds, and they are worth being able to test without a provider, a
 * database or a clock.
 */

export const MICROS_PER_PENNY = 1_000_000n;

export type BudgetState = 'ok' | 'warned' | 'blocked';

export interface BudgetLines {
  /** Whole pence. Null means no warning line. */
  warnPence: number | null;
  /** Whole pence. Null means no cap: spend is recorded and never refused. */
  limitPence: number | null;
}

/** The calendar month a cost counts against. `2026-09`. */
export function periodFor(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface ModelPrice {
  /** Micro-pence per thousand tokens. */
  inputPerThousand: bigint;
  outputPerThousand: bigint;
}

/**
 * What each model costs. The stub's price is deliberately in the same range as
 * a real mid-sized model, so a budget that looks sensible against the stub
 * still looks sensible on the day OD-04 is closed and a real one is plugged
 * in. A price list of zeroes would have made every budget test vacuous.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'stub-small': { inputPerThousand: 60_000n, outputPerThousand: 300_000n },
  'stub-large': { inputPerThousand: 240_000n, outputPerThousand: 1_200_000n },
};

export const DEFAULT_MODEL = 'stub-small';

/**
 * The cost of one call, rounded up.
 *
 * Up, not to nearest: a platform that rounds its own costs down is a platform
 * that discovers the difference at the end of the quarter.
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): bigint {
  const price = MODEL_PRICES[model];
  if (!price) return 0n;
  const input = (BigInt(Math.max(0, inputTokens)) * price.inputPerThousand + 999n) / 1000n;
  const output = (BigInt(Math.max(0, outputTokens)) * price.outputPerThousand + 999n) / 1000n;
  return input + output;
}

export function penceToMicros(pence: number): bigint {
  return BigInt(Math.max(0, Math.trunc(pence))) * MICROS_PER_PENNY;
}

/**
 * Where a figure sits against the lines. `>=` on both, so a budget set to
 * exactly what has been spent is reached rather than nearly reached — the
 * reading an administrator expects from "a limit of £20".
 */
export function stateFor(spentMicros: bigint, lines: BudgetLines): BudgetState {
  if (lines.limitPence !== null && spentMicros >= penceToMicros(lines.limitPence)) return 'blocked';
  if (lines.warnPence !== null && spentMicros >= penceToMicros(lines.warnPence)) return 'warned';
  return 'ok';
}

/**
 * Which lines this figure has newly crossed, given what has already been
 * announced. Depends only on the figure and on what was said before, so a
 * recomputation cannot announce the same line twice.
 */
export function crossings(
  spentMicros: bigint,
  lines: BudgetLines,
  already: { warned: boolean; blocked: boolean },
): BudgetState[] {
  const state = stateFor(spentMicros, lines);
  const out: BudgetState[] = [];
  if (!already.warned && (state === 'warned' || state === 'blocked')) out.push('warned');
  if (!already.blocked && state === 'blocked') out.push('blocked');
  return out;
}

/** `£12.40`. Two decimal places, because that is how money is read. */
export function formatMicros(micros: bigint): string {
  const pence = micros / MICROS_PER_PENNY;
  const pounds = pence / 100n;
  const remainder = pence % 100n;
  return `£${pounds}.${String(remainder).padStart(2, '0')}`;
}

export function formatPence(pence: number): string {
  return formatMicros(penceToMicros(pence));
}

/**
 * What a person is told when the budget stops them.
 *
 * It names the figure, the cap and the month, and it says what still works —
 * because the thing a desk needs to know at that moment is not that AI is off
 * but that its tickets are not.
 */
export function refusalMessage(spentMicros: bigint, limitPence: number, periodKey: string): string {
  return (
    `this tenant has spent ${formatMicros(spentMicros)} of its ${formatPence(limitPence)} AI budget for ${periodKey}, ` +
    'so suggestions are paused until next month or until an administrator raises the budget. ' +
    'Everything else — tickets, replies, search and finding similar work — is unaffected.'
  );
}

/**
 * How lines are checked before they are saved.
 *
 * A warning above the cap is refused, for the reason MOD-21 refuses the same
 * thing: a warning nobody reaches before the refusal is a warning that does
 * not exist.
 */
export function problemWithLines(lines: BudgetLines): string | null {
  if (lines.warnPence !== null && lines.limitPence !== null && lines.warnPence > lines.limitPence) {
    return `a warning at ${formatPence(lines.warnPence)} is above the ${formatPence(lines.limitPence)} cap, so it would never be reached`;
  }
  return null;
}
