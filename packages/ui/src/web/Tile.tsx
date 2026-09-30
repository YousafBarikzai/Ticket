'use client';

import type { ReactNode, Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { isIconName } from '../icons/registry.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName } from '../types.js';
import { cx } from './cx.js';

/**
 * A large, obvious way in.
 *
 * The brief asks for three guided service tiles on the requester's home screen
 * and a row of metric tiles on the administrator's command centre, and those
 * are the same object seen twice: something a person points at, which lifts
 * when they do, and which takes them somewhere.
 *
 * A `Card` is not this. A card is a container for content that may or may not
 * be interactive; a tile is an action with a description attached, and its
 * whole surface is the target. Building this as a card with a link inside
 * would give a keyboard user a small target inside a large box, and a screen
 * reader two things where there is one.
 *
 * It renders a link when it has an `href` — the application's `Link` from
 * `ItsmProvider`, so navigation is client-side and prefetched — and a
 * `<button>` otherwise, so the element matches what it does: a tile that
 * navigates can be opened in a new tab and one that acts cannot pretend to be.
 * Its name is the title alone; the description, meta line and badge are its
 * description, so a screen reader hears "Something is broken, link" first and
 * the detail after, rather than a paragraph as a name.
 */
export interface TileProps {
  readonly title: string;
  readonly description?: string;
  /**
   * A registry icon, drawn white on the product's blue gradient squircle.
   * A node is also accepted (drawn in the same squircle). Decorative: the
   * title carries the meaning.
   */
  readonly icon?: IconName | ReactNode;
  readonly href?: string;
  /** Client only. Kept for tiles that act rather than navigate; they render as a button. */
  readonly onClick?: () => void;
  /** At the top end: a count, "New". Part of the tile's description. */
  readonly badge?: ReactNode;
  /** A quiet line at the bottom: "Needs approval", "Usually 2 days". */
  readonly meta?: string;
  /** Anything after the description — kept for existing callers. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLAnchorElement & HTMLButtonElement>;
}

export function Tile({ title, description, icon, href, onClick, badge, meta, children, className, ref }: TileProps): ReactNode {
  const ids = useStableId('itsm-tile');
  const Link = useOptionalItsm()?.Link;
  const titleId = `${ids}-title`;
  const describedBy = [description ? `${ids}-description` : null, meta ? `${ids}-meta` : null, badge ? `${ids}-badge` : null]
    .filter(Boolean)
    .join(' ');

  const hasIcon = icon !== undefined && icon !== null && icon !== false && icon !== '';
  const inner = (
    <>
      {hasIcon || badge ? (
        <span className="itsm-Tile__top">
          {hasIcon ? (
            <span className="itsm-Tile__icon" aria-hidden="true">
              {typeof icon === 'string' && isIconName(icon) ? <Icon name={icon} size="lg" /> : icon}
            </span>
          ) : null}
          {badge ? (
            <span className="itsm-Tile__badge" id={`${ids}-badge`}>
              {badge}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="itsm-Tile__text">
        <span className="itsm-Tile__title" id={titleId}>
          {title}
        </span>
        {description ? (
          <span className="itsm-Tile__description" id={`${ids}-description`}>
            {description}
          </span>
        ) : null}
      </span>
      {children}
      {meta ? (
        <span className="itsm-Tile__meta" id={`${ids}-meta`}>
          {meta}
        </span>
      ) : null}
    </>
  );

  const shared = {
    ref,
    className: cx('itsm-Tile', className),
    'aria-labelledby': titleId,
    'aria-describedby': describedBy || undefined,
  };

  if (href !== undefined) {
    // The ref reaches the application's `Link` through the spread: React 19
    // passes `ref` to a function component as a prop, and Next's `Link`
    // forwards it to its anchor.
    return Link ? (
      <Link {...shared} href={href}>
        {inner}
      </Link>
    ) : (
      <a {...shared} href={href}>
        {inner}
      </a>
    );
  }

  return (
    <button {...shared} type="button" onClick={onClick}>
      {inner}
    </button>
  );
}

export interface TileGridProps {
  readonly children: ReactNode;
  /** The most tiles in a row; fewer as the container narrows, down to one. Fits as many as 15 rem allows when unset. */
  readonly columns?: 2 | 3 | 4;
  readonly className?: string;
}

/** Tiles in a row that becomes a column on a narrow screen. */
export function TileGrid({ children, columns, className }: TileGridProps): ReactNode {
  return (
    <div className={cx('itsm-TileGrid', className)} data-columns={columns}>
      {children}
    </div>
  );
}
