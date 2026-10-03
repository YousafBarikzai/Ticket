import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREA_ORDER, AREAS } from '../areas.js';
import { DEMO_COMPANY } from '../demo.js';
import { SIGN_IN_PANEL, VENDOR, type SignInPanelCopy } from '../marketing.js';

/*
 * The sign-in panel's copy (SPEC v3 §6.3; A5 §6.9, §11.6).
 *
 * The same words are drawn on the site, in three apps and in the Keycloak
 * theme, so they are pinned here once: the exact strings, the lengths that
 * keep the panel from wrapping into a wall of text, and the honesty rules
 * that apply to anything a prospect reads before signing in.
 */

/** Every user-visible string in the panel, labelled for the failure message. */
function strings(panel: SignInPanelCopy): [string, string][] {
  return [
    ['suffix', panel.suffix],
    ['headline', panel.headline],
    ...panel.points.map((point, index): [string, string] => [`point ${index + 1}`, point.text]),
    ['poweredBy', panel.poweredBy],
    ['VENDOR.name', VENDOR.name],
    ['VENDOR.line', VENDOR.line],
  ];
}

describe('VENDOR', () => {
  it('names the vendor in one line, exactly (H10)', () => {
    expect(VENDOR).toEqual({ name: 'VNE Technologies', line: 'Powered by VNE Technologies' });
    expect(VENDOR.line).toBe(`Powered by ${VENDOR.name}`);
  });

  it('agrees with the line the demo contracts print', () => {
    expect(DEMO_COMPANY.vendorLine).toBe(VENDOR.line);
  });
});

describe('SIGN_IN_PANEL', () => {
  it('says what the SPEC says, word for word', () => {
    expect(SIGN_IN_PANEL).toEqual({
      suffix: 'Help Portal · Service Desk · Administration',
      headline: 'Every request, ticket and change in one place',
      points: [
        { icon: 'sla', text: 'Live queues and SLA timers for your service desk' },
        { icon: 'life-buoy', text: 'A Help Portal for requests, approvals and answers' },
        { icon: 'workflow', text: 'Rules, workflows and reports you set up yourself' },
      ],
      poweredBy: 'Powered by VNE Technologies',
    });
    expect(SIGN_IN_PANEL.poweredBy).toBe(VENDOR.line);
  });

  it('lists the three areas by their canonical names, in their canonical order', () => {
    // A renamed area (D1) would otherwise leave the panel naming the old one.
    expect(SIGN_IN_PANEL.suffix).toBe(AREA_ORDER.map((id) => AREAS[id].name).join(' · '));
  });

  it('keeps the headline to 48 characters and each of three points to 56', () => {
    expect(SIGN_IN_PANEL.headline.length).toBeLessThanOrEqual(48);
    expect(SIGN_IN_PANEL.points).toHaveLength(3);
    for (const point of SIGN_IN_PANEL.points) expect(point.text.length, point.text).toBeLessThanOrEqual(56);
  });

  it('claims no figure and no percentage anywhere (honesty rules H1–H2)', () => {
    for (const [where, text] of strings(SIGN_IN_PANEL)) {
      expect(text, where).not.toMatch(/[%\d]/);
    }
  });

  it('makes no superlative, price or trial claim (H8)', () => {
    const words = /\b(?:best|fastest|leading|world-class|free|trial|pricing|price|guarantee[ds]?|certified)\b/i;
    for (const [where, text] of strings(SIGN_IN_PANEL)) expect(text, where).not.toMatch(words);
  });

  it('writes sentence case with no trailing full stop (R-6), and British spellings', () => {
    for (const [where, text] of strings(SIGN_IN_PANEL)) {
      expect(text, where).toBe(text.trim());
      expect(text, where).not.toMatch(/[.!]$/);
      expect(text[0], where).toBe(text[0]!.toUpperCase());
      expect(text, where).not.toMatch(/\b(?:organization|center|color|customize|optimize)\b/i);
    }
  });

  it('names its icons in the design system’s kebab-case', () => {
    // `IconName` membership itself is checked where the registry lives
    // (`packages/ui/src/shell/__tests__/sign-in-layout.test.tsx`).
    for (const point of SIGN_IN_PANEL.points) expect(point.icon).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });

  it('is frozen to the leaves, because every render shares it', () => {
    expect(Object.isFrozen(VENDOR)).toBe(true);
    expect(Object.isFrozen(SIGN_IN_PANEL)).toBe(true);
    expect(Object.isFrozen(SIGN_IN_PANEL.points)).toBe(true);
    for (const point of SIGN_IN_PANEL.points) expect(Object.isFrozen(point)).toBe(true);
  });
});

describe('the module', () => {
  it('imports nothing, so a page or a theme generator can read it without pulling a graph along', () => {
    const source = readFileSync(new URL('../marketing.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
