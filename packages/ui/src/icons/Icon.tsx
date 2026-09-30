import { createElement, type ReactNode, type SVGAttributes } from 'react';
import { iconSize, type IconSizeToken } from '../tokens/tokens.js';
import { cx } from '../web/cx.js';
import { iconNodes } from './nodes.js';
import type { IconName } from './registry.js';

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'name' | 'children' | 'width' | 'height'> {
  readonly name: IconName;
  /** A size token (`md`, 18 px, by default) or a pixel size for the rare icon outside the ramp. */
  readonly size?: IconSizeToken | number;
  /** Makes the icon an image with this name. Without it the icon is decorative and hidden from assistive technology. */
  readonly label?: string;
  /** Arrows, chevrons, reply: mirrored in right-to-left text. */
  readonly directional?: boolean;
  readonly className?: string;
}

/** The stroke the product draws at every size, in CSS pixels (SPEC §1.8). */
const STROKE_PX = 1.75;
/** lucide draws on a 24-unit grid. */
const GRID = 24;

/**
 * One icon from the registry, as inline SVG.
 *
 * Server-safe — no `'use client'`, no hooks, no context — so an icon in a
 * server component costs no client JavaScript at all.
 *
 * The stroke is 1.75 px at every size ("absolute stroke width"): lucide's
 * default 2 units would draw a 14 px icon hairline-thin and a 32 px one heavy,
 * so the width in grid units is worked out from the size instead. Token sizes
 * are also set in the stylesheet in `rem`, so icons grow with a person's text
 * size along with the words beside them; the `width`/`height` attributes are
 * the fallback where no stylesheet has loaded.
 *
 * Decorative by default (`aria-hidden`): an icon next to a label says nothing
 * the label does not. Give `label` only where the icon is the whole message.
 * A name that is not in the registry — possible only when it arrived as data —
 * draws an empty square of the right size rather than throwing.
 */
export function Icon({ name, size = 'md', label, directional = false, className, ...rest }: IconProps): ReactNode {
  const px = typeof size === 'number' ? size : iconSize[size];
  const node = (iconNodes as Partial<Record<string, (typeof iconNodes)[IconName]>>)[name];
  const strokeWidth = Math.round(((STROKE_PX * GRID) / Math.max(px, 1)) * 1000) / 1000;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...rest}
      className={cx('itsm-Icon', className)}
      data-icon={name}
      data-size={typeof size === 'number' ? undefined : size}
      data-directional={directional ? '' : undefined}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {node?.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
    </svg>
  );
}
