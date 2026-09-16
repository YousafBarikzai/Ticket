'use client';

import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { useStableId } from '../a11y/ids.js';

export interface CardProps {
  readonly children: ReactNode;
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  /** Controls, e.g. an overflow menu, rendered at the end of the header. */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  /**
   * Makes the whole card one control. The card then renders as a `button`, not
   * a `div` with a click handler, so it is reachable by keyboard and announced
   * as actionable.
   */
  readonly onActivate?: () => void;
  /** Set where the card is a landmark-worthy region, e.g. a ticket's SLA panel. */
  readonly asRegion?: boolean;
  readonly className?: string;
}

export function Card({ children, title, subtitle, actions, footer, onActivate, asRegion = false, className }: CardProps): ReactNode {
  const titleId = useStableId('itsm-card-title');

  const inner = (
    <>
      {title ? (
        <div className="itsm-Card__header">
          <div style={{ flex: 1 }}>
            <h3 className="itsm-Card__title" id={titleId}>
              {title}
            </h3>
            {subtitle ? <p className="itsm-Card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      <div className="itsm-Card__body">{children}</div>
      {footer ? <div className="itsm-Card__footer">{footer}</div> : null}
    </>
  );

  if (onActivate) {
    return (
      <button
        type="button"
        className={cx('itsm-Card itsm-Card--interactive', className)}
        onClick={onActivate}
        aria-labelledby={title ? titleId : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <section
      className={cx('itsm-Card', className)}
      aria-labelledby={asRegion && title ? titleId : undefined}
      role={asRegion ? 'region' : undefined}
    >
      {inner}
    </section>
  );
}
