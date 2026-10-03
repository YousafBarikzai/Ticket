import type { ReactNode } from 'react';
import type { ChartSlot, ChartTone } from './types.js';

/**
 * Hatch textures: the backup channel for identity and state where colour
 * fails — "Increase contrast" (SPEC §1.11: texture on by default in the
 * high-contrast themes), forced colours, greyscale print. Server-safe.
 *
 * One directional hatch, at 45° and its 135° mirror, spaced two ways, plus a
 * cross and a dot field: eight distinct fills that stay equally loud. Slot 1
 * stays solid, so the first series reads as the plain one. Horizontal and
 * vertical lines are never used; they would read as gridlines.
 *
 * State tones (A8 §6.3) get the same vocabulary, so a P1 segment and a
 * "breached" bullet are told apart from their neighbours without hue:
 * `danger`, the loudest state, takes the dense cross; `success` stays solid,
 * as slot 1 does — the good news is the plain one.
 *
 * The texture is an overlay: each textured mark is drawn twice, the coloured
 * shape and on top of it the same shape filled with the pattern, and CSS shows
 * the overlay only when it is wanted. A presentation-attribute `url(#id)` is
 * the one pattern reference every engine resolves the same way.
 */

interface Texture {
  readonly angle: 45 | 135;
  /** Repeat, in the drawing's user units. */
  readonly size: number;
  readonly kind: 'line' | 'cross' | 'dots';
}

const TEXTURES: Readonly<Partial<Record<ChartSlot, Texture>>> = {
  2: { angle: 45, size: 4, kind: 'line' },
  3: { angle: 135, size: 4, kind: 'line' },
  4: { angle: 45, size: 4.5, kind: 'cross' },
  5: { angle: 45, size: 4, kind: 'dots' },
  6: { angle: 45, size: 7, kind: 'line' },
  7: { angle: 135, size: 7, kind: 'line' },
  8: { angle: 45, size: 8, kind: 'cross' },
};

/** The tones' textures: the slot vocabulary again, matched to `toneTextureImages` in `texture-css.ts`. */
const TONE_TEXTURES: Readonly<Partial<Record<ChartTone, Texture>>> = {
  danger: TEXTURES[4],
  high: TEXTURES[2],
  warning: TEXTURES[3],
  info: TEXTURES[5],
  hold: TEXTURES[6],
  neutral: TEXTURES[7],
  neutralSoft: TEXTURES[8],
};

/** The slots that carry a hatch (all but slot 1). */
export const TEXTURE_SLOTS: readonly ChartSlot[] = [2, 3, 4, 5, 6, 7, 8];

/** The tones that carry a hatch (all but `success`). */
export const TEXTURE_TONES: readonly ChartTone[] = ['danger', 'high', 'warning', 'info', 'hold', 'neutral', 'neutralSoft'];

/** The pattern id of a slot's or a tone's texture in one chart. */
export function textureId(chart: string, key: ChartSlot | ChartTone): string {
  return `${chart}-t${key}`;
}

/** The `<defs>` for the textures a chart uses, by slot and by tone. Render it inside the chart's SVG. */
export function TexturePatterns({ id, slots = [], tones = [] }: { readonly id: string; readonly slots?: readonly ChartSlot[]; readonly tones?: readonly ChartTone[] }): ReactNode {
  const used = [
    ...slots.flatMap((slot) => (TEXTURES[slot] ? [{ key: slot, texture: TEXTURES[slot] }] : [])),
    ...tones.flatMap((tone) => (TONE_TEXTURES[tone] ? [{ key: tone, texture: TONE_TEXTURES[tone] }] : [])),
  ];
  if (used.length === 0) return null;
  return (
    <defs>
      {used.map(({ key, texture }) => {
        const { size } = texture;
        return (
          <pattern
            key={key}
            id={textureId(id, key)}
            patternUnits="userSpaceOnUse"
            width={size}
            height={size}
            patternTransform={`rotate(${texture.angle})`}
          >
            {texture.kind === 'dots' ? (
              <circle className="itsm-ChartTexture__dot" cx={size / 2} cy={size / 2} r={size / 5} />
            ) : (
              <path
                className="itsm-ChartTexture__ink"
                d={texture.kind === 'cross' ? `M${size / 2} 0V${size}M0 ${size / 2}H${size}` : `M${size / 2} 0V${size}`}
              />
            )}
          </pattern>
        );
      })}
    </defs>
  );
}
