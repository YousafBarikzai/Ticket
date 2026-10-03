import type { LegalFacts } from './facts.js';

/**
 * A legal page as data (A5 §11.1): headings, paragraphs, lists and tables,
 * so the honesty and cookie tests read exactly what the page renders.
 */
export type LegalBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | {
      readonly kind: 'table';
      readonly caption: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

export interface LegalSection {
  /** The fragment the table of contents links to. */
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly path: '/privacy' | '/cookies' | '/terms';
  readonly title: string;
  readonly lede: string;
  readonly updated: string;
  readonly sections: readonly LegalSection[];
  /** True when a fact this page uses is still `null`: the page then shows the "being confirmed" note. */
  readonly missingFacts: boolean;
}

export const LEGAL_EYEBROW = 'Legal';
export const LEGAL_SCOPE = 'Applies to the public site and the public demo';
export const MISSING_FACTS_NOTE = 'Some details on this page, such as our company registration, are being confirmed.';
export const ON_THIS_PAGE = 'On this page';

/** "2026-10-02" → "2 October 2026", without the runtime's locale data (the page is static). */
export function formatLegalDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

/**
 * A fact, or its written fallback, noting which was used: a page that falls
 * back anywhere shows the "being confirmed" note.
 */
export class FactReader {
  missing = false;
  constructor(readonly facts: LegalFacts) {}

  or(value: string | null, fallback: string): string {
    if (value === null) {
      this.missing = true;
      return fallback;
    }
    return value;
  }

  /** A sentence only when its fact is known; otherwise nothing (e.g. the ICO number). */
  when(value: string | null, sentence: (value: string) => string): readonly string[] {
    if (value === null) {
      this.missing = true;
      return [];
    }
    return [sentence(value)];
  }
}

/** "Who we are", shared by the privacy policy and the terms. */
export function whoWeAre(read: FactReader): readonly string[] {
  const { facts } = read;
  const entity = facts.legalEntity;
  const details = [
    entity ? `${entity}` : null,
    facts.companyNumber ? `company number ${facts.companyNumber}` : null,
    facts.registeredOffice ? `registered office ${facts.registeredOffice}` : null,
  ].filter((part): part is string => part !== null);
  if (entity === null || facts.companyNumber === null || facts.registeredOffice === null) read.missing = true;
  return [
    `The public site and demo of IT Service Management are provided by ${facts.vendor}.`,
    details.length === 3 ? `Our company details: ${details.join(', ')}.` : 'Our company details will be published here.',
  ];
}

export function p(text: string): LegalBlock {
  return { kind: 'p', text };
}

export function list(items: readonly string[]): LegalBlock {
  return { kind: 'list', items };
}
