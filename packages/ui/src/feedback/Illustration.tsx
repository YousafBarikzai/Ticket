import { createElement, type ReactNode, type SVGAttributes } from 'react';
import type { Illustration } from '../types.js';
import { cx } from '../web/cx.js';

/**
 * The line illustrations of the large empty and status screens (SPEC §4.5):
 * a first-run list, a search with no results, an error, a success, a locked
 * door, a lost connection, an empty chart, a catalogue and a setup step.
 *
 * Drawn here as data rather than shipped as files: every stroke and fill is a
 * class, and the classes read tokens, so one drawing is right in all four
 * themes and follows the system palette in forced colours. There are no ids
 * in them — no gradients, masks or clip paths — so the same drawing can be on
 * a page twice without one copy borrowing the other's definitions, and a
 * server-safe component (no `useId`) can draw them. Each is well under 1 kB.
 *
 * The drawing is always decoration (`aria-hidden`): the heading beside it says
 * what the screen means, and a description of a padlock adds nothing to
 * "You don't have access".
 */

/** How each part is painted; the class names are `itsm-Illustration__<part>`. */
type Part =
  /** The soft disc everything sits on. */
  | 'plate'
  /** A raised object: surface fill, grey outline. */
  | 'surface'
  /** An outline with no fill. */
  | 'line'
  /** Faint detail: text lines on a page, the dots of a window. */
  | 'detail'
  /** Dashed outline: what is not there yet. */
  | 'dashed'
  /** The one coloured stroke that says what the picture is about. */
  | 'accent'
  /** The same colour as a fill. */
  | 'accentFill'
  /** The tone's tint, behind an accent stroke. */
  | 'accentSoft'
  /** The surface colour as a stroke: cuts a gap where one line crosses another. */
  | 'gap'
  /** The surface colour as a stroke on top of an accent fill (a tick inside a badge). */
  | 'inverse';

type Shape = readonly [tag: 'path' | 'circle' | 'rect' | 'line' | 'ellipse', part: Part, attributes: Record<string, string | number>];

const plate: Shape = ['circle', 'plate', { cx: 80, cy: 60, r: 52 }];

/** Which colour an illustration's accent takes by default. */
const defaultTone: Readonly<Record<Illustration, IllustrationTone>> = {
  inbox: 'accent',
  search: 'accent',
  error: 'danger',
  success: 'success',
  forbidden: 'neutral',
  offline: 'neutral',
  'empty-chart': 'accent',
  catalogue: 'accent',
  setup: 'accent',
};

const drawings: Readonly<Record<Illustration, readonly Shape[]>> = {
  // A tray with a card lifted out of it and a tick: "nothing waiting".
  inbox: [
    plate,
    ['rect', 'surface', { x: 56, y: 22, width: 48, height: 34, rx: 6 }],
    ['path', 'detail', { d: 'M65 33h30M65 42h20' }],
    ['path', 'surface', { d: 'M38 70l12-24h60l12 24v18a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6z' }],
    ['path', 'line', { d: 'M38 70h24l6 8h24l6-8h24' }],
    ['circle', 'accentFill', { cx: 110, cy: 26, r: 10 }],
    ['path', 'inverse', { d: 'M105.5 26l3 3 5.5-6' }],
  ],
  // A page of results and a magnifier over it.
  search: [
    plate,
    ['rect', 'surface', { x: 40, y: 20, width: 58, height: 76, rx: 7 }],
    ['path', 'detail', { d: 'M51 36h34M51 46h26M51 56h30M51 66h18' }],
    ['circle', 'surface', { cx: 100, cy: 70, r: 17 }],
    ['circle', 'accent', { cx: 100, cy: 70, r: 17 }],
    ['path', 'accent', { d: 'M112.5 82.5l13 13' }],
  ],
  // A window with a warning in it.
  error: [
    plate,
    ['rect', 'surface', { x: 34, y: 26, width: 92, height: 68, rx: 9 }],
    ['path', 'line', { d: 'M34 42h92' }],
    ['path', 'detail', { d: 'M44 34h.01M51 34h.01M58 34h.01' }],
    ['path', 'accentSoft', { d: 'M80 52l17 28H63z' }],
    ['path', 'accent', { d: 'M80 52l17 28H63zM80 62v8M80 75h.01' }],
  ],
  // A tick in a circle and a little celebration round it.
  success: [
    plate,
    ['circle', 'accentSoft', { cx: 80, cy: 60, r: 28 }],
    ['circle', 'accent', { cx: 80, cy: 60, r: 28 }],
    ['path', 'accent', { d: 'M67 60l9 9 18-19' }],
    ['path', 'detail', { d: 'M38 34v8M34 38h8M122 80v8M118 84h8' }],
    ['circle', 'accentFill', { cx: 120, cy: 36, r: 3 }],
    ['circle', 'accentFill', { cx: 44, cy: 86, r: 2.5 }],
  ],
  // A padlock.
  forbidden: [
    plate,
    ['path', 'line', { d: 'M64 56V44a16 16 0 0 1 32 0v12' }],
    ['rect', 'surface', { x: 52, y: 54, width: 56, height: 42, rx: 9 }],
    ['circle', 'accentFill', { cx: 80, cy: 71, r: 5 }],
    ['path', 'accent', { d: 'M80 75v9' }],
  ],
  // A cloud, crossed out.
  offline: [
    plate,
    ['path', 'surface', { d: 'M54 86h54a18 18 0 0 0 1-36 26 26 0 0 0-49-3 20 20 0 0 0-6 39z' }],
    ['path', 'gap', { d: 'M46 30l68 64' }],
    ['path', 'accent', { d: 'M46 30l68 64' }],
  ],
  // Axes, with bars that are not there yet.
  'empty-chart': [
    plate,
    ['path', 'line', { d: 'M38 24v66h86' }],
    ['rect', 'dashed', { x: 50, y: 62, width: 12, height: 28, rx: 3 }],
    ['rect', 'dashed', { x: 70, y: 44, width: 12, height: 46, rx: 3 }],
    ['rect', 'dashed', { x: 90, y: 70, width: 12, height: 20, rx: 3 }],
    ['rect', 'dashed', { x: 110, y: 54, width: 12, height: 36, rx: 3 }],
    ['path', 'accent', { d: 'M50 50l20-14 20 18 22-12' }],
  ],
  // Four tiles, one chosen.
  catalogue: [
    plate,
    ['rect', 'surface', { x: 44, y: 24, width: 32, height: 32, rx: 9 }],
    ['rect', 'accentSoft', { x: 84, y: 24, width: 32, height: 32, rx: 9 }],
    ['rect', 'accent', { x: 84, y: 24, width: 32, height: 32, rx: 9 }],
    ['rect', 'surface', { x: 44, y: 64, width: 32, height: 32, rx: 9 }],
    ['rect', 'surface', { x: 84, y: 64, width: 32, height: 32, rx: 9 }],
    ['path', 'detail', { d: 'M53 40h14M53 80h14M93 80h14' }],
    ['path', 'accent', { d: 'M93 40h14' }],
  ],
  // Three sliders being set.
  setup: [
    plate,
    ['path', 'line', { d: 'M40 40h80M40 60h80M40 80h80' }],
    ['circle', 'surface', { cx: 62, cy: 40, r: 7 }],
    ['circle', 'accentFill', { cx: 100, cy: 60, r: 8 }],
    ['circle', 'inverse', { cx: 100, cy: 60, r: 3 }],
    ['circle', 'surface', { cx: 74, cy: 80, r: 7 }],
  ],
};

export type IllustrationTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger';

export interface StateIllustrationProps extends Omit<SVGAttributes<SVGSVGElement>, 'name' | 'children' | 'width' | 'height'> {
  readonly name: Illustration;
  /** The colour of the one accented detail; each drawing has a sensible default (red for `error`). */
  readonly tone?: IllustrationTone;
  /** `sm` 96 px, `md` 128 px, `lg` 160 px wide; the height follows (4:3). */
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

/** The illustration names, for tests and for validating a name that arrived as data. */
export const illustrationNames = Object.keys(drawings) as readonly Illustration[];

/**
 * One line illustration. Server-safe, decorative, and sized in `rem` through
 * the stylesheet (the `width`/`height` attributes are the fallback where no
 * stylesheet has loaded). An unknown name — possible only when it came in as
 * data — draws the empty plate rather than throwing.
 */
export function StateIllustration({ name, tone, size = 'lg', className, ...rest }: StateIllustrationProps): ReactNode {
  const shapes = drawings[name] ?? [plate];
  const px = size === 'sm' ? 96 : size === 'md' ? 128 : 160;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 160 120"
      width={px}
      height={(px * 3) / 4}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...rest}
      aria-hidden="true"
      className={cx('itsm-Illustration', className)}
      data-illustration={name}
      data-tone={tone ?? defaultTone[name] ?? 'accent'}
      data-size={size}
    >
      {shapes.map(([tag, part, attributes], index) =>
        createElement(tag, { key: index, className: `itsm-Illustration__${part}`, ...attributes }),
      )}
    </svg>
  );
}
