'use client';

import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';

export interface OlderNewerProps {
  readonly olderHref?: string;
  readonly newerHref?: string;
  readonly firstHref?: string;
  /** The navigation's name. Default "Pages". */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Cursor paging for the audit log, the one list that pages rather than
 * appends (D13). The page keeps the cursors it has visited — a
 * `sessionStorage` stack keyed by the list's URL — so *Newer* can go back;
 * this component only draws the three links it is given.
 *
 * Real links through the application's `Link`, so each page has a URL, Back
 * works, and a middle-click opens it. An end that has nowhere to go is a
 * disabled button in the same place, so the pair never jumps sideways;
 * *Newest* appears only once there is a newer page to skip past.
 */
export function OlderNewer({ olderHref, newerHref, firstHref, label = 'Pages', className }: OlderNewerProps): ReactNode {
  return (
    <nav aria-label={label} className={cx('itsm-OlderNewer', className)}>
      {firstHref && newerHref ? (
        <Button className="itsm-OlderNewer__first" size="sm" variant="ghost" href={firstHref} prefetch={false}>
          Newest
        </Button>
      ) : null}
      <span className="itsm-OlderNewer__pair">
        <Button size="sm" variant="secondary" iconStart={<Icon name="chevron-left" directional />} {...(newerHref ? { href: newerHref, prefetch: false } : { disabled: true })}>
          Newer
        </Button>
        <Button size="sm" variant="secondary" iconEnd={<Icon name="chevron-right" directional />} {...(olderHref ? { href: olderHref, prefetch: false } : { disabled: true })}>
          Older
        </Button>
      </span>
    </nav>
  );
}
