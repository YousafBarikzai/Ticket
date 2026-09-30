import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { isIconName } from '../icons/registry.js';
import type { IconSizeToken } from '../tokens/tokens.js';
import type { IconName } from '../types.js';
import { cx } from './cx.js';

export interface IconSlotProps {
  /** A registry name, drawn with `Icon`, or any node (an app's own SVG, a legacy glyph). */
  readonly icon: IconName | ReactNode;
  readonly size?: IconSizeToken;
  readonly className?: string;
}

/**
 * The icon position of a control — `Button`'s start and end icons,
 * `IconButton`, a field's prefix, a segment's glyph.
 *
 * Controls take `IconName | ReactNode` (SPEC §4.2): a server component can
 * name a registry icon in serialisable props, and a client caller can still
 * pass its own drawing. A string that is not a registry name is rendered as
 * text, which keeps the legacy glyph icons ("✕", "›") working for the release
 * in which they are deprecated (§4.11). Either way the slot is decorative:
 * the control names itself.
 *
 * Server-safe: no directive, no hooks.
 */
export function IconSlot({ icon, size = 'sm', className }: IconSlotProps): ReactNode {
  if (icon === null || icon === undefined || icon === false || icon === true || icon === '') return null;
  if (typeof icon === 'string' && isIconName(icon)) return <Icon name={icon} size={size} className={className} />;
  return (
    <span className={cx('itsm-IconSlot', className)} aria-hidden="true">
      {icon}
    </span>
  );
}
