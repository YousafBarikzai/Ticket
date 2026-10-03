// @vitest-environment jsdom
import axe from 'axe-core';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_PERSONAS } from '@itsm/contracts/demo';
import { LegalPage } from '../components/LegalPage.js';
import { DEMO_NOTES, rolesCopy } from '../landing/roles-content.js';
import { cookiesDocument } from '../legal/cookies.js';
import { LEGAL_FACTS, type LegalFacts } from '../legal/facts.js';
import { privacyDocument } from '../legal/privacy.js';
import { termsDocument } from '../legal/terms.js';
import { MISSING_FACTS_NOTE, formatLegalDate, type LegalDocument } from '../legal/types.js';

/**
 * The legal pages and the chooser's copy (A5 §11, §13.1): the honesty rules
 * H1–H3, H7 and H8 over `legal/*.ts` and `roles-content.ts`, the facts and
 * their fallbacks, the fictional-data statement, and the rendered page.
 */

const BUILDERS = { privacy: privacyDocument, cookies: cookiesDocument, terms: termsDocument } as const;

const KNOWN: LegalFacts = {
  ...LEGAL_FACTS,
  legalEntity: 'Example Ltd',
  companyNumber: '00000000',
  registeredOffice: '1 Example Street, London',
  icoRegistration: 'ZA000000',
  privacyEmail: 'privacy@example.com',
  legalEmail: 'legal@example.com',
  securityEmail: 'security@example.com',
  hosting: { ...LEGAL_FACTS.hosting, dataRegion: 'EU West', identityRegion: 'EU West', requestLogRetention: 'for 30 days' },
  auditRetention: 'for 90 days',
  liabilityCap: 'one hundred pounds',
};

function strings(doc: LegalDocument): string[] {
  return [
    doc.title,
    doc.lede,
    ...doc.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === 'p' ? [block.text] : block.kind === 'list' ? block.items : [block.caption, ...block.head, ...block.rows.flat()],
      ),
    ]),
  ];
}

const COPY: readonly [string, string][] = [
  ...Object.entries(BUILDERS).flatMap(([name, build]) => strings(build()).map((s): [string, string] => [name, s])),
  ...rolesCopy(DEMO_PERSONAS).map((s): [string, string] => ['roles-content', s]),
];

describe('honesty (A5 §11.6)', () => {
  it('H1: no customer, award or certification claims', () => {
    const banned = /\b(customers?|clients?) (use|trust|love)|trusted by|award|certified|ISO ?27001|SOC ?2|Cyber Essentials|compliant\b|testimonial/i;
    expect(COPY.filter(([, s]) => banned.test(s))).toEqual([]);
  });

  it('H2: no outcome or performance claims, and no percentages', () => {
    const banned = /\d\s*(%|per ?cent)|\bfaster\b|\breduc(e|es|ed)\b.*\bby\b|\bsaves?\b|\b\d+x more\b/i;
    expect(COPY.filter(([, s]) => banned.test(s))).toEqual([]);
  });

  it('H2: the chooser and role-page copy carries no number but the reset time', () => {
    const numbers = rolesCopy(DEMO_PERSONAS).filter((s) => /\d/.test(s.replace('00:00 UK time', '')));
    expect(numbers).toEqual([]);
  });

  it('H3: no AI accuracy or capability claims and no model or vendor names', () => {
    const banned = /accura|precis|% (right|correct)|autonomous|replaces? (agents|people)|Claude|Anthropic|GPT|OpenAI|Gemini/i;
    expect(COPY.filter(([, s]) => banned.test(s))).toEqual([]);
  });

  it('H7: no superlatives, trials or prices', () => {
    const banned = /\bbest\b|\bleading\b|enterprise-grade|bank-grade|#1|world-class|free trial|£|\$|€|\bprice/i;
    expect(COPY.filter(([, s]) => banned.test(s))).toEqual([]);
  });

  it('H8: no partnership or integration claims', () => {
    const banned = /\bpartner|integrates with/i;
    expect(COPY.filter(([, s]) => banned.test(s))).toEqual([]);
  });

  it('H5: the role pages and the terms say the company is fictional', () => {
    expect(rolesCopy(DEMO_PERSONAS).some((s) => s.includes('a fictional company'))).toBe(true);
    expect(strings(termsDocument()).some((s) => s.includes('Northwind Traders (UK) and its people are invented.'))).toBe(true);
    expect(strings(privacyDocument()).join(' ')).toContain('fictional person');
    expect(DEMO_NOTES.join(' · ')).toContain("Please don't enter real personal data.");
  });
});

describe('legal facts', () => {
  it('ships with the unconfirmed facts null and the verified ones set', () => {
    expect(LEGAL_FACTS.updated).toBe('2026-10-02');
    expect(LEGAL_FACTS.hosting.appRegion).toBe('EU West (Amsterdam)');
    expect(LEGAL_FACTS.legalEntity).toBeNull();
    expect(LEGAL_FACTS.liabilityCap).toBeNull();
  });

  it('never prints a placeholder: each missing fact has a written fallback and the page says details are being confirmed', () => {
    for (const build of Object.values(BUILDERS)) {
      const doc = build();
      expect(doc.missingFacts).toBe(true);
      expect(strings(doc).filter((s) => /\bTBC\b|\bnull\b|undefined|\{|\}/.test(s))).toEqual([]);
    }
    expect(strings(privacyDocument())).toContain('Our company details will be published here.');
  });

  it('uses the facts once they are supplied, and drops the note', () => {
    for (const build of Object.values(BUILDERS)) expect(build(KNOWN).missingFacts).toBe(false);
    const privacy = strings(privacyDocument(KNOWN)).join('\n');
    expect(privacy).toContain('Example Ltd, company number 00000000, registered office 1 Example Street, London');
    expect(privacy).toContain('ZA000000');
    expect(privacy).toContain('privacy@example.com');
    expect(strings(termsDocument(KNOWN)).join('\n')).toContain('security@example.com');
    expect(strings(termsDocument(KNOWN)).join('\n')).toContain('limited to one hundred pounds');
  });

  it('formats the date the British way', () => {
    expect(formatLegalDate('2026-10-02')).toBe('2 October 2026');
  });
});

describe('LegalPage', () => {
  function load(doc: LegalDocument): Document {
    const html = renderToStaticMarkup(createElement(LegalPage, { document: doc }) as ReactElement);
    document.open();
    document.write(`<!doctype html><html lang="en-GB"><head><title>${doc.title}</title></head><body>${html}</body></html>`);
    document.close();
    return document;
  }

  it.each(Object.entries(BUILDERS))('renders /%s with one h1, the meta line, the note, the contents and the legal links', (_name, build) => {
    const doc = build();
    const page = load(doc);
    expect([...page.querySelectorAll('h1')].map((h) => h.textContent)).toEqual([doc.title]);
    expect(page.body.textContent).toContain('Last updated 2 October 2026 · Applies to the public site and the public demo');
    expect(page.body.textContent).toContain(MISSING_FACTS_NOTE);
    expect(page.querySelectorAll('main#main')).toHaveLength(1);
    expect(page.querySelectorAll('nav[aria-label="On this page"] a')).toHaveLength(doc.sections.length);
    expect(page.querySelectorAll('script, form')).toHaveLength(0);
    expect(page.body.textContent).toContain('Powered by VNE Technologies');
  });

  it('omits the note when every fact is known', () => {
    expect(load(termsDocument(KNOWN)).body.textContent).not.toContain(MISSING_FACTS_NOTE);
  });

  it.each(Object.entries(BUILDERS))('/%s passes axe', async (_name, build) => {
    load(build());
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules: { 'color-contrast': { enabled: false }, 'color-contrast-enhanced': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });
});
