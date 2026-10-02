import { describe, expect, it } from 'vitest';
import { avatarContract, contrastRatio, roundRatio, themeMinimum } from '../../tokens/contrast.js';
import { themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';
import { avatarStyles } from '../../web/Avatar.styles.js';
import { AVATAR_HUES } from '../tone.js';

/*
 * The avatar palette, audited (v3 §2.6, A1 §3.9): white initials on eight
 * deep discs, in every theme.
 *
 * v2 mixed a chart hue into the card colour in the component's CSS, so the
 * pair under the letters existed only there and needed its own audit. v3
 * reads the eight `--itsm-colour-avatar-N` tokens as they are, so the pair is
 * exactly the one the token contract checks (`avatarContract()`). This file
 * holds both ends of that bargain: the discs and the letters, as emitted,
 * clear the body-text floor of each theme (4.5:1, 7:1 in high contrast), and
 * the stylesheet draws them from those tokens with nothing mixed in between.
 */

describe('avatar palette', () => {
  const cases = themeNames.flatMap((theme) => Array.from({ length: AVATAR_HUES }, (_, index) => [theme, index + 1] as const));

  it.each(cases)('%s: white initials on disc %i clear the body-text floor', (theme, hue) => {
    const vars = themeVariables(theme);
    const fill = vars[`--itsm-colour-avatar-${hue}`]!;
    const text = vars['--itsm-colour-avatar-text']!;
    expect(text.toLowerCase()).toBe('#ffffff');
    const ratio = roundRatio(contrastRatio(text, fill));
    expect(ratio, `${text} on ${fill}`).toBeGreaterThanOrEqual(themeMinimum[theme].body);
  });

  it('is the pair the token contract audits: one per disc', () => {
    expect(avatarContract()).toHaveLength(AVATAR_HUES);
  });

  it('reads each disc from its token and the letters from avatar.text', () => {
    for (let hue = 1; hue <= AVATAR_HUES; hue++) {
      expect(avatarStyles).toContain(`.itsm-Avatar[data-hue="${hue}"] { --_itsm-avatar-fill: var(--itsm-colour-avatar-${hue}); }`);
    }
    expect(avatarStyles).toContain('background: var(--_itsm-avatar-fill);');
    expect(avatarStyles).toContain('color: var(--itsm-colour-avatar-text);');
  });

  it('mixes nothing under the initials', () => {
    expect(avatarStyles).not.toMatch(/color-mix\(/);
    expect(avatarStyles).not.toContain('--itsm-colour-chart-');
  });

  it('keeps the eight discs distinct from one another in every theme', () => {
    for (const theme of themeNames) {
      const vars = themeVariables(theme);
      const fills = Array.from({ length: AVATAR_HUES }, (_, index) => vars[`--itsm-colour-avatar-${index + 1}`]!.toLowerCase());
      expect(new Set(fills).size, theme).toBe(AVATAR_HUES);
    }
  });
});
