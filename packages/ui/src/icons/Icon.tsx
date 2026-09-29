import type { ReactNode } from 'react';
import { iconSize, type IconSizeToken } from '../tokens/tokens.js';
import { cx } from '../web/cx.js';
import type { IconName } from './registry.js';

export interface IconProps {
  readonly name: IconName;
  /** A size token (`md`, 18 px, by default) or a pixel size for the rare icon outside the ramp. */
  readonly size?: IconSizeToken | number;
  /** Makes the icon an image with this name. Without it the icon is decorative and hidden from assistive technology. */
  readonly label?: string;
  /** Arrows, chevrons, reply: mirrored in right-to-left text. */
  readonly directional?: boolean;
  readonly className?: string;
}

/**
 * One icon from the registry, as inline SVG.
 *
 * Server-safe — no `'use client'`, no hooks, no context — so an icon in a
 * server component costs no client JavaScript at all.
 *
 * Stub (SPEC §4.1): renders the sized, correctly labelled `<svg>` frame with
 * no drawing; the foundations package fills in the lucide node data.
 */
export function Icon({ name, size = 'md', label, directional = false, className }: IconProps): ReactNode {
  const px = typeof size === 'number' ? size : iconSize[size];
  return (
    <svg
      className={cx('itsm-Icon', className)}
      data-icon={name}
      data-directional={directional || undefined}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
