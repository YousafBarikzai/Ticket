/**
 * The hatch textures of `texture.tsx`, as CSS backgrounds, for the marks and
 * keys drawn as boxes (bars, stacked parts, legend swatches). Slot for slot
 * the same fills as the SVG patterns, so a legend key always matches its
 * mark. Server-safe; imported by style modules.
 */

/** A 45° or 135° hatch in `ink`, `gap` px of fill between 1.5 px lines. */
const hatch = (angle: 45 | 135, gap: number, ink: string): string =>
  `repeating-linear-gradient(${angle}deg, transparent 0 ${gap}px, ${ink} ${gap}px ${gap + 1.5}px)`;

/** The background image of each textured slot (slot 1 stays solid), drawn in `ink`. */
export function textureImages(ink: string): Readonly<Record<number, string>> {
  return {
    2: hatch(45, 3, ink),
    3: hatch(135, 3, ink),
    4: `${hatch(45, 3.5, ink)}, ${hatch(135, 3.5, ink)}`,
    5: `radial-gradient(circle, ${ink} 1px, transparent 1.5px) 0 0 / 5px 5px`,
    6: hatch(45, 6, ink),
    7: hatch(135, 6, ink),
    8: `${hatch(45, 6, ink)}, ${hatch(135, 6, ink)}`,
  };
}

/**
 * Rules giving `selector[data-slot="n"]` its texture over `fill` (the series
 * colour by default), each prefixed by `scope`.
 */
export function textureRules(scope: string, selector: string, ink: string, fill = 'var(--_itsm-series)'): string {
  return Object.entries(textureImages(ink))
    .map(([slot, image]) => `${scope} ${selector}[data-slot="${slot}"] { background: ${image}, ${fill}; }`)
    .join('\n');
}
