import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColour, roundRatio, themeMinimum } from '../../tokens/contrast.js';
import { themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';
import { AVATAR_TINT_PERCENT } from '../../web/Avatar.styles.js';
import { avatarStyles } from '../../web/Avatar.styles.js';
import { AVATAR_HUES } from '../tone.js';

/*
 * The avatar tints, audited (SPEC §4.6: "deterministic hue from 8 audited
 * tints").
 *
 * An avatar's background is `color-mix(in srgb, chart-N P%, surface.raised)`
 * — decoration mixed from two audited tokens, which the token contract does
 * not see because the mix happens in the component's CSS. So this test does
 * the mix the way the browser does (`color-mix` in sRGB is source-over
 * compositing at P % alpha) and holds the initials' colour to the same floor
 * the token contract uses for body text: 4.5:1 in the standard themes, 7:1 in
 * the high-contrast ones.
 */

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseColour(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

describe('avatar tints', () => {
  const cases = themeNames.flatMap((theme) =>
    Array.from({ length: AVATAR_HUES }, (_, index) => [theme, index + 1] as const),
  );

  it.each(cases)('%s: initials on hue %i clear the body-text floor', (theme, hue) => {
    const vars = themeVariables(theme);
    const tint = vars[`--itsm-colour-chart-${hue}`]!;
    const raised = vars['--itsm-colour-surface-raised']!;
    const text = vars['--itsm-colour-text-secondary']!;
    const background = composite(rgba(tint, AVATAR_TINT_PERCENT / 100), raised);
    const ratio = roundRatio(contrastRatio(text, background));
    expect(ratio, `${text} on ${background}`).toBeGreaterThanOrEqual(themeMinimum[theme].body);
  });

  it('mixes the percentage the test audits, from the chart and raised tokens', () => {
    expect(avatarStyles).toContain(
      `color-mix(in srgb, var(--_itsm-avatar-tint) ${AVATAR_TINT_PERCENT}%, var(--itsm-colour-surface-raised))`,
    );
    expect(avatarStyles).toContain('color: var(--itsm-colour-text-secondary);');
    for (let hue = 1; hue <= AVATAR_HUES; hue++) {
      expect(avatarStyles).toContain(`.itsm-Avatar[data-hue="${hue}"] { --_itsm-avatar-tint: var(--itsm-colour-chart-${hue}); }`);
    }
  });

  it('keeps each tint visibly different from the surface it sits on, so the avatar reads as a shape', () => {
    // Not a WCAG requirement (the name carries the meaning), but a tint that
    // vanishes into the card would make the list look broken.
    for (const theme of themeNames) {
      const vars = themeVariables(theme);
      const raised = vars['--itsm-colour-surface-raised']!;
      for (let hue = 1; hue <= AVATAR_HUES; hue++) {
        const background = composite(rgba(vars[`--itsm-colour-chart-${hue}`]!, AVATAR_TINT_PERCENT / 100), raised);
        expect(contrastRatio(background, raised), `${theme} hue ${hue}`).toBeGreaterThan(1.1);
      }
    }
  });
});
