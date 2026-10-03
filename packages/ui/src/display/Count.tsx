import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { formatBadgeCount, formatNumber } from '../format/format.js';
import type { Plural } from '../types.js';
import { cx } from '../web/cx.js';

export interface CountProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The number. `null` — not counted, not known — renders nothing: an absent count is never drawn as 0. */
  readonly value: number | null;
  /** The source stopped counting at `value` (a probe that said "more available"): drawn "12+", spoken "12 or more". */
  readonly capped?: boolean;
  /** `neutral` (default) for a plain count, `accent` beside the current tab or filter, `danger` for breaches. */
  readonly tone?: 'neutral' | 'accent' | 'danger';
  /** `md` (default) 20 px for headers and columns; `sm` 16 px inside tabs, pills and segments. */
  readonly size?: 'sm' | 'md';
  /**
   * The noun a screen reader hears after the number: "tickets", or
   * `{ one: 'ticket', other: 'tickets' }` to agree with it. Without it the
   * number is spoken alone, which is right where the label beside it already
   * names the thing ("Breached, 3").
   */
  readonly label?: string | Plural;
  /** For the digits; `en-GB` by default. A prop rather than the provider's, so the count renders on the server. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/** Past this the pill says "99+": a wider number would push the label it counts out of its row. */
const MAX_SHOWN = 99;

/** The noun's form for `count`; `'many'` for a count that is only known to be large. */
function noun(label: string | Plural, count: number | 'many', locale: string): string {
  if (typeof label === 'string') return label;
  if (count === 'many') return label.other;
  let form: string;
  try {
    form = new Intl.PluralRules(locale).select(count);
  } catch {
    // A locale tag the runtime does not know: English rules rather than a crash in a pill.
    form = count === 1 ? 'one' : 'other';
  }
  return form === 'one' ? label.one : label.other;
}

/**
 * The words behind the digits. "99+" and "12+" are shorthand for the eye; a
 * screen reader says what they mean — "more than 99", "12 or more" — and the
 * noun agrees with the number when it is given as a `Plural`.
 */
function spokenCount(value: number, capped: boolean, label: string | Plural | undefined, locale: string): string {
  const whole = Math.max(0, Math.trunc(value));
  const over = whole > MAX_SHOWN;
  const amount = formatNumber(over ? MAX_SHOWN : whole, { locale });
  const phrase = over ? `more than ${amount}` : capped ? `${amount} or more` : amount;
  if (label === undefined) return phrase;
  return `${phrase} ${noun(label, over || capped ? 'many' : whole, locale)}`;
}

/**
 * A count in a small pill — "7", "99+" — beside the thing it counts: a nav
 * item, a tab, a filter pill, a kanban column, a section heading, a segment.
 * One component, so a count looks and reads the same wherever it sits.
 *
 * Server-safe: no hooks, no provider, no handlers.
 *
 * The digits are drawn for the eye and hidden from assistive technology; a
 * visually hidden phrase carries the meaning instead, starting with a comma so
 * the name of whatever contains it reads as one phrase: a tab "Breached" with
 * a count is announced "Breached, 3", not "Breached 3" run together, and a
 * capped count is "more than 99", never "ninety-nine plus".
 */
export function Count({ value, capped = false, tone = 'neutral', size = 'md', label, locale = 'en-GB', className, ref, ...rest }: CountProps): ReactNode {
  if (value === null || !Number.isFinite(value)) return null;
  return (
    <span {...rest} ref={ref} className={cx('itsm-Count', className)} data-tone={tone} data-size={size}>
      <span className="itsm-Count__value" aria-hidden="true">
        {formatBadgeCount(value, capped, locale)}
      </span>
      <span className="itsm-visually-hidden">{`, ${spokenCount(value, capped, label, locale)}`}</span>
    </span>
  );
}
