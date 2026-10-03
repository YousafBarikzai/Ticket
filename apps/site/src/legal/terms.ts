import { DEMO_COMPANY, DEMO_RESET } from '@itsm/contracts/demo';
import { LEGAL_FACTS, type LegalFacts } from './facts.js';
import { FactReader, list, p, whoWeAre, type LegalDocument } from './types.js';

/**
 * The terms of use (`/terms`; A5 §11.4) for the public site and the free,
 * shared demo. The reset rules mirror the product: a scheduled reset at
 * 00:00 UK time, and a visitor's reset followed by a 30-minute cool-down
 * (`DEMO_RESET_COOLDOWN_SECONDS`).
 */
export function termsDocument(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  const read = new FactReader(facts);
  const security = read.or(
    facts.securityEmail && `report it to ${facts.securityEmail} instead`,
    'report it to us instead, at the security contact we will publish here',
  );
  const contact = read.or(facts.legalEmail && `Write to ${facts.legalEmail} with any question about these terms.`, 'A contact address for these terms will be published here.');
  const cap = read.when(facts.liabilityCap, (value) => `Otherwise, our total liability is limited to ${value}.`);

  return {
    path: '/terms',
    title: 'Terms of use',
    lede: 'The terms for using the public site and the shared demo.',
    updated: facts.updated,
    sections: [
      {
        id: 'short-version',
        heading: 'The short version',
        blocks: [
          list([
            'The demo is free, for evaluation only, and provided "as is" with no service levels.',
            `It resets every day at ${DEMO_RESET.label} and may be reset at other times.`,
            "It is shared, so don't enter real personal or confidential data.",
            'Everyone in it is fictional.',
            'Please use it fairly.',
          ]),
        ],
      },
      { id: 'who-we-are', heading: '1. Who we are', blocks: whoWeAre(read).map(p) },
      {
        id: 'the-demo',
        heading: '2. The demo',
        blocks: [
          p(
            'The demo is free and for evaluation. It is provided "as is" and "as available". Some features are switched off in it and marked with a lock. We may change or withdraw it. It is for business users aged 18 or over.',
          ),
        ],
      },
      {
        id: 'daily-reset',
        heading: '3. Daily reset',
        blocks: [
          p(
            `The demo resets every day at ${DEMO_RESET.label}, which is London time (GMT or BST). A visitor can reset it, after which it cannot be reset again for 30 minutes. We may also reset it. We cannot recover data after a reset.`,
          ),
        ],
      },
      {
        id: 'shared',
        heading: '4. A shared environment',
        blocks: [p('Other visitors can see and change what you enter, and you can see theirs, until the next reset.')],
      },
      {
        id: 'acceptable-use',
        heading: '5. Acceptable use',
        blocks: [
          list([
            'No real personal or confidential data.',
            'Nothing unlawful, offensive or infringing.',
            'No malware.',
            `No security testing, scanning or load generation. If you find a vulnerability, ${security}.`,
            'No bots, scraping or attempts to get round rate limits.',
            'No attempt to reach other systems or switched-off features.',
            'No spam or impersonation.',
            'No framing, reselling or competing use.',
          ]),
        ],
      },
      {
        id: 'fictional-data',
        heading: '6. Fictional data',
        blocks: [p(`${DEMO_COMPANY.name} and its people are invented. Product names that appear in demo tickets belong to their owners.`)],
      },
      {
        id: 'your-content',
        heading: '7. Your content',
        blocks: [p('You give us permission to host what you enter in the demo until it is reset. We may remove anything.')],
      },
      {
        id: 'intellectual-property',
        heading: '8. Intellectual property',
        blocks: [p(`The software and the site belong to ${facts.vendor}.`)],
      },
      {
        id: 'liability',
        heading: '9. Liability',
        blocks: [
          p(
            'Nothing in these terms excludes liability that cannot be excluded under the law of England and Wales. Otherwise, we are not liable for any loss arising from your use of a free demo.',
          ),
          ...cap.map(p),
        ],
      },
      { id: 'suspension', heading: '10. Suspension', blocks: [p('We may suspend or block access to the demo to protect it or other visitors.')] },
      {
        id: 'privacy-cookies',
        heading: '11. Privacy and cookies',
        blocks: [p('The privacy policy and the cookie policy explain what we collect and the cookies the product uses.')],
      },
      { id: 'changes', heading: '12. Changes', blocks: [p('We may change these terms. The date at the top of the page shows the latest version.')] },
      {
        id: 'general',
        heading: '13. General',
        blocks: [p('If any part of these terms cannot be enforced, the rest still applies. Not enforcing a term is not a waiver of it.')],
      },
      { id: 'governing-law', heading: '14. Governing law', blocks: [p('These terms are governed by the law of England and Wales.')] },
      { id: 'contact', heading: '15. Contact', blocks: [p(contact)] },
    ],
    missingFacts: read.missing,
  };
}
