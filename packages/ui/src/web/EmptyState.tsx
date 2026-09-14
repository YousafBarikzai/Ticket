import type { ReactNode } from 'react';
import { cx } from './cx.js';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  /** The one thing the user can do about it. An empty state without a next step is a dead end. */
  readonly action?: ReactNode;
  readonly secondaryAction?: ReactNode;
  /** `search` and `error` change the heading level's context, not the styling. */
  readonly tone?: 'empty' | 'search' | 'error';
  readonly className?: string;
}

export function EmptyState({ title, description, icon, action, secondaryAction, tone = 'empty', className }: EmptyStateProps): ReactNode {
  return (
    <div
      className={cx('itsm-EmptyState', className)}
      // An error state is a status message the user did not ask for, so it is
      // announced; an empty list after a deliberate filter is not.
      role={tone === 'error' ? 'alert' : undefined}
    >
      {icon ? (
        <span className="itsm-EmptyState__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2 className="itsm-EmptyState__title">{title}</h2>
      {description ? <p className="itsm-EmptyState__body">{description}</p> : null}
      {action || secondaryAction ? (
        <div style={{ display: 'flex', gap: 'var(--itsm-space-xs)', marginBlockStart: 'var(--itsm-space-xs)' }}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
