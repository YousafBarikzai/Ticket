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
 * What each model costs.
 *
 * Only the stub is priced here, and deliberately so. A real model's price is
 * published by its vendor, changes without asking this repository, and is
 * quoted in another currency — so a number hard-coded here would be a guess
 * that looks like a fact, and the thing it decides is when a tenant stops
 * being able to spend money. Real prices are supplied by whoever runs the
 * deployment, through `registerModelPrices`.
 *
 * The stub's price is in the same range as a mid-sized model on purpose, so a
 * budget that looks sensible against it still looks sensible against a real
 * one. A price list of zeroes would have made every budget test vacuous.
 */
const BUILT_IN_PRICES: Record<string, ModelPrice> = {
  'stub-small': { inputPerThousand: 60_000n, outputPerThousand: 300_000n },
  'stub-large': { inputPerThousand: 240_000n, outputPerThousand: 1_200_000n },
};

const registered = new Map<string, ModelPrice>();

/**
 * Installs the prices for this deployment's models, in micro-pence per
 * thousand tokens.
 *
 * Called once at boot from whatever the operator configured. Repeated calls
 * replace a model's price rather than accumulating, so a correction is one
 * restart rather than a mystery.
 */
export function registerModelPrices(prices: Readonly<Record<string, ModelPrice>>): void {
  for (const [model, price] of Object.entries(prices)) registered.set(model, price);
}

/** Test helper, and the way a deployment forgets a price it should not have had. */
export function clearModelPrices(): void {
  registered.clear();
}

export function priceFor(model: string): ModelPrice | null {
  return registered.get(model) ?? BUILT_IN_PRICES[model] ?? null;
}

export function pricedModels(): string[] {
  return [...new Set([...Object.keys(BUILT_IN_PRICES), ...registered.keys()])].sort();
}

export const DEFAULT_MODEL = 'stub-small';

/**
 * Whether a call against this model can be costed at all.
 *
 * Checked **before** the call, not after, and this is the important part: an
 * unpriced model used to cost `0n`, which meant every budget silently stopped
 * working the moment somebody pointed a prompt at a model nobody had priced.
 * A budget that cannot see a cost is not a budget, and the honest failure is a
 * refusal an operator can read rather than an invoice they cannot explain.
 */
export function isPriced(model: string): boolean {
  return priceFor(model) !== null;
}

/**
 * The cost of one call, rounded up.
 *
 * Up, not to nearest: a platform that rounds its own costs down is a platform
 * that discovers the difference at the end of the quarter.
 *
 * Returns `0n` for a model with no price, which is only reachable when the
 * model was priced at the moment of the call and unpriced by the time it
 * returned. `isPriced` is where that case is refused.
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): bigint {
  const price = priceFor(model);
  if (!price) return 0n;
  const input = (BigInt(Math.max(0, inputTokens)) * price.inputPerThousand + 999n) / 1000n;
  const output = (BigInt(Math.max(0, outputTokens)) * price.outputPerThousand + 999n) / 1000n;
  return input + output;
}

/**
 * Reads an operator's price list.
 *
 * `{"claude-sonnet-5": {"inputPerThousand": 240000, "outputPerThousand": 1200000}}`
 * — micro-pence per thousand tokens, because that is the unit the budget works
 * in and a conversion left to a configuration file is a conversion nobody
 * checks. Anything malformed throws rather than being skipped: a price list
 * that half-loaded would produce a budget that half-works.
 */
export function parseModelPrices(json: string): Record<string, ModelPrice> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the model price list must be an object keyed by model name');
  }

  const out: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as { inputPerThousand?: unknown; outputPerThousand?: unknown };
    const input = Number(entry?.inputPerThousand);
    const output = Number(entry?.outputPerThousand);
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      throw new Error(`the price for ${model} needs a non-negative inputPerThousand and outputPerThousand`);
    }
    out[model] = { inputPerThousand: BigInt(Math.round(input)), outputPerThousand: BigInt(Math.round(output)) };
  }
  return out;
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

/**
 * Money, at the scale it is actually being talked about.
 *
 * A pound figure for a month's budget, and **pence with decimals for one
 * call**, because a completion costs a fraction of a penny and rendering that
 * as `£0.00` tells an operator the thing is free. It is not free; it is
 * cheap, and the difference is the whole reason the budget exists. Nothing
 * ever rounds a non-zero cost to nothing: below a thousandth of a penny it
 * says so rather than pretending.
 */
export function formatMicros(micros: bigint): string {
  if (micros >= 100n * MICROS_PER_PENNY) {
    const pence = micros / MICROS_PER_PENNY;
    return `£${pence / 100n}.${String(pence % 100n).padStart(2, '0')}`;
  }
  if (micros === 0n) return '£0.00';
  // Three decimal places of a penny, trailing zeros trimmed.
  const thousandths = (micros + 999n) / 1000n;
  if (thousandths === 0n) return '<0.001p';
  const whole = thousandths / 1000n;
  const fraction = String(thousandths % 1000n).padStart(3, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}p` : `${whole}p`;
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
