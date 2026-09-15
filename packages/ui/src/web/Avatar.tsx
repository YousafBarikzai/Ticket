'use client';

import type { ReactNode } from 'react';
import { cx } from './cx.js';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export interface AvatarProps {
  /** The person's display name. Drives the initials and the accessible name. */
  readonly name: string;
  readonly src?: string;
  readonly size?: AvatarSize;
  readonly status?: PresenceStatus;
  /** True inside a list that already names the person; the avatar then adds nothing to announce. */
  readonly decorative?: boolean;
  readonly className?: string;
}

const sizes: Readonly<Record<AvatarSize, number>> = { xs: 20, sm: 28, md: 36, lg: 56 };

const statusIntent: Readonly<Record<PresenceStatus, string>> = {
  online: 'success',
  away: 'warning',
  busy: 'danger',
  offline: 'neutral',
};

/** "Ada Lovelace" → "AL", "Ada" → "A". Grapheme-aware enough for the scripts we ship. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

export function Avatar({ name, src, size = 'md', status, decorative = false, className }: AvatarProps): ReactNode {
  const px = sizes[size];
  return (
    <span
      className={cx('itsm-Avatar', className)}
      style={{ inlineSize: px, blockSize: px, fontSize: Math.round(px / 2.5) }}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
    >
      {src ? <img className="itsm-Avatar__image" src={src} alt="" /> : <span aria-hidden="true">{initials(name)}</span>}
      {status ? (
        <>
          <span
            className="itsm-Avatar__status"
            style={{ background: `var(--itsm-colour-${statusIntent[status]}-solid)` }}
            aria-hidden="true"
          />
          {decorative ? null : <span className="itsm-visually-hidden">{`, ${status}`}</span>}
        </>
      ) : null}
    </span>
  );
}
