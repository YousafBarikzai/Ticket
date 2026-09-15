import type { ReactNode } from 'react';
import { cx } from './cx.js';
import type { IntentName } from '../tokens/tokens.js';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly intent?: IntentName;
  /** `subtle` reads better in dense tables; `solid` is for the one status that must be seen. */
  readonly emphasis?: 'subtle' | 'solid';
  /** Draws a dot before the label. Colour alone never carries the meaning (SC 1.4.1), the label does. */
  readonly dot?: boolean;
  /**
   * Prefix spoken before the label, e.g. "Priority". Badges are usually read
   * out of context in a table row, where "P1" alone means nothing.
   */
  readonly srPrefix?: string;
  readonly className?: string;
}

export function Badge({ children, intent = 'neutral', emphasis = 'subtle', dot = false, srPrefix, className }: BadgeProps): ReactNode {
  const solid = emphasis === 'solid';
  return (
    <span
      className={cx('itsm-Badge', className)}
      style={{
        background: `var(--itsm-colour-${intent}-${solid ? 'solid' : 'subtle'})`,
        color: `var(--itsm-colour-${intent}-${solid ? 'solidText' : 'subtleText'})`,
        borderColor: solid ? 'transparent' : `var(--itsm-colour-${intent}-border)`,
      }}
    >
      {dot ? <span className="itsm-Badge__dot" aria-hidden="true" /> : null}
      {srPrefix ? <span className="itsm-visually-hidden">{`${srPrefix}: `}</span> : null}
      {children}
    </span>
  );
}
