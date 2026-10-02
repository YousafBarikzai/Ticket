import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';
import { statusIcon } from './tone.js';

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly label: string;
  /**
   * Any of the eight tones. Ticket, SLA, approval and component states take
   * theirs from `ticket-states.ts` — `hold` for every wait, `high` for a P2 or
   * a degraded service — so `warning` stays SLA risk alone (D5).
   */
  readonly tone: Tone;
  /**
   * `auto` (default) picks the tone's own shape — a dot, a clock, an "i", a
   * tick, a triangle, a circled "!", a pause, a flag — so the state reads
   * without its colour (SC 1.4.1). Name a registry icon to say something more
   * specific ("hourglass" for an approval).
   */
  readonly icon?: IconName | 'auto';
  /** Spoken first, e.g. "Status": a pill read out of context in a table row needs its question. */
  readonly srPrefix?: string;
  /** `md` (default) 22 px tall; `sm` 20 px for rows, cards and meta lines. */
  readonly size?: 'sm' | 'md';
  /** `subtle` (default) tint, or `solid` for the one state that must be seen. */
  readonly emphasis?: 'subtle' | 'solid';
  /**
   * A short figure after the label, set off by a middle dot: `meta="16"`
   * draws "Critical · 16" — the score of a risk, the count behind a state.
   */
  readonly meta?: string;
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
 * A state as a pill: shape, icon and label. Server-safe.
 *
 * Ticket states spread their look straight in —
 * `<StatusPill {...ticketStateLook(status, category)} />` — so a state looks
 * the same in the inbox, on the board, in the Help Portal and in the admin
 * register (v3 §2.4, §2.14). Pages map anything else to a tone in their
 * presentation modules.
 *
 * The label is always visible text; the icon is decoration beside it. The
 * `srPrefix` gives the label its question in a screen reader ("Status:
 * Waiting on requester") without cluttering the screen. On a navy hero the
 * stylesheet turns the pill into an outlined chip in the hero's own text
 * colour, because a pale tint on navy would be an unaudited pair.
 */
export function StatusPill({
  label,
  tone,
  icon = 'auto',
  srPrefix,
  size = 'md',
  emphasis = 'subtle',
  meta,
  as = 'span',
  className,
  ref,
  ...rest
}: StatusPillProps): ReactNode {
  const name = icon === 'auto' ? statusIcon[tone] : icon;
  const extra = meta?.trim();
  const content = (
    <>
      <Icon name={name} size={size === 'sm' ? 12 : 'xs'} className="itsm-StatusPill__icon" />
      <span className="itsm-StatusPill__label">
        {srPrefix ? <span className="itsm-visually-hidden">{`${srPrefix}: `}</span> : null}
        {label}
        {extra ? <span className="itsm-StatusPill__meta">{` · ${extra}`}</span> : null}
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
