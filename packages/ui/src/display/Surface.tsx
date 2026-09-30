import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export type SurfaceTone = 'raised' | 'sunken' | 'outline';
export type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';
export type SurfaceRadius = 'lg' | 'xl' | '2xl' | '3xl';
export type SurfaceElevation = 'none' | 'xs' | 'sm' | 'md';

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly as?: 'div' | 'section' | 'article' | 'li';
  /** `raised` (default) is a card on the canvas; `sunken` a well inside one; `outline` a hairline and no fill. */
  readonly tone?: SurfaceTone;
  /** `sm` 12 · `md` 16 (default) · `lg` 24, easing to 16 on a phone. */
  readonly padding?: SurfacePadding;
  /** `2xl` (18 px, the card radius) by default. */
  readonly radius?: SurfaceRadius;
  /** `none` by default; `xs` is a resting card. In the high-contrast themes every level is an outline instead. */
  readonly elevation?: SurfaceElevation;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The plain container every card-like thing is built on: a background, a
 * radius, padding and an optional shadow, all from tokens. Server-safe.
 *
 * Depth comes from elevation, not borders (SPEC §1.1): a raised surface on
 * the canvas has a whisper of shadow and, in the dark theme, the one-pixel
 * edge highlight that separates a dark card from a black canvas. In the
 * high-contrast themes the elevation tokens themselves become an outline, so
 * a surface is never told apart by a shade alone.
 */
export function Surface({
  as: Tag = 'div',
  tone = 'raised',
  padding = 'md',
  radius = '2xl',
  elevation = 'none',
  children,
  className,
  ref,
  ...rest
}: SurfaceProps): ReactNode {
  return (
    <Tag
      {...rest}
      ref={ref as Ref<HTMLDivElement & HTMLLIElement>}
      className={cx('itsm-Surface', className)}
      data-tone={tone}
      data-padding={padding}
      data-radius={radius}
      data-elevation={elevation}
    >
      {children}
    </Tag>
  );
}
