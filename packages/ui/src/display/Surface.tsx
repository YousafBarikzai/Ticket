import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SurfaceProps {
  readonly as?: 'div' | 'section' | 'article' | 'li';
  readonly tone?: 'raised' | 'sunken' | 'outline';
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
  readonly radius?: 'lg' | 'xl' | '2xl' | '3xl';
  readonly elevation?: 'none' | 'xs' | 'sm' | 'md';
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * The plain container every card-like thing is built on: a background, a
 * radius, padding and an optional shadow, all from tokens. Server-safe.
 *
 * Stub (SPEC §4.6): renders the element with its settings as data attributes;
 * the display package styles them.
 */
export function Surface({
  as: Tag = 'div',
  tone = 'raised',
  padding = 'md',
  radius = '2xl',
  elevation = 'none',
  children,
  className,
}: SurfaceProps): ReactNode {
  return (
    <Tag
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
