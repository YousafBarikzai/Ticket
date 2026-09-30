'use client';

import type { ReactNode } from 'react';
import { formatBadgeCount } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from '../web/cx.js';
import type { NavBadge } from './nav.js';

/**
 * A navigation count — "3", "99+" — beside an item in the sidebar, the rail,
 * a route tab or the tab bar.
 *
 * The digits are drawn for the eye and hidden from assistive technology; the
 * link's name gains the spoken form instead (", 3 drafts" from `label`, or
 * the count), so a screen reader hears "Rules, 3 drafts" as one phrase
 * rather than "Rules" and a stray "3". Nothing is drawn for zero: an empty
 * badge is noise, and "0" reads as a problem.
 */
export function NavBadgeView({ badge, className }: { readonly badge: NavBadge | undefined; readonly className?: string }): ReactNode {
  const locale = useOptionalItsm()?.locale;
  if (!badge || !(badge.value > 0)) return null;
  const shown = formatBadgeCount(badge.value, badge.capped, locale);
  return (
    <span className={cx('itsm-NavBadge', className)} data-tone={badge.tone ?? 'neutral'}>
      <span className="itsm-NavBadge__count" aria-hidden="true">
        {shown}
      </span>
      <span className="itsm-visually-hidden">, {badge.label ?? shown}</span>
    </span>
  );
}
