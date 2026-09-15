/**
 * When a contract needs attention, and which date that actually is.
 *
 * Not the end date. The date that matters is the **notice date** — the last day
 * you can tell a supplier you are not renewing — because after it the renewal
 * has already happened whatever anybody decides. A report that warns thirty
 * days before a contract *ends* on one with ninety days' notice is a report
 * that tells you sixty days too late, politely.
 *
 * Dates here are calendar dates with no time of day, held as `@db.Date` and
 * compared in whole days. A contract does not end at half past four.
 */

const DAY_MS = 86_400_000;

export const CONTRACT_KINDS = ['support', 'maintenance', 'lease', 'licence', 'subscription'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const COST_PERIODS = ['annual', 'monthly', 'one_off'] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];

export interface ContractDates {
  endsOn: Date;
  noticeDays: number | null;
  autoRenews: boolean;
}

/** Whole calendar days from one date to another, ignoring any time of day. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

/** The last day notice can be given, or null where none is required. */
export function noticeDate(contract: ContractDates): Date | null {
  if (contract.noticeDays === null) return null;
  return new Date(contract.endsOn.getTime() - contract.noticeDays * DAY_MS);
}

export type Urgency = 'ok' | 'notice_due' | 'notice_missed' | 'ending' | 'ended';

export interface Assessment {
  urgency: Urgency;
  daysToEnd: number;
  daysToNotice: number | null;
  /** Plain words, because this report is read by somebody in finance. */
  message: string;
}

/**
 * What state a contract is in today.
 *
 * `notice_missed` is the row that matters and the reason `autoRenews` is here:
 * a contract that auto-renews and whose notice window has closed has *already*
 * committed the money, and saying so is more useful than another warning about
 * a date that is no longer a decision. One that does not auto-renew is simply
 * ending, which is a different conversation and often a worse surprise — the
 * support contract nobody renewed, discovered on the day something breaks.
 */
export function assess(contract: ContractDates, now: Date = new Date(), warnDays = 30): Assessment {
  const daysToEnd = daysBetween(now, contract.endsOn);
  const notice = noticeDate(contract);
  const daysToNotice = notice ? daysBetween(now, notice) : null;

  if (daysToEnd < 0) {
    return {
      urgency: 'ended',
      daysToEnd,
      daysToNotice,
      message: contract.autoRenews
        ? 'This ended and renews automatically, so it has renewed.'
        : 'This ended. Anything relying on it is no longer covered.',
    };
  }

  if (daysToNotice !== null && daysToNotice < 0) {
    return {
      urgency: contract.autoRenews ? 'notice_missed' : 'ending',
      daysToEnd,
      daysToNotice,
      message: contract.autoRenews
        ? `Notice was due ${-daysToNotice} days ago, so this renews on its end date whatever is decided now.`
        : `Notice has passed and this does not renew: it ends in ${daysToEnd} days.`,
    };
  }

  if (daysToNotice !== null && daysToNotice <= warnDays) {
    return {
      urgency: 'notice_due',
      daysToEnd,
      daysToNotice,
      message:
        daysToNotice === 0
          ? 'Today is the last day to give notice.'
          : `Notice must be given within ${daysToNotice} days.`,
    };
  }

  if (daysToEnd <= warnDays) {
    return {
      urgency: 'ending',
      daysToEnd,
      daysToNotice,
      message: `This ends in ${daysToEnd} days.`,
    };
  }

  return { urgency: 'ok', daysToEnd, daysToNotice, message: `Ends in ${daysToEnd} days.` };
}

/** True where somebody should be told. */
export function needsAttention(assessment: Assessment): boolean {
  return assessment.urgency !== 'ok';
}
