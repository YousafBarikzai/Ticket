import type { ReactNode } from 'react';
import type { AppName } from '../theme/prefs.js';
import type { ActionSpec, Illustration } from '../types.js';
import { cx } from '../web/cx.js';

export interface StatusScreenProps {
  readonly illustration?: Illustration;
  readonly title: string;
  readonly body?: ReactNode;
  /** Links, as data, so a server-rendered page can offer them. */
  readonly actions?: readonly ActionSpec[];
  readonly brand?: AppName;
  readonly className?: string;
}

/**
 * A centred, branded full-page state: sign-in, signed out, offline, a global
 * error, a suspended tenant, "Opening Workbench…". Server-safe, because most
 * of those pages render before any provider exists.
 *
 * Stub (SPEC §4.5): renders the heading, body and link actions; the feedback
 * package adds the brand mark, illustration and layout.
 */
export function StatusScreen({ title, body, actions = [], brand, className }: StatusScreenProps): ReactNode {
  return (
    <div className={cx('itsm-StatusScreen', className)} data-brand={brand}>
      <h1>{title}</h1>
      {body}
      {actions
        .filter((action) => action.href)
        .map((action) => (
          <a key={action.id} href={action.href}>
            {action.label}
          </a>
        ))}
    </div>
  );
}
