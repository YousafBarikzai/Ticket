'use client';

import type { ReactNode } from 'react';
import type { MenuItemSpec } from '../overlays/Menu.js';
import type { ActionSpec, Crumb } from '../types.js';
import { cx } from '../web/cx.js';
import type { TabNavItem } from './TabNav.js';

export interface PageHeaderProps {
  readonly title: string;
  readonly titleId?: string;
  /** Only on list and hub pages, and only while they have no data. */
  readonly subtitle?: string;
  readonly breadcrumbs?: readonly Crumb[];
  readonly back?: { readonly href: string; readonly label: string };
  /** One of `status` or `meta` beside the title, never both (X-36). */
  readonly status?: ReactNode;
  readonly meta?: string;
  /** The page's one primary action. */
  readonly primaryAction?: ActionSpec | ReactNode;
  /** Collapse into the overflow menu below md. */
  readonly secondaryActions?: readonly ActionSpec[];
  readonly overflow?: readonly MenuItemSpec[];
  readonly tabs?: readonly TabNavItem[];
  readonly largeTitle?: boolean;
  readonly sticky?: boolean;
  /** Renders the *View only* pill-button that explains the missing permission (X-47). */
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
  readonly className?: string;
}

/**
 * The top of every page, and its only `<h1>` — which takes focus on
 * navigation (`tabindex="-1"`, the target of `RouteFocus`).
 *
 * Stub (SPEC §4.9): renders the heading and subtitle; the shell package adds
 * breadcrumbs, actions, tabs and the *View only* pill.
 */
export function PageHeader({ title, titleId, subtitle, className }: PageHeaderProps): ReactNode {
  return (
    <div className={cx('itsm-PageHeader', className)}>
      <h1 id={titleId} tabIndex={-1}>
        {title}
      </h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}
