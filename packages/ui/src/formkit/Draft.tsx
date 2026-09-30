'use client';

import type { ReactNode } from 'react';
import { Banner } from '../feedback/Banner.js';
import { formatDateTime } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from '../web/cx.js';

export interface DraftStatusProps {
  /** When the draft was last written; nothing is shown while there is none. */
  readonly savedAt: Date | null;
  readonly className?: string;
}

/** The reader's own zone when there is no provider to say (a test, a status page). */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * "Draft saved · 12:04", quietly, in footnote text beside a form's actions.
 *
 * Not a live region. A draft is written every few seconds while somebody
 * types, and hearing "Draft saved" every five seconds would drown out what
 * they are typing; the line is there to be seen, and to be read on request.
 */
export function DraftStatus({ savedAt, className }: DraftStatusProps): ReactNode {
  const itsm = useOptionalItsm();
  if (!savedAt) return null;
  const time = formatDateTime(savedAt, { locale: itsm?.locale ?? 'en-GB', timeZone: itsm?.timeZone ?? localTimeZone(), style: 'time' });
  return (
    <p className={cx('itsm-DraftStatus', className)}>
      <Icon name="check" size="xs" className="itsm-DraftStatus__icon" />
      <span>
        Draft saved · <time dateTime={savedAt.toISOString()}>{time}</time>
      </span>
    </p>
  );
}

export interface DraftNoticeProps {
  /** From `useDraft`: `restored` after a draft was put back, `outdated` when one was dropped. */
  readonly notice: 'restored' | 'outdated' | null;
  /** Client only. Throws the restored draft away (the caller puts the form back as it was). */
  readonly onDiscard: () => void;
  /** Client only. Hides the notice and keeps the draft. */
  readonly onDismiss: () => void;
  readonly className?: string;
}

/**
 * Tells somebody their draft came back — "Draft restored · Discard" — or
 * that it could not, because the form has changed since.
 *
 * A polite status, spoken once as the form opens: the answers in the fields
 * are not the ones the page was served with, and a person who did not type
 * them this time should know where they came from.
 */
export function DraftNotice({ notice, onDiscard, onDismiss, className }: DraftNoticeProps): ReactNode {
  if (notice === 'restored') {
    return (
      <Banner
        tone="neutral"
        variant="subtle"
        icon="history"
        title="Draft restored"
        className={cx('itsm-DraftNotice', className)}
        action={{ id: 'discard', label: 'Discard', variant: 'ghost' }}
        onAction={onDiscard}
        onDismiss={onDismiss}
      >
        Your answers from last time are back in place.
      </Banner>
    );
  }
  if (notice === 'outdated') {
    return (
      <Banner
        tone="neutral"
        variant="subtle"
        icon="info"
        className={cx('itsm-DraftNotice', className)}
        onDismiss={onDismiss}
      >
        This form changed since your draft was saved, so the draft was not restored.
      </Banner>
    );
  }
  return null;
}
