'use client';

import type { ReactNode } from 'react';
import type { ActionSpec, IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export interface GlobalBannerProps {
  readonly tone: Tone;
  readonly title: string;
  readonly body?: string;
  readonly icon?: IconName;
  readonly action?: ActionSpec;
  /** Remembers the dismissal on this device under this key; without it the banner cannot be dismissed. */
  readonly dismissKey?: string;
  /** How it is announced when it appears; `false` for a banner present on load. */
  readonly live?: 'polite' | 'assertive' | false;
  readonly className?: string;
}

/**
 * A full-width strip at the top of the content column, for conditions that
 * apply to the whole app: a major incident, a background session end, "Your
 * access changed", a new version, a suspended tenant, an offline copy.
 *
 * Stub (SPEC §4.5): renders the title and body; the feedback package adds the
 * icon, action, dismissal and announcement.
 */
export function GlobalBanner({ tone, title, body, className }: GlobalBannerProps): ReactNode {
  return (
    <div className={cx('itsm-GlobalBanner', className)} data-tone={tone}>
      <p className="itsm-GlobalBanner__title">{title}</p>
      {body ? <p>{body}</p> : null}
    </div>
  );
}
