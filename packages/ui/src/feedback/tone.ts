import type { IconName, Tone } from '../types.js';

/**
 * What a tone means on screen, in one place for every notice in this folder.
 *
 * Server-safe: plain data and a string builder, imported by server-safe
 * components (`InlineAlert`) and by style modules alike.
 */

export const tones: readonly Tone[] = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];

/**
 * The palette group a tone reads from. `accent` is the brand intent: the one
 * blue, for a notice about something the person can act on. `info` is indigo,
 * never blue (SPEC §1.2), so an informational notice is never mistaken for a
 * control.
 */
export const toneIntent: Readonly<Record<Tone, 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'>> = {
  neutral: 'neutral',
  accent: 'brand',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/**
 * The icon each tone carries when the caller names none. Status always has a
 * shape as well as a colour (SPEC §1.1): a triangle reads as a warning to
 * somebody who cannot tell amber from green.
 */
export const toneIcon: Readonly<Record<Tone, IconName>> = {
  neutral: 'info',
  accent: 'info',
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

/**
 * Component-local custom properties for each tone, scoped to `selector`:
 * `--_itsm-tone-subtle` (the tint), `--_itsm-tone-text` (text and icons on
 * that tint, or on any surface), `--_itsm-tone-border` and `--_itsm-tone-solid`.
 *
 * Local names start with `--_` so they can never be mistaken for, or collide
 * with, a token the pipeline emits; every value they hold is an audited token.
 * A rule reads `var(--_itsm-tone-text)` and gets the right intent for whatever
 * `data-tone` the element carries.
 */
export function toneRules(selector: string): string {
  return tones
    .map((tone) => {
      const intent = toneIntent[tone];
      return `${selector}[data-tone="${tone}"] {
  --_itsm-tone-subtle: var(--itsm-colour-${intent}-subtle);
  --_itsm-tone-text: var(--itsm-colour-${intent}-subtleText);
  --_itsm-tone-border: var(--itsm-colour-${intent}-border);
  --_itsm-tone-solid: var(--itsm-colour-${intent}-solid);
}`;
    })
    .join('\n');
}

/**
 * Selectors for "the person asked for more contrast": either high-contrast
 * theme pinned, or no theme pinned and the operating system asking. Notices
 * gain a tone-coloured outline there, because a pale tint alone is exactly
 * what somebody who asked for more contrast cannot see.
 */
export function moreContrast(rules: (scope: string) => string): string {
  return `${rules(':root[data-itsm-theme="high-contrast"]')}
${rules(':root[data-itsm-theme="high-contrast-dark"]')}
@media (prefers-contrast: more) {
${rules(':root:not([data-itsm-theme])')}
}`;
}
