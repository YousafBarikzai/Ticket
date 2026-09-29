import type { ReactNode } from 'react';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export interface StatusPillProps {
  readonly label: string;
  readonly tone: Tone;
  /** `auto` picks the tone's icon. Shape and icon carry the state as well as colour (SC 1.4.1). */
  readonly icon?: IconName | 'auto';
  /** Spoken first, e.g. "Status": a pill read out of context in a table row needs its question. */
  readonly srPrefix?: string;
  readonly size?: 'sm' | 'md';
  readonly emphasis?: 'subtle' | 'solid';
  /** `button` only as a popover trigger (the *View only* pill), which supplies the behaviour. */
  readonly as?: 'span' | 'button';
  readonly className?: string;
}

/**
 * A state as a pill: shape, icon and label. Applications map their lifecycle
 * states to it in their presentation modules. Server-safe. Replaces the
 * drafts' `LifecycleBadge` and `PriorityPill`.
 *
 * Stub (SPEC §4.6): renders the label; the display package adds the icon and
 * tone styling.
 */
export function StatusPill({ label, tone, srPrefix, size = 'md', emphasis = 'subtle', as = 'span', className }: StatusPillProps): ReactNode {
  const content = (
    <>
      {srPrefix ? <span className="itsm-visually-hidden">{`${srPrefix}: `}</span> : null}
      {label}
    </>
  );
  const props = { className: cx('itsm-StatusPill', className), 'data-tone': tone, 'data-size': size, 'data-emphasis': emphasis };
  return as === 'button' ? (
    <button type="button" {...props}>
      {content}
    </button>
  ) : (
    <span {...props}>{content}</span>
  );
}
