import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export type IconTileSize = 28 | 32 | 36 | 40;

export interface IconTileProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly icon: IconName;
  /**
   * 28 (default) beside a card or section title and in rows, 32 on catalogue
   * cards, 36 in the sign-in panel's points, 40 at the head of a record.
   */
  readonly size?: IconTileSize;
  /**
   * `accent` (default) is the product's own tint — the area mark, a card's
   * glyph. A tone tints the tile with that intent's pair: `neutral` for ticket
   * types (D5: a type is never a status colour), `danger` for a breach.
   */
  readonly tone?: 'accent' | Tone;
  /**
   * The squircle corner, for the few static, decorative tiles that want it
   * (v3 §2.9: only `BrandMark` and `IconTile`). Browsers without
   * `corner-shape` draw the plain rounded square.
   */
  readonly squircle?: boolean;
  /**
   * What the glyph means, when nothing beside it says so. Without it the tile
   * is decoration and hidden from assistive technology — the usual case,
   * because a tile sits beside the words it illustrates.
   */
  readonly label?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/** The glyph inside each tile size: 16 in the small tiles, 18 at 32 and 36, 20 at 40. */
const glyph: Readonly<Record<IconTileSize, number>> = { 28: 16, 32: 18, 36: 18, 40: 20 };

/**
 * A glyph on a tinted square: the mark at the head of a card, a record, a
 * catalogue item, a notification row, an area in the switcher (v3 §2.13).
 *
 * Server-safe. The tint is an audited pair — the accent tile is
 * `surface.accentHover` under `brand.subtleText`, every tone its intent's
 * `subtle` under its `subtleText` — so the glyph clears 3:1 on its tile in
 * every theme without the caller choosing colours. Corners follow the
 * concentric rule: 8 px on the small tiles, 10 px (`item`) from 36 up.
 *
 * Inside a navy hero (`[data-surface="hero"]`) the tile turns to the hero's
 * own fill, edge and accent, so the sign-in panel and a hero's points need no
 * variant of their own.
 */
export function IconTile({ icon, size = 28, tone = 'accent', squircle = false, label, className, ref, ...rest }: IconTileProps): ReactNode {
  const px = glyph[size] ?? glyph[28];
  return (
    <span
      {...rest}
      ref={ref}
      className={cx('itsm-IconTile', className)}
      data-size={size}
      data-tone={tone}
      data-squircle={squircle ? '' : undefined}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <Icon name={icon} size={px} className="itsm-IconTile__glyph" />
    </span>
  );
}
