import { describe, expect, it } from 'vitest';
import { SIGN_IN_PANEL, VENDOR } from '@itsm/contracts/marketing';
import { landingCopy } from '../landing/content.js';

/**
 * The honesty rules over everything the landing says and the shared
 * marketing copy (SPEC v3 §6.2 "Honesty rules"; A5 §11.6 H1–H3, H7, H8).
 * The chooser's, role pages' and legal pages' copy is held to the same rules
 * by their own tests (WP-51).
 */

const marketing = [SIGN_IN_PANEL.suffix, SIGN_IN_PANEL.headline, SIGN_IN_PANEL.poweredBy, ...SIGN_IN_PANEL.points.map((point) => point.text), VENDOR.name, VENDOR.line];
const copy = [...landingCopy(), ...marketing];

const offenders = (pattern: RegExp, lines: readonly string[] = copy): string[] => lines.filter((line) => pattern.test(line));

describe('the honesty rules', () => {
  it('finds the copy it checks', () => {
    expect(copy.length).toBeGreaterThan(100);
  });

  it('H1: no customer claims, awards or certifications', () => {
    expect(offenders(/\b(customers?|clients?) (use|trust|love)|trusted by|award|certified|ISO ?27001|SOC ?2|Cyber Essentials|compliant\b|testimonial/i)).toEqual([]);
  });

  it('H2: no outcome claims and no figure, except the reset time, the cooldown and the Overview’s period names', () => {
    expect(offenders(/\d\s*(%|per ?cent)|\bfaster\b|\breduc(e|es|ed)\b.*\bby\b|\bsaves?\b|\b\d+x more\b/i)).toEqual([]);
    // Every digit sits in an allowed phrase: "00:00 UK time" (D12), "30 minutes" (the cooldown, D12),
    // "7, 30 or 90 days" and "90 days" / "30 and 90 days" (the Overview's period choices, product facts),
    // the build estimate, worded by `demoEtaPhrase` ("about 4 minutes"), a product name in the
    // trademark note ("Microsoft 365") and the copyright year.
    const allowed = /00:00 UK time|30 minutes|7, 30 or 90 days|30 and 90 days|90 days|about \d+ minutes?|Microsoft 365|© 2026/g;
    expect(copy.map((line) => line.replace(allowed, '')).filter((line) => /\d/.test(line))).toEqual([]);
  });

  it('H3: no AI accuracy or capability claim, and no model or vendor name', () => {
    expect(offenders(/accura|precis|% (right|correct)|autonomous|replaces? (agents|people)/i)).toEqual([]);
    expect(offenders(/Claude|Anthropic|GPT|OpenAI|Gemini/)).toEqual([]);
  });

  it('H7: no superlatives, trials or prices', () => {
    expect(offenders(/\bbest\b|\bleading\b|enterprise-grade|bank-grade|#1|world-class|free trial|£|\$|€|pricing/i)).toEqual([]);
  });

  it('H8: no partnership or integration claim', () => {
    expect(offenders(/\bpartner|integrates with/i)).toEqual([]);
  });
});
