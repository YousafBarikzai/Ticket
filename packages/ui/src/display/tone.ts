import { toneIntent, tones } from '../feedback/tone.js';
import type { IntentName } from '../tokens/tokens.js';
import type { IconName, Tone } from '../types.js';

/**
 * Tone plumbing for the display components: badges, status pills, avatars'
 * presence, timeline and activity markers.
 *
 * Server-safe: data and string builders, imported by directive-free
 * components and by style modules alike. The tone → intent mapping itself is
 * the feedback group's (`feedback/tone.ts`), so a warning notice and a
 * warning pill can never drift apart.
 */

export { moreContrast, toneIntent, tones } from '../feedback/tone.js';

/** The categorical hues an avatar can take: the eight chart slots (SPEC §1.11), as tints. */
export const AVATAR_HUES = 8;

/**
 * The icon a status pill carries when the caller names none (`icon="auto"`).
 * Each tone has its own *shape*, not only its own hue, so the state reads for
 * somebody who cannot tell amber from green (SPEC §1.1): a dot for a plain
 * state, a clock for something under way, an "i" for information, a tick,
 * a triangle, a circled "!", a pause for waiting and a flag for raised.
 * Ticket states name their own icons (`ticket-states.ts`); this is the
 * fallback for a pill that names none.
 */
export const statusIcon: Readonly<Record<Tone, IconName>> = {
  neutral: 'dot',
  accent: 'clock',
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
  hold: 'pause',
  high: 'flag',
};

/**
 * Component-local custom properties for every tone, scoped to `selector`:
 * `--_itsm-tone-subtle`, `--_itsm-tone-text` (the intent's `subtleText`),
 * `--_itsm-tone-border`, `--_itsm-tone-solid` and `--_itsm-tone-solidText`.
 *
 * The feedback group's `toneRules` sets the first four; badges and pills also
 * need the text colour for a solid fill, so this writes all five. Every value
 * is an audited token (SPEC §1.2), and the local names start with `--_` so
 * they can never collide with one the pipeline emits.
 */
export function toneVariables(selector: string): string {
  return tones
    .map((tone) => {
      const intent = toneIntent[tone];
      return `${selector}[data-tone="${tone}"] {
  --_itsm-tone-subtle: var(--itsm-colour-${intent}-subtle);
  --_itsm-tone-text: var(--itsm-colour-${intent}-subtleText);
  --_itsm-tone-border: var(--itsm-colour-${intent}-border);
  --_itsm-tone-solid: var(--itsm-colour-${intent}-solid);
  --_itsm-tone-solidText: var(--itsm-colour-${intent}-solidText);
}`;
    })
    .join('\n');
}

/**
 * The deprecated `intent` prop's value as a `Tone` (SPEC §4.11: Badge
 * `intent` → `tone`). `brand` is the one that changed name: it is `accent`.
 */
export function toneFromIntent(intent: IntentName): Tone {
  return intent === 'brand' ? 'accent' : intent;
}
