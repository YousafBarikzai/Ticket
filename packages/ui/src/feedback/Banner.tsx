'use client';

import type { ReactNode } from 'react';
import type { ActionSpec, IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export interface BannerProps {
  readonly tone: Tone;
  readonly title?: string;
  readonly children?: ReactNode;
  /** The tone's icon by default; `false` for none. */
  readonly icon?: IconName | false;
  readonly action?: ActionSpec | ReactNode;
  /** Client only. Shows a close button. */
  readonly onDismiss?: () => void;
  /** Remembers the dismissal on this device under this key. */
  readonly dismissKey?: string;
  readonly variant?: 'inline' | 'subtle';
  readonly className?: string;
}

/**
 * A section-level notice: "Couldn't load failed deliveries · Retry",
 * "This rule is paused". `role="status"` for info and success; `alert` only
 * for danger caused by the person's own action. Replaces the drafts' `Callout`.
 *
 * Stub (SPEC §4.5): renders the title and body; the feedback package adds the
 * icon, action, dismissal and roles.
 */
export function Banner({ tone, title, children, variant = 'inline', className }: BannerProps): ReactNode {
  return (
    <div className={cx('itsm-Banner', className)} data-tone={tone} data-variant={variant}>
      {title ? <p className="itsm-Banner__title">{title}</p> : null}
      {children}
    </div>
  );
}
