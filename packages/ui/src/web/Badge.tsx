import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { toneFromIntent } from '../display/tone.js';
import { Icon } from '../icons/Icon.js';
import type { IntentName } from '../tokens/tokens.js';
import type { IconName, Tone } from '../types.js';
import { cx } from './cx.js';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly children: ReactNode;
  /** The colour family. `neutral` by default. Never the only carrier of meaning: the label is. */
  readonly tone?: Tone;
  /**
   * @deprecated Use `tone` (SPEC §4.11). `brand` is `accent`. Kept, as an
   * alias, until the release after this one.
   */
  readonly intent?: IntentName;
  /**
   * `subtle` (default) is a tint that reads well in dense tables; `solid` is
   * for the one thing on a screen that must be seen (a P1); `outline` is a
   * ring with no fill, for a count or tag beside something already tinted.
   */
  readonly emphasis?: 'subtle' | 'solid' | 'outline';
  /** `md` (default) 20 px tall; `sm` 18 px for tight rows. */
  readonly size?: 'sm' | 'md';
  /** A registry icon before the label. Decorative: the label names the badge. */
  readonly icon?: IconName;
  /** Draws a dot before the label. Colour alone never carries the meaning (SC 1.4.1): the label does. */
  readonly dot?: boolean;
  /**
   * Prefix spoken before the label, e.g. "Priority". Badges are usually read
   * out of context in a table row, where "P1" alone means nothing.
   */
  readonly srPrefix?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/**
 * A short label in a capsule: a count, a tag, a small state.
 *
 * Server-safe, and themed entirely from CSS: the tone and emphasis are
 * `data-*` attributes that the stylesheet maps to audited token pairs (SPEC
 * §3.3 rule 6), where this used to build `var(--itsm-colour-…)` strings in an
 * inline style. That kept the colours out of reach of the high-contrast and
 * forced-colours rules; now they get an outline in both.
 *
 * For a *status* — something with a lifecycle — use `StatusPill`, which adds
 * the shape; a badge is for everything smaller.
 */
export function Badge({
  children,
  tone,
  intent,
  emphasis = 'subtle',
  size = 'md',
  icon,
  dot = false,
  srPrefix,
  className,
  ref,
  ...rest
}: BadgeProps): ReactNode {
  const resolved: Tone = tone ?? (intent ? toneFromIntent(intent) : 'neutral');
  return (
    <span
      {...rest}
      ref={ref}
      className={cx('itsm-Badge', className)}
      data-tone={resolved}
      data-emphasis={emphasis}
      data-size={size}
    >
      {dot ? <span className="itsm-Badge__dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 'xs'} className="itsm-Badge__icon" /> : null}
      {srPrefix ? <span className="itsm-visually-hidden">{`${srPrefix}: `}</span> : null}
      {children}
    </span>
  );
}
