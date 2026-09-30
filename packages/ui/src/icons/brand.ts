/**
 * The product mark's parts, shared by `<BrandMark>` and the standalone SVG an
 * application serves as its favicon and install icon.
 *
 * Server-safe and pure.
 */
import type { AppName } from '../theme/prefs.js';
import { iconNodes } from './nodes.js';
import type { IconName } from './registry.js';

/** Which glyph each mark carries: the product's layers, or the application's own sign. */
export const brandGlyphs = {
  product: 'layers-2',
  admin: 'settings-2',
  workbench: 'inbox',
  portal: 'life-buoy',
} as const satisfies Record<AppName | 'product', IconName>;

/**
 * The one gradient in the product (SPEC §1.2): light system blue into system
 * blue, at 145°. Literal colours on purpose: a favicon is drawn by the browser
 * chrome, outside every theme, and has no tokens to read.
 */
export const brandGradient = { from: '#57A8FF', to: '#007AFF', angle: 145 } as const;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** An SVG attribute name from lucide's node data (already the SVG spelling). */
function attributesOf(attributes: Readonly<Record<string, string | number | undefined>>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join('');
}

export interface BrandMarkSvgOptions {
  readonly app?: AppName;
  /** Pixel size written on the root element; the drawing itself is resolution-independent. */
  readonly size?: number;
  /** Accessible name; the SVG is decorative without one. */
  readonly title?: string;
}

/**
 * The mark as a self-contained SVG document — for an application's
 * `icon.svg` route, the web-app manifest and anywhere else the browser draws
 * it outside the page. A rounded square in the brand gradient with the
 * application's glyph in white.
 *
 * The gradient's end points are the 145° CSS angle projected on the unit
 * square, so this file and `<BrandMark>` (which draws with CSS) look the same.
 */
export function brandMarkSvg({ app, size = 32, title }: BrandMarkSvgOptions = {}): string {
  const glyph = iconNodes[brandGlyphs[app ?? 'product']];
  const radians = (brandGradient.angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  const point = (value: number): string => String(Math.round(value * 1000) / 1000);
  const id = `itsm-brand-${app ?? 'product'}`;
  const drawing = glyph.map(([tag, attributes]) => `<${tag}${attributesOf(attributes)}/>`).join('');
  const label = title ? ` role="img" aria-label="${escapeAttribute(title)}"` : ' aria-hidden="true"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"${label}>` +
    (title ? `<title>${escapeAttribute(title)}</title>` : '') +
    `<defs><linearGradient id="${id}" x1="${point(0.5 - dx)}" y1="${point(0.5 - dy)}" x2="${point(0.5 + dx)}" y2="${point(0.5 + dy)}">` +
    `<stop offset="0" stop-color="${brandGradient.from}"/><stop offset="1" stop-color="${brandGradient.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="32" height="32" rx="7.2" fill="url(#${id})"/>` +
    `<g transform="translate(6.4 6.4) scale(0.8)" fill="none" stroke="#FFFFFF" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>` +
    `</svg>`
  );
}
