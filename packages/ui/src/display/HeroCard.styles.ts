import { css, layer, mq, prefers } from '../styles/css.js';
import { moreContrast } from './tone.js';

/** The hero's tones, which are also intent names: each has a navy mark (`hero.<tone>`) and a light-page set. */
const heroTones = ['success', 'warning', 'danger', 'info', 'hold', 'neutral'] as const;

/** The tones a nested `StatusPill` may carry, and the navy mark each takes when the pill turns to an outline. */
const pillMarks: Readonly<Record<string, string>> = {
  neutral: 'neutral',
  accent: 'accent',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  hold: 'hold',
  high: 'high',
};

/**
 * Component-local colours per tone, on any element of the hero that carries
 * `data-tone`: `--_itsm-hero-mark` (an icon or a dot), and for the light
 * variant's chips the intent's tint and text. Navy marks are `hero.<tone>`;
 * status *text* on navy is always `hero.text` (A1 §3.7), so only marks change.
 */
function toneMarks(): string {
  const navy = heroTones.map((tone) => `.itsm-HeroCard [data-tone="${tone}"] { --_itsm-hero-mark: var(--itsm-colour-hero-${tone}); }`);
  const light = heroTones.map(
    (tone) => `.itsm-HeroCard[data-variant="light"] [data-tone="${tone}"] {
  --_itsm-hero-mark: var(--itsm-colour-${tone}-border);
  --_itsm-hero-tint: var(--itsm-colour-${tone}-subtle);
  --_itsm-hero-ink: var(--itsm-colour-${tone}-subtleText);
}`,
  );
  const why = heroTones.map((tone) => `.itsm-HeroWhy__item[data-tone="${tone}"] { --_itsm-why-mark: var(--itsm-colour-${tone}-border); }`);
  return [...navy, ...light, ...why].join('\n');
}

/** The outlined look a `StatusPill` takes on navy: no tint, a hairline in `hero.lineStrong`, the icon in the tone's navy mark. */
function heroPills(): string {
  return Object.entries(pillMarks)
    .map(([tone, mark]) => `[data-surface="hero"] .itsm-StatusPill[data-tone="${tone}"] { --_itsm-hero-pill-mark: var(--itsm-colour-hero-${mark}); }`)
    .join('\n');
}

/**
 * `HeroCard` and `HeroWhy` (v3 §2.5, §2.13; A1 §7.3), and the re-theming of
 * the controls a navy surface may hold.
 *
 * **Surfaces.** Navy is `--itsm-hero-card-background` (a corner glow over a
 * navy gradient) with a `hero.line` hairline, radius 16 and the long, soft
 * `elevation.hero`; light is `--itsm-hero-light-background` with an accent
 * edge at 28 % and no shadow. Both run on the same component-local names —
 * `--_itsm-hero-text`, `-muted`, `-line`, the bullet's track and fill — so the
 * anatomy below is written once and the light variant only re-points them at
 * the page's own text tokens.
 *
 * **Columns** fold with the card's own width (`itsm-hero` container): main ·
 * dimensions · aside at 5 : 4 : 3 from 60 rem, two columns with the aside as a
 * strip under them from 45 rem, one column below that with hairlines between
 * the parts instead of beside them; under 35 rem the padding drops to 20, the
 * verdict to 26/30, and the dimensions become a two-up grid of small cards.
 *
 * **Kickers** are the only uppercase here (D6, `uppercase-guard.test.ts`).
 * The verdict and the aside's figure are Jakarta (`verdict`, word-spaced);
 * the figure is tabular so a countdown does not jitter.
 *
 * **Nested controls.** `[data-surface="hero"]` already turns focus rings to
 * the hero accent (`base.styles.ts`); this module adds what A1 §7.3 gives the
 * controls that sit on navy — the segmented control's track and thumb, the
 * ghost and secondary buttons, the status pill's outline. `Count`, the InfoTip
 * trigger and `IconTile` carry their own hero rules.
 *
 * In the high-contrast themes the hero tokens are already flat navy with
 * white lines (no glow); forced colours drop the gradients for the system's
 * own and the parts keep their borders. Printing keeps the navy
 * (`print-color-adjust: exact`) and drops the "Why?" pill, which cannot open
 * on paper.
 */
export const heroCardStyles = layer(
  'components',
  css`
.itsm-HeroCard {
  --_itsm-hero-pad: var(--itsm-space-lg);
  --_itsm-hero-gap: var(--itsm-space-lg);
  --_itsm-hero-line: var(--itsm-colour-hero-line);
  --_itsm-hero-text: var(--itsm-colour-hero-text);
  --_itsm-hero-text2: var(--itsm-colour-hero-textSecondary);
  --_itsm-hero-muted: var(--itsm-colour-hero-textMuted);
  --_itsm-hero-kicker: var(--itsm-colour-hero-textMuted);
  --_itsm-hero-edge: var(--itsm-colour-hero-lineStrong);
  --_itsm-hero-hover: var(--itsm-colour-hero-fill);
  --_itsm-hero-track: var(--itsm-colour-hero-fill);
  --_itsm-hero-fill: color-mix(in srgb, var(--itsm-colour-hero-text) 72%, transparent);
  --_itsm-hero-short: color-mix(in srgb, var(--itsm-colour-hero-warning) 60%, transparent);
  --_itsm-hero-tick: var(--itsm-colour-hero-text);
  --_itsm-hero-mark: var(--itsm-colour-hero-neutral);
  position: relative;
  container: itsm-hero / inline-size;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 10.5rem;
  margin: 0;
  border: var(--itsm-border-hair) solid var(--itsm-colour-hero-line);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-hero-card-background);
  box-shadow: var(--itsm-elevation-hero);
  color: var(--_itsm-hero-text);
  print-color-adjust: exact;
}

.itsm-HeroCard[data-variant="light"] {
  --_itsm-hero-line: var(--itsm-colour-border-subtle);
  --_itsm-hero-text: var(--itsm-colour-text-primary);
  --_itsm-hero-text2: var(--itsm-colour-text-secondary);
  --_itsm-hero-muted: var(--itsm-colour-text-muted);
  --_itsm-hero-kicker: var(--itsm-colour-brand-subtleText);
  --_itsm-hero-edge: var(--itsm-colour-border-soft);
  --_itsm-hero-hover: var(--itsm-colour-surface-hover);
  --_itsm-hero-track: var(--itsm-colour-fill-track);
  --_itsm-hero-fill: var(--itsm-colour-accent);
  --_itsm-hero-short: var(--itsm-colour-warning-subtle);
  --_itsm-hero-tick: var(--itsm-colour-text-primary);
  --_itsm-hero-mark: var(--itsm-colour-neutral-border);
  border-color: color-mix(in srgb, var(--itsm-colour-accent) 28%, transparent);
  background: var(--itsm-hero-light-background);
  box-shadow: none;
}

${toneMarks()}

/* ------------------------------------------------------------- Columns */

.itsm-HeroCard__grid {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  column-gap: var(--_itsm-hero-gap);
  padding: var(--_itsm-hero-pad);
}

.itsm-HeroCard__main,
.itsm-HeroCard__dimensionsColumn,
.itsm-HeroCard__aside {
  min-inline-size: 0;
}

.itsm-HeroCard__grid > * + * {
  margin-block-start: var(--itsm-space-ml);
  padding-block-start: var(--itsm-space-ml);
  border-block-start: var(--itsm-border-hair) solid var(--_itsm-hero-line);
}

@container itsm-hero (min-width: 45rem) {
  .itsm-HeroCard[data-layout="dimensions"] .itsm-HeroCard__grid {
    grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
  }

  .itsm-HeroCard[data-layout="aside"] .itsm-HeroCard__grid {
    grid-template-columns: minmax(0, 5fr) minmax(0, 3fr);
  }

  .itsm-HeroCard[data-layout="full"] .itsm-HeroCard__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .itsm-HeroCard__grid > * + * {
    margin-block-start: 0;
    padding-block-start: 0;
    border-block-start: 0;
    padding-inline-start: var(--_itsm-hero-gap);
    border-inline-start: var(--itsm-border-hair) solid var(--_itsm-hero-line);
  }

  .itsm-HeroCard[data-layout="full"] .itsm-HeroCard__aside {
    grid-column: 1 / -1;
    margin-block-start: var(--itsm-space-ml);
    padding-block-start: var(--itsm-space-ml);
    padding-inline-start: 0;
    border-block-start: var(--itsm-border-hair) solid var(--_itsm-hero-line);
    border-inline-start: 0;
  }
}

@container itsm-hero (min-width: 60rem) {
  .itsm-HeroCard[data-layout="full"] .itsm-HeroCard__grid {
    grid-template-columns: minmax(0, 5fr) minmax(0, 4fr) minmax(0, 3fr);
  }

  .itsm-HeroCard[data-layout="full"] .itsm-HeroCard__aside {
    grid-column: auto;
    margin-block-start: 0;
    padding-block-start: 0;
    padding-inline-start: var(--_itsm-hero-gap);
    border-block-start: 0;
    border-inline-start: var(--itsm-border-hair) solid var(--_itsm-hero-line);
  }
}

/* ------------------------------------------------------------- Main column */

.itsm-HeroCard__main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
}

.itsm-HeroCard__kicker {
  margin: 0;
  color: var(--_itsm-hero-kicker);
  font-size: var(--itsm-text-kicker-size);
  line-height: var(--itsm-text-kicker-line);
  font-weight: var(--itsm-text-kicker-weight);
  letter-spacing: var(--itsm-text-kicker-tracking);
  text-transform: uppercase;
}

.itsm-HeroCard__verdictRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-HeroCard__verdict {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
  margin: 0;
  color: var(--_itsm-hero-text);
  font-family: var(--itsm-text-verdict-family);
  font-size: var(--itsm-text-verdict-size);
  line-height: var(--itsm-text-verdict-line);
  font-weight: var(--itsm-text-verdict-weight);
  letter-spacing: var(--itsm-text-verdict-tracking);
  word-spacing: var(--itsm-text-verdict-word-spacing);
  text-wrap: balance;
}

.itsm-HeroCard__verdictIcon {
  flex: none;
  color: var(--_itsm-hero-mark);
}

.itsm-HeroCard__why {
  display: inline-flex;
}

.itsm-HeroCard__trend {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  margin: 0;
  color: var(--_itsm-hero-text2);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-regular);
}

.itsm-HeroCard__trendIcon {
  flex: none;
}

.itsm-HeroCard__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
  margin: var(--itsm-space-2xs) 0 0;
  padding: 0;
  list-style: none;
}

.itsm-HeroCard__chipItem {
  display: flex;
}

.itsm-HeroCard__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: 1.375rem;
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)) var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--_itsm-hero-edge);
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--_itsm-hero-text);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
}

.itsm-HeroCard__chipIcon {
  flex: none;
  color: var(--_itsm-hero-mark);
}

a.itsm-HeroCard__chip:hover {
  background: var(--_itsm-hero-hover);
}

.itsm-HeroCard[data-variant="light"] .itsm-HeroCard__chip {
  border-color: transparent;
  background: var(--_itsm-hero-tint);
  color: var(--_itsm-hero-ink);
}

.itsm-HeroCard[data-variant="light"] .itsm-HeroCard__chipIcon {
  color: inherit;
}

.itsm-HeroCard[data-variant="light"] a.itsm-HeroCard__chip:hover {
  border-color: var(--_itsm-hero-mark);
}

.itsm-HeroCard__narrative {
  display: -webkit-box;
  margin: var(--itsm-space-2xs) 0 0;
  overflow: hidden;
  color: var(--_itsm-hero-text2);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  text-wrap: pretty;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* ------------------------------------------------------------- Dimensions */

.itsm-HeroCard__dimensions {
  display: grid;
  gap: var(--itsm-space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-HeroCard__dimensionItem {
  display: flex;
  min-inline-size: 0;
}

.itsm-HeroCard__dimension {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(6rem, auto) auto minmax(0, 1fr);
  align-items: center;
  column-gap: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 1.75rem;
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding: var(--itsm-space-3xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: inherit;
  text-decoration: none;
}

a.itsm-HeroCard__dimension:hover {
  background: var(--_itsm-hero-hover);
}

.itsm-HeroCard__dimensionLabel {
  min-inline-size: 0;
  color: var(--_itsm-hero-text);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  overflow-wrap: break-word;
}

.itsm-HeroCard__dimensionState {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: 1.375rem;
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)) var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--_itsm-hero-edge);
  border-radius: var(--itsm-radius-pill);
  color: var(--_itsm-hero-text);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
}

.itsm-HeroCard__dimensionIcon {
  flex: none;
  color: var(--_itsm-hero-mark);
}

.itsm-HeroCard[data-variant="light"] .itsm-HeroCard__dimensionState {
  border-color: transparent;
  background: var(--_itsm-hero-tint);
  color: var(--_itsm-hero-ink);
}

.itsm-HeroCard[data-variant="light"] .itsm-HeroCard__dimensionIcon {
  color: inherit;
}

.itsm-HeroCard__dimensionReason {
  display: -webkit-box;
  min-inline-size: 0;
  overflow: hidden;
  color: var(--_itsm-hero-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* ------------------------------------------------------------- Aside */

.itsm-HeroCard__aside {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-HeroCard__asideKicker {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin: 0;
  color: var(--_itsm-hero-kicker);
  font-size: var(--itsm-text-kicker-size);
  line-height: var(--itsm-text-kicker-line);
  font-weight: var(--itsm-text-kicker-weight);
  letter-spacing: var(--itsm-text-kicker-tracking);
  text-transform: uppercase;
}

.itsm-HeroCard__asideDot {
  flex: none;
  inline-size: 0.4375rem;
  block-size: 0.4375rem;
  border-radius: 50%;
  background: var(--_itsm-hero-mark);
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--_itsm-hero-mark) 24%, transparent);
}

.itsm-HeroCard__asideValue {
  margin: 0;
}

.itsm-HeroCard__asideLink {
  color: inherit;
  text-decoration: none;
  border-radius: var(--itsm-radius-sm);
}

.itsm-HeroCard__asideLink:hover .itsm-HeroCard__asideFigure {
  text-decoration: underline;
  text-decoration-thickness: var(--itsm-border-thick);
  text-underline-offset: 0.2em;
}

.itsm-HeroCard__asideFigure {
  color: var(--_itsm-hero-text);
  font-family: var(--itsm-text-verdict-family);
  font-size: var(--itsm-text-verdict-size);
  line-height: var(--itsm-text-verdict-line);
  font-weight: var(--itsm-text-verdict-weight);
  letter-spacing: var(--itsm-text-verdict-tracking);
  word-spacing: var(--itsm-text-verdict-word-spacing);
  font-variant-numeric: tabular-nums;
}

.itsm-HeroCard__asideValueLabel {
  margin-inline-start: var(--itsm-space-xs);
  color: var(--_itsm-hero-text);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-HeroCard__asideCaption,
.itsm-HeroCard__bulletCaption {
  margin: 0;
  color: var(--_itsm-hero-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-HeroCard__progress {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
}

.itsm-HeroCard__bullet {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
}

.itsm-HeroCard__bulletTrack {
  position: relative;
  flex: 1 1 auto;
  block-size: 0.625rem;
  border-radius: var(--itsm-radius-xs);
  background: var(--_itsm-hero-track);
  overflow: hidden;
}

.itsm-HeroCard__bulletFill,
.itsm-HeroCard__bulletShort {
  position: absolute;
  inset-block: 0;
}

.itsm-HeroCard__bulletFill {
  inset-inline-start: 0;
  background: var(--_itsm-hero-fill);
}

.itsm-HeroCard__bulletShort {
  background: var(--_itsm-hero-short);
}

.itsm-HeroCard__bulletTarget {
  position: absolute;
  inset-block: 0;
  inline-size: var(--itsm-border-thick);
  margin-inline-start: calc(-1 * var(--itsm-border-hair));
  background: var(--_itsm-hero-tick);
}

.itsm-HeroCard__bulletValue {
  flex: none;
  color: var(--_itsm-hero-text);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

/* Narrow cards: tighter padding, a smaller verdict, the dimensions two-up as small cards. */
@container itsm-hero (width < 35rem) {
  .itsm-HeroCard__grid {
    --_itsm-hero-pad: var(--itsm-space-ml);
  }

  .itsm-HeroCard__verdict {
    font-size: 1.625rem;
    line-height: 1.875rem;
  }

  .itsm-HeroCard__dimensions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--itsm-space-xs);
  }

  .itsm-HeroCard__dimension {
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    row-gap: var(--itsm-space-2xs);
    min-block-size: 2.75rem;
    margin-inline: 0;
    padding: var(--itsm-space-xs) var(--itsm-space-sm);
    background: var(--_itsm-hero-hover);
  }
}

/* ------------------------------------------------------------- Why? */

.itsm-HeroWhy {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  min-block-size: 1.5rem;
  margin: 0;
  padding-inline: var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-HeroWhy:hover,
.itsm-HeroWhy[aria-expanded="true"] {
  background: var(--itsm-colour-surface-hover);
}

[data-surface="hero"] .itsm-HeroWhy {
  border-color: var(--itsm-colour-hero-lineStrong);
  color: var(--itsm-colour-hero-text);
}

[data-surface="hero"] .itsm-HeroWhy:hover,
[data-surface="hero"] .itsm-HeroWhy[aria-expanded="true"] {
  background: var(--itsm-colour-hero-fill);
}

${mq.coarse} {
  .itsm-HeroWhy {
    position: relative;
  }

  .itsm-HeroWhy::after {
    content: "";
    position: absolute;
    inset: calc(-1 * var(--itsm-space-sm)) calc(-1 * var(--itsm-space-2xs));
  }
}

.itsm-HeroWhy__list {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-HeroWhy__item {
  --_itsm-why-mark: var(--itsm-colour-neutral-border);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--itsm-space-xs);
}

.itsm-HeroWhy__icon {
  margin-block-start: 0.1875rem;
  color: var(--_itsm-why-mark);
}

.itsm-HeroWhy__text {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-HeroWhy__label,
.itsm-HeroWhy__link {
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  overflow-wrap: break-word;
}

.itsm-HeroWhy__link {
  color: var(--itsm-colour-text-link);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.itsm-HeroWhy__detail {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

/* ------------------------------------------------------------- Controls on navy */

[data-surface="hero"] .itsm-SegmentedControl {
  background-color: var(--itsm-colour-hero-fill);
}

[data-surface="hero"] .itsm-SegmentedControl__segment,
[data-surface="hero"] .itsm-SegmentedControl__segment[data-selected],
[data-surface="hero"] .itsm-SegmentedControl__count {
  color: var(--itsm-colour-hero-text);
}

[data-surface="hero"] .itsm-SegmentedControl__segment:hover:not([data-selected]):not([aria-disabled="true"]) {
  background-color: var(--itsm-colour-hero-fill);
  color: var(--itsm-colour-hero-text);
}

[data-surface="hero"] .itsm-SegmentedControl__thumb,
[data-surface="hero"] .itsm-SegmentedControl:not([data-ready]) .itsm-SegmentedControl__segment[data-selected] {
  background-color: var(--itsm-colour-hero-fillStrong);
  background-image: none;
  box-shadow: none;
}

[data-surface="hero"] :is(.itsm-Button--ghost, .itsm-Button--secondary) {
  border-color: var(--itsm-colour-hero-lineStrong);
  background-color: transparent;
  background-image: none;
  color: var(--itsm-colour-hero-text);
}

[data-surface="hero"] :is(.itsm-Button--ghost, .itsm-Button--secondary):not(:focus-visible) {
  box-shadow: none;
}

[data-surface="hero"] :is(.itsm-Button--ghost, .itsm-Button--secondary):is(:hover, :active) {
  background-color: var(--itsm-colour-hero-fill);
  background-image: none;
}

${heroPills()}

[data-surface="hero"] .itsm-StatusPill:not([data-emphasis="solid"]) {
  background: transparent;
  color: var(--itsm-colour-hero-text);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-hero-lineStrong);
}

[data-surface="hero"] .itsm-StatusPill:not([data-emphasis="solid"]) .itsm-StatusPill__icon {
  color: var(--_itsm-hero-pill-mark, var(--itsm-colour-hero-text));
}

/* ------------------------------------------------------------- Contrast, colours, motion, print */

${moreContrast(
  (scope) => `${scope} .itsm-HeroCard[data-variant="light"] { border-color: var(--itsm-colour-border-strong); }
${scope} .itsm-HeroWhy { border-color: var(--itsm-colour-border-strong); }
${scope} [data-surface="hero"] .itsm-HeroWhy { border-color: var(--itsm-colour-hero-lineStrong); }`,
)}

${mq.forcedColors} {
  .itsm-HeroCard {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }

  .itsm-HeroCard__kicker,
  .itsm-HeroCard__asideKicker,
  .itsm-HeroCard__trend,
  .itsm-HeroCard__narrative,
  .itsm-HeroCard__dimensionLabel,
  .itsm-HeroCard__dimensionReason,
  .itsm-HeroCard__asideCaption,
  .itsm-HeroCard__bulletCaption {
    color: CanvasText;
  }

  .itsm-HeroCard__chip,
  .itsm-HeroCard__dimensionState,
  .itsm-HeroWhy {
    border-color: CanvasText;
  }

  .itsm-HeroCard__bulletTrack {
    border: var(--itsm-border-hair) solid CanvasText;
  }

  .itsm-HeroCard__bulletFill,
  .itsm-HeroCard__bulletTarget,
  .itsm-HeroCard__asideDot {
    forced-color-adjust: none;
    background: CanvasText;
  }

  .itsm-HeroCard__bulletShort {
    forced-color-adjust: none;
    background: GrayText;
  }
}

${mq.reducedMotion} {
  .itsm-HeroWhy {
    transition: none;
  }
}

${prefers.reducedMotion} .itsm-HeroWhy {
  transition: none;
}

@media print {
  .itsm-HeroCard {
    box-shadow: none;
    break-inside: avoid;
  }

  .itsm-HeroWhy {
    display: none;
  }
}
`,
);
