import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role'> {
  /** `sm` 16 px, `md` 20 px (default), `lg` 32 px. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Makes it a `status` with this name. Without it the spinner is decoration beside text that says what is happening. */
  readonly label?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

const SPOKES = 8;

/**
 * The spokes, brightest first and fading clockwise-behind, so the turning
 * head leads and the tail follows — the system activity indicator, not a
 * ring. Built once: the drawing never changes.
 */
const spokes = Array.from({ length: SPOKES }, (_, index) => (
  <line
    key={index}
    x1="12"
    y1="2.5"
    x2="12"
    y2="6.5"
    transform={`rotate(${index * (360 / SPOKES)} 12 12)`}
    strokeOpacity={Number((1 - ((SPOKES - index) % SPOKES) * 0.1).toFixed(2))}
  />
));

/**
 * Indeterminate activity. Server-safe.
 *
 * Eight spokes turned a step at a time, the way the platform draws it, in the
 * colour of the text around it (`text.muted` on its own). It is a small thing
 * on purpose: a spinner says "working", and a person reads the words next to
 * it for what. Under reduced motion — the operating system's or the product's
 * own setting — it stops turning and breathes instead, so the page still
 * shows it is busy without anything rotating.
 *
 * `role="status"` only with `label`: an unlabelled spinner is a picture of
 * activity beside text that already says what is happening, and a status
 * region with nothing in it is noise to a screen reader.
 */
export function Spinner({ size = 'md', label, className, ref, ...rest }: SpinnerProps): ReactNode {
  const drawing = (
    <svg
      className="itsm-Spinner__drawing"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      focusable="false"
      aria-hidden="true"
    >
      {spokes}
    </svg>
  );
  return label ? (
    <span {...rest} ref={ref} role="status" className={cx('itsm-Spinner', className)} data-size={size}>
      {drawing}
      <span className="itsm-visually-hidden">{label}</span>
    </span>
  ) : (
    <span {...rest} ref={ref} aria-hidden="true" className={cx('itsm-Spinner', className)} data-size={size}>
      {drawing}
    </span>
  );
}
