import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';
import { priorityLook } from './ticket-states.js';

export interface SignalBarsProps {
  /** How many of the three bars are filled: 3 for P1 and P2, 2 for P3, 1 for P4, 0 for none. */
  readonly filled: 0 | 1 | 2 | 3;
  readonly className?: string;
}

/** The three bars, left to right: 2 units wide, 3 apart, rising to the top of a 10-unit box. */
const BARS = [
  { x: 1, height: 4 },
  { x: 4, height: 6.5 },
  { x: 7, height: 9 },
] as const;
/** Every bar stands on this line, half a unit above the box's foot so its rounded end is not clipped. */
const BASELINE = 9.5;

/**
 * Three rising bars, as on a phone's signal meter: the priority's strength as
 * a shape (v3 §2.14, A1 §7.8). Decorative — the chip beside it says the
 * priority in words — so it is hidden from assistive technology. Drawn in
 * `currentColor`; the bars a priority does not reach stay as faint outlines
 * of the shape, so P4's single bar still reads as "one of three".
 * Server-safe.
 */
export function SignalBars({ filled, className }: SignalBarsProps): ReactNode {
  return (
    <svg
      className={cx('itsm-SignalBars', className)}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
      data-filled={filled}
    >
      {BARS.map((bar, index) => (
        <rect
          key={bar.x}
          className="itsm-SignalBars__bar"
          x={bar.x}
          y={BASELINE - bar.height}
          width={2}
          height={bar.height}
          rx={0.5}
          data-on={index < filled ? '' : undefined}
        />
      ))}
    </svg>
  );
}

export interface PriorityChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** `P1`–`P4`. Anything else is drawn as given, in a neutral chip without bars. */
  readonly priority: string;
  /** Adds the word after the code: "P2 · High". */
  readonly words?: boolean;
  /** `md` (default) 20 px; `sm` 18 px, for rows and kanban cards. */
  readonly size?: 'sm' | 'md';
  /** The question a screen reader hears first; "Priority" by default, spoken "Priority 1, critical". */
  readonly srPrefix?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/**
 * A ticket's priority as a chip: signal bars, the code, optionally the word
 * (v3 §2.14). P1 is danger red and P2 `high` orange, both with three bars;
 * P3 is neutral with two; P4 is a quiet neutral with one. P1 and P2 share
 * their bar count, as on the benchmark board, and are told apart by the code
 * and the tint, so colour is never the only cue (SC 1.4.1).
 *
 * The code ("P1") is shorthand for the eye. A screen reader hears the whole
 * thing instead — "Priority 1, critical" — from a visually hidden phrase, and
 * the drawn text is hidden from it so nothing is said twice.
 *
 * Agents' surfaces only: priority is never shown to requesters, so the Help
 * Portal never renders this (`apps/portal`'s route-weight test holds it to
 * that). Server-safe.
 */
export function PriorityChip({ priority, words = false, size = 'md', srPrefix = 'Priority', className, ref, ...rest }: PriorityChipProps): ReactNode {
  const look = priorityLook(priority);
  const shown = look ? (words ? `${look.label} · ${look.words}` : look.label) : priority;
  const spoken = look ? `${srPrefix} ${look.label.slice(1)}, ${look.words.toLowerCase()}` : `${srPrefix}: ${priority}`;
  return (
    <span
      {...rest}
      ref={ref}
      className={cx('itsm-PriorityChip', className)}
      data-tone={look?.tone ?? 'neutral'}
      data-priority={look?.label}
      data-quiet={look?.quiet ? '' : undefined}
      data-size={size}
    >
      {look ? <SignalBars filled={look.bars} className="itsm-PriorityChip__bars" /> : null}
      <span className="itsm-PriorityChip__label" aria-hidden="true">
        {shown}
      </span>
      <span className="itsm-visually-hidden">{spoken}</span>
    </span>
  );
}
