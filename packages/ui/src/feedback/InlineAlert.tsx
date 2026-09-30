import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';
import { toneIcon } from './tone.js';

export interface InlineAlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly tone: Tone;
  /** The sentence, and at most a small action after it ("Couldn't draft a reply. Retry"). */
  readonly children: ReactNode;
  /** The tone's own icon by default. */
  readonly icon?: IconName;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * A compact notice inside a field, a card or an inspector: "Monthly AI budget
 * reached", "Somebody else changed this ticket · Reload". Server-safe.
 *
 * Quieter than `Banner` by design — smaller type, tighter padding, no title —
 * because it sits next to the thing it is about. It has no live-region role
 * of its own: most are part of the page as it loads, and one that appears in
 * answer to an action can be given `role="status"` or `role="alert"` by the
 * caller, who knows which it is.
 */
export function InlineAlert({ tone, children, icon, className, ref, ...rest }: InlineAlertProps): ReactNode {
  return (
    <div {...rest} ref={ref} className={cx('itsm-InlineAlert', className)} data-tone={tone}>
      <Icon name={icon ?? toneIcon[tone]} size="sm" className="itsm-InlineAlert__icon" />
      <div className="itsm-InlineAlert__body">{children}</div>
    </div>
  );
}
