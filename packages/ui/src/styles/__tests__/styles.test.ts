import { afterEach, describe, expect, it, vi } from 'vitest';
import { css, layer, layerNames, layerOrderStatement, mq, prefers, unknownVariables } from '../css.js';
import { componentStylesheet, uiStylesheet, uiStylesheetVersion } from '../index.js';
import { styleRegistry } from '../registry.js';
import { renderTokenStylesheet } from '../../tokens/css.js';
import { textRamp } from '../../tokens/tokens.js';

/**
 * The stylesheet pipeline: layers, the base layer, and the tools the style
 * modules are written with.
 *
 * The cascade layers are what let an application's unlayered CSS win over the
 * design system without a specificity contest, and what let a component rule
 * beat the base layer without one. Both depend on details a refactor could
 * lose without any visible failure in a unit test of a component — the order
 * statement coming first, every module being inside a layer — so they are
 * pinned here.
 */

describe('the assembled stylesheet', () => {
  const sheet = uiStylesheet();

  it('declares the layer order before anything else', () => {
    expect(sheet.startsWith(layerOrderStatement)).toBe(true);
    expect(layerOrderStatement).toBe(
      '@layer itsm.reset, itsm.tokens, itsm.base, itsm.components, itsm.patterns, itsm.utilities;',
    );
  });

  it('puts the token variables in the tokens layer, unchanged', () => {
    expect(sheet).toContain(layer('tokens', renderTokenStylesheet()));
  });

  it('is the tokens followed by the component sheet', () => {
    expect(sheet.endsWith(componentStylesheet)).toBe(true);
  });

  it('wraps every registered module in a layer, except the vendor overrides', () => {
    for (const entry of styleRegistry) {
      if (entry.css === '' || entry.module === 'styles/vendor.styles.ts') continue;
      const opened = entry.css.match(/^@layer (itsm\.[a-z]+) \{/);
      expect(opened, entry.module).not.toBeNull();
      expect(layerNames.map((name) => `itsm.${name}`), entry.module).toContain(opened![1]);
      expect(entry.css.trimEnd().endsWith('}'), entry.module).toBe(true);
    }
  });

  it('has no rule that styles elements by the itsm- prefix of their class', () => {
    // The old `[class^="itsm-"], [class*=" itsm-"]` rule forced 4px corners on
    // every focus ring and styled app elements that happened to share the
    // prefix. The base layer replaced it; it must not come back.
    expect(sheet).not.toMatch(/\[class[\^*]="\s*itsm-"\]/);
  });

  it('draws the two-tone focus ring through the base layer without changing the corners', () => {
    const base = styleRegistry.find((entry) => entry.module === 'styles/base.styles.ts')!.css;
    const focus = base.match(/:where\(:focus-visible\) \{([^}]*)\}/);
    expect(focus).not.toBeNull();
    expect(focus![1]).toContain('outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus)');
    expect(focus![1]).toContain('outline-offset: var(--itsm-focus-offset)');
    // The inner tone fills the offset gap, so the ring reads on glass and on
    // saturated fills as well as on a plain surface.
    expect(focus![1]).toContain('box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap)');
    expect(focus![1]).not.toContain('border-radius');
    expect(base.startsWith('@layer itsm.base {')).toBe(true);
  });

  it('colours text selection from the audited selection token', () => {
    const base = styleRegistry.find((entry) => entry.module === 'styles/base.styles.ts')!.css;
    const selection = base.match(/::selection \{([^}]*)\}/);
    expect(selection).not.toBeNull();
    expect(selection![1]).toContain('background: var(--itsm-colour-surface-selection);');
    expect(selection![1]).toContain('color: var(--itsm-colour-text-primary);');
  });

  it('turns view transitions off for reduced motion, from the OS and from the product setting', () => {
    const base = styleRegistry.find((entry) => entry.module === 'styles/base.styles.ts')!.css;
    expect(base).toContain(`${mq.reducedMotion} {`);
    expect(base).toContain(`${prefers.reducedMotion}::view-transition-old(*)`);
  });

  it('offers every step of the type ramp as a utility class', () => {
    const utilities = styleRegistry.find((entry) => entry.module === 'styles/utilities.styles.ts')!.css;
    for (const style of Object.keys(textRamp)) {
      expect(utilities, style).toContain(`.itsm-text-${style} {`);
      expect(utilities, style).toContain(`font-size: var(--itsm-text-${style}-size);`);
      expect(utilities, style).toContain(`letter-spacing: var(--itsm-text-${style}-tracking);`);
    }
    expect(utilities.startsWith('@layer itsm.utilities {')).toBe(true);
  });

  it('resets the body: no margin, the canvas colour and the family', () => {
    const base = styleRegistry.find((entry) => entry.module === 'styles/base.styles.ts')!.css;
    const body = base.match(/\nbody \{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body![1]).toContain('margin: 0;');
    expect(body![1]).toContain('background: var(--itsm-colour-surface-canvas);');
    expect(body![1]).toContain('font-family: var(--itsm-font-family-sans);');
  });

  it('keeps the class names the component tests pin', () => {
    for (const name of [
      '.itsm-CommandPalette__input',
      '.itsm-CommandPalette__empty',
      '.itsm-Dialog__scrim',
      '.itsm-AiSuggestion__actions',
      '.itsm-visually-hidden',
    ]) {
      expect(componentStylesheet, name).toContain(name);
    }
  });

  it('writes no colour literals in component CSS: colours come from tokens', () => {
    for (const entry of styleRegistry) {
      expect(entry.css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], entry.module).toEqual([]);
      expect(entry.css.match(/\b(?:rgba?|hsla?)\(/g) ?? [], entry.module).toEqual([]);
    }
  });

  it('versions the sheet with a stable eight-digit hash of its text', () => {
    expect(uiStylesheetVersion).toMatch(/^[0-9a-f]{8}$/);
    expect(uiStylesheet()).toBe(sheet);
  });
});

describe('layer()', () => {
  it('wraps rules in the named layer', () => {
    expect(layer('components', '.x { color: red; }')).toBe('@layer itsm.components {\n.x { color: red; }\n}\n');
  });

  it('renders a module with no rules yet as nothing', () => {
    expect(layer('components', '')).toBe('');
    expect(layer('patterns', '  \n ')).toBe('');
  });
});

describe('the css tag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the text with its interpolations', () => {
    expect(css`${mq.md} { .a { gap: ${2}px; } }`).toBe('@media (min-width: 48rem) { .a { gap: 2px; } }');
  });

  it('names variables the pipeline does not emit, ignoring fallbacks', () => {
    expect(unknownVariables('a { color: var(--itsm-colour-text-primary); gap: var(--itsm-space-nonsense, 1px); }')).toEqual([
      '--itsm-space-nonsense',
    ]);
    expect(unknownVariables('a { color: var(--itsm-colour-text-primary); }')).toEqual([]);
  });

  it('throws on an unknown variable in development, so the typo shows on the first page load', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => css`a { color: var(--itsm-colour-text-primray); }`).toThrow(/--itsm-colour-text-primray/);
  });

  it('does not throw outside development, where the tests make the same check', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(css`a { color: var(--itsm-colour-text-primray); }`).toBe('a { color: var(--itsm-colour-text-primray); }');
  });
});

describe('mq', () => {
  it('derives its queries from the breakpoint tokens, in rem', () => {
    expect(mq.sm).toBe('@media (min-width: 30rem)');
    expect(mq.md).toBe('@media (min-width: 48rem)');
    expect(mq.lg).toBe('@media (min-width: 64rem)');
    expect(mq.xl).toBe('@media (min-width: 80rem)');
    // Where the workbench gains its inspector column.
    expect(mq['2xl']).toBe('@media (min-width: 90rem)');
  });

  it('names the product-level preferences as selector prefixes for the rules a variable cannot express', () => {
    expect(prefers.reducedMotion).toBe(':root[data-itsm-motion="reduced"]');
    expect(prefers.reducedTransparency).toBe(':root[data-itsm-transparency="reduced"]');
  });

  it('stops the below-queries one pixel short, so the pair never overlaps', () => {
    // 767px at the default 16px text size: where the old stylesheet's
    // hand-written `max-width: 767px` switched.
    expect(mq.belowMd).toBe('@media (max-width: 47.9375rem)');
  });
});
