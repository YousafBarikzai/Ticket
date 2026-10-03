import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../tokens/contrast.js';
import { themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';
import * as avatarModule from '../../web/Avatar.styles.js';
import { avatarStyles } from '../../web/Avatar.styles.js';
import { AVATAR_HUES } from '../tone.js';

/*
 * The avatar discs against the surfaces they sit on (v3 §2.6, §2.14).
 *
 * v2 drew avatars as tints: a chart hue mixed into the card colour in the
 * component's CSS, audited here. v3 draws deep `avatar-N` discs with white
 * initials, read from the tokens as they are, and `avatar-palette.test.ts`
 * audits the letters on each disc. SPEC §2.16 retires this file in favour of
 * that one; until it is removed, it holds the two things of v2's audit that
 * still mean something:
 *
 * - no tint is left to audit: no mix, and no tint share exported for one;
 * - each disc reads as a shape against every surface a card, row or menu
 *   draws behind it. Not a WCAG requirement (the name carries the meaning and
 *   the letters are audited against the disc), but a disc that melted into
 *   the row would make a list look broken. v2's tints cleared 1.1:1 against
 *   the card; the deep discs clear 1.5:1 everywhere, dark themes included.
 */

const BEHIND_AN_AVATAR = ['canvas', 'raised', 'raisedAlt', 'sunken', 'overlay', 'hover', 'selected'] as const;

describe('avatar discs', () => {
  it('mixes no tint and exports no tint share', () => {
    expect(avatarStyles).not.toContain('--_itsm-avatar-tint');
    expect(avatarStyles).not.toMatch(/color-mix\(/);
    expect(avatarModule).not.toHaveProperty('AVATAR_TINT_PERCENT');
  });

  it.each(themeNames)('%s: every disc stands apart from the surfaces behind it', (theme) => {
    const vars = themeVariables(theme);
    for (let hue = 1; hue <= AVATAR_HUES; hue++) {
      const disc = vars[`--itsm-colour-avatar-${hue}`]!;
      for (const surface of BEHIND_AN_AVATAR) {
        const behind = vars[`--itsm-colour-surface-${surface}`]!;
        expect(contrastRatio(disc, behind), `avatar-${hue} on surface.${surface}`).toBeGreaterThan(1.5);
      }
    }
  });
});
