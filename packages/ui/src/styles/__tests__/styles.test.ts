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
      const rule = utilities.slice(utilities.indexOf(`.itsm-text-${style} {`));
      const body = rule.slice(0, rule.indexOf('}'));
      expect(utilities, style).toContain(`.itsm-text-${style} {`);
      // The family and the word spacing travel with the size: Jakarta without
      // its word spacing is the run-together title the spec fixes.
      expect(body, style).toContain(`font-family: var(--itsm-text-${style}-family);`);
      expect(body, style).toContain(`font-size: var(--itsm-text-${style}-size);`);
      expect(body, style).toContain(`letter-spacing: var(--itsm-text-${style}-tracking);`);
      expect(body, style).toContain(`word-spacing: var(--itsm-text-${style}-word-spacing);`);
      // Only the kicker is drawn in capitals (D6).
      expect(body.includes('text-transform'), style).toBe(style === 'kicker');
    }
    expect(utilities).toMatch(/\.itsm-text-kicker \{[^}]*text-transform: uppercase;/);
    expect(utilities).toMatch(/\.itsm-text-id \{[^}]*font-variant-numeric: slashed-zero tabular-nums;/);
    expect(utilities.startsWith('@layer itsm.utilities {')).toBe(true);
  });

  it('shows a visually hidden heading as a band while it has keyboard focus', () => {
    const utilities = styleRegistry.find((entry) => entry.module === 'styles/utilities.styles.ts')!.css;
    const hidden = utilities.match(/\.itsm-visually-hidden-focusable:not\(:focus-visible\) \{([^}]*)\}/);
    expect(hidden).not.toBeNull();
    expect(hidden![1]).toContain('clip-path: inset(50%);');
    const shown = utilities.match(/\.itsm-visually-hidden-focusable:focus-visible \{([^}]*)\}/);
    expect(shown).not.toBeNull();
    // A 28px band in the primary text, 600 13/18 (SPEC-v3 §2.9, X-m19).
    expect(shown![1]).toContain('min-block-size: 1.75rem;');
    expect(shown![1]).toContain('color: var(--itsm-colour-text-primary);');
    expect(shown![1]).toContain('font-size: var(--itsm-text-subheadline-size);');
    expect(shown![1]).toContain('line-height: var(--itsm-text-subheadline-line);');
    expect(shown![1]).toContain('font-weight: 600;');
    expect(shown![1]).not.toContain('clip-path');
  });

  it('re-themes navy surfaces in the base layer: their text, and a focus ring that reads on navy', () => {
    const base = styleRegistry.find((entry) => entry.module === 'styles/base.styles.ts')!.css;
    const hero = base.match(/\n:where\(\[data-surface="hero"\]\) \{([^}]*)\}/);
    expect(hero).not.toBeNull();
    expect(hero![1]).toContain('--itsm-colour-border-focus: var(--itsm-colour-hero-accent);');
    expect(hero![1]).toContain('--itsm-colour-focusGap: var(--itsm-colour-hero-surface);');
    expect(hero![1]).toContain('color: var(--itsm-colour-hero-text);');
    // Forced colours keep the system's own focus colour, navy or not.
    const forced = base.slice(base.indexOf('@media (forced-colors: active) {'));
    expect(forced).toMatch(/\[data-surface="hero"\][^}]*--itsm-colour-border-focus: Highlight;/);
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

  it('edges every card class with a 1px border.subtle, the only thing that separates a card from the canvas', () => {
    // Light canvas and card differ by 1.07:1 by design (SPEC-v3 §2.9, §2.11):
    // depth is border-first, so a card class without its border vanishes.
    // All four have their v3 styles (WP-14, WP-16, WP-18 and WP-26), so none
    // is waiting any more.
    const border = /border:\s*(?:var\(--itsm-border-hair\)|1px)\s+solid\s+var\(--itsm-colour-border-subtle\)/;
    for (const card of ['.itsm-Card', '.itsm-StatCard', '.itsm-DataTable__frame', '.itsm-KanbanColumn']) {
      const escaped = card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = componentStylesheet.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`));
      expect(rule?.[1], `${card} must have a rule of its own`).toBeDefined();
      expect(rule![1], `${card} must declare a 1px border.subtle`).toMatch(border);
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
