'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface OlderNewerProps {
  readonly olderHref?: string;
  readonly newerHref?: string;
  readonly firstHref?: string;
  readonly className?: string;
}

/**
 * Cursor paging for the audit log, the one list that pages rather than
 * appends. The page keeps the cursors it has visited so Newer can go back.
 *
 * Stub (SPEC §4.7): renders the links; the data package styles them and uses
 * the provider's link.
 */
export function OlderNewer({ olderHref, newerHref, firstHref, className }: OlderNewerProps): ReactNode {
  return (
    <nav aria-label="Pages" className={cx('itsm-OlderNewer', className)}>
      {firstHref ? <a href={firstHref}>Newest</a> : null}
      {newerHref ? <a href={newerHref}>Newer</a> : null}
      {olderHref ? <a href={olderHref}>Older</a> : null}
    </nav>
  );
}
