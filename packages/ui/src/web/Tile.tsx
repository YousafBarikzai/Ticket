'use client';

import type { ReactNode } from 'react';
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
 * It renders an `<a>` when it has an `href` and a `<button>` otherwise, so the
 * element matches what it does: a tile that navigates can be opened in a new
 * tab and one that acts cannot pretend to be.
 */
export interface TileProps {
  readonly title: string;
  readonly description?: string;
  /** Decorative by default: the title already carries the meaning. */
  readonly icon?: ReactNode;
  readonly href?: string;
  readonly onClick?: () => void;
  /** Anything after the description — a count, a status, a time. */
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Tile({ title, description, icon, href, onClick, children, className }: TileProps): ReactNode {
  const inner = (
    <>
      {icon ? (
        <span className="itsm-Tile__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="itsm-Tile__title">{title}</span>
      {description ? <span className="itsm-Tile__description">{description}</span> : null}
      {children}
    </>
  );

  if (href !== undefined) {
    return (
      <a className={cx('itsm-Tile', className)} href={href}>
        {inner}
      </a>
    );
  }

  return (
    <button type="button" className={cx('itsm-Tile', className)} onClick={onClick}>
      {inner}
    </button>
  );
}

/** Tiles in a row that becomes a column on a narrow screen. */
export function TileGrid({ children, className }: { readonly children: ReactNode; readonly className?: string }): ReactNode {
  return <div className={cx('itsm-TileGrid', className)}>{children}</div>;
}
