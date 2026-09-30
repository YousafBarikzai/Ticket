import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';
import { statusIcon } from './tone.js';

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly label: string;
  readonly tone: Tone;
  /**
   * `auto` (default) picks the tone's own shape — a dot, a clock, an "i", a
   * tick, a triangle, a circled "!" — so the state reads without its colour
   * (SC 1.4.1). Name a registry icon to say something more specific
   * ("pause" for paused).
   */
  readonly icon?: IconName | 'auto';
  /** Spoken first, e.g. "Status": a pill read out of context in a table row needs its question. */
  readonly srPrefix?: string;
  /** `md` (default) 24 px tall; `sm` 20 px for rows and meta lines. */
  readonly size?: 'sm' | 'md';
  /** `subtle` (default) tint, or `solid` for the one state that must be seen. */
  readonly emphasis?: 'subtle' | 'solid';
  /**
   * `button` only as a popover trigger — the *View only* pill — whose client
   * parent supplies the behaviour (a Radix trigger passes its handlers,
   * `aria-expanded` and `ref` straight through to the element).
   */
  readonly as?: 'span' | 'button';
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * A state as a pill: shape, icon and label. Applications map their lifecycle
 * states to it in their presentation modules. Server-safe. Replaces the
 * drafts' `LifecycleBadge` and `PriorityPill`.
 *
 * The label is always visible text; the icon is decoration beside it. The
 * `srPrefix` gives the label its question in a screen reader ("Status:
 * Waiting for you") without cluttering the screen.
 */
export function StatusPill({
  label,
  tone,
  icon = 'auto',
  srPrefix,
  size = 'md',
  emphasis = 'subtle',
  as = 'span',
  className,
  ref,
  ...rest
}: StatusPillProps): ReactNode {
  const name = icon === 'auto' ? statusIcon[tone] : icon;
  const content = (
    <>
      <Icon name={name} size={size === 'sm' ? 12 : 'xs'} className="itsm-StatusPill__icon" />
      <span className="itsm-StatusPill__label">
        {srPrefix ? <span className="itsm-visually-hidden">{`${srPrefix}: `}</span> : null}
        {label}
      </span>
    </>
  );
  const shared = {
    ...rest,
    className: cx('itsm-StatusPill', className),
    'data-tone': tone,
    'data-size': size,
    'data-emphasis': emphasis,
  };
  return as === 'button' ? (
    <button type="button" {...shared} ref={ref as Ref<HTMLButtonElement>}>
      {content}
    </button>
  ) : (
    <span {...shared} ref={ref as Ref<HTMLSpanElement>}>
      {content}
    </span>
  );
}
