import { DEMO_RESET } from '@itsm/contracts/demo';
import { LEGAL_FACTS, type LegalFacts } from './facts.js';
import { FactReader, list, p, whoWeAre, type LegalDocument } from './types.js';

/**
 * The privacy policy (`/privacy`; A5 §11.2). Plain statements of what the
 * site and the demo actually do, each traceable to the code: the site sets no
 * cookie and keeps one local-storage hint; IP addresses are turned into daily
 * salted codes for the abuse limits (SPEC §4.8) and never stored raw; what a
 * visitor types is recorded under the fictional person's name (D23); retired
 * demo generations keep their activity records (D19); AI suggestions in the
 * demo are pre-written samples (D13).
 */
export function privacyDocument(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  const read = new FactReader(facts);
  const contact = read.or(
    facts.privacyEmail && `Write to ${facts.privacyEmail} with any question about privacy.`,
    'A contact address for privacy questions will be published here.',
  );
  const logs = read.or(facts.hosting.requestLogRetention, 'for a limited period set by the provider');
  const audit = read.or(facts.auditRetention, 'for a limited period');
  const regions =
    facts.hosting.dataRegion !== null && facts.hosting.identityRegion !== null
      ? `The database runs in ${facts.hosting.dataRegion} and the sign-in service in ${facts.hosting.identityRegion}.`
      : read.or(null, 'The database and sign-in services run in regions chosen by our hosting provider; we will list them here.');

  return {
    path: '/privacy',
    title: 'Privacy policy',
    lede: 'What the public site and the demo collect, why, and for how long.',
    updated: facts.updated,
    sections: [
      {
        id: 'at-a-glance',
        heading: 'At a glance',
        blocks: [
          list([
            "You don't need an account to try the demo. Choosing a role signs you in as a fictional person, so we don't ask for your name or email address.",
            'This site sets no cookies. When you open the demo, the areas you visit set essential cookies to keep you signed in.',
            `The demo is shared: what you type is visible to other visitors until the next reset, at ${DEMO_RESET.label}.`,
            "Please don't enter real personal or confidential information.",
          ]),
        ],
      },
      {
        id: 'who-we-are',
        heading: 'Who we are',
        blocks: [
          ...whoWeAre(read).map(p),
          p('For the public site and the demo we are the controller under the UK GDPR and the Data Protection Act 2018.'),
          ...read.when(facts.icoRegistration, (number) => `We are registered with the Information Commissioner's Office under number ${number}.`).map(p),
          p(contact),
          p(
            'When an organisation uses IT Service Management for its own staff, that organisation decides how its data is used, and its own privacy notice applies.',
          ),
        ],
      },
      {
        id: 'what-we-collect',
        heading: 'What we collect and why',
        blocks: [
          list([
            "The site: nothing about you. It has no cookies, no analytics and no forms. When you choose a role it keeps one item in your browser's local storage (see the cookie policy), which never leaves your device.",
            'The demo: a session cookie in each area you open, and a cookie that lets a demo link bring you back until the next reset. Neither holds anything about you.',
            `Your IP address, for security: it is turned into a code with a secret that changes every day, used only to limit how often the demo can be opened or changed from one network. The codes expire within two hours and the daily secret within two days. We do not store the raw address. Our hosting provider keeps standard request logs ${logs}.`,
            'What you type into the demo: stored in the shared demo so it works like the real product, and visible to other visitors. It is recorded under the fictional person\'s name, never yours, and without your IP address.',
            'Sign-in with a work account: handled for your organisation under its agreement with us.',
          ]),
        ],
      },
      {
        id: 'after-the-reset',
        heading: 'After the nightly reset',
        blocks: [
          p(
            `The reset replaces all demo data with a fresh copy. The demo's activity records, which can include text you typed, are kept after the reset for security and audit purposes, ${audit}.`,
          ),
        ],
      },
      {
        id: 'what-we-dont-do',
        heading: "What we don't do",
        blocks: [
          list([
            'No advertising and no tracking.',
            'No selling of data.',
            'No third-party fonts, scripts or content networks on the site.',
            'No AI provider receives anything you type in the demo: the AI suggestions there are pre-written samples.',
          ]),
        ],
      },
      {
        id: 'lawful-basis',
        heading: 'Lawful basis',
        blocks: [p('Our legitimate interests: running, securing and demonstrating the product.')],
      },
      {
        id: 'sharing',
        heading: 'Who we share it with',
        blocks: [p(`Our hosting provider, ${facts.hosting.provider}, as processor. Nobody else.`)],
      },
      {
        id: 'where',
        heading: 'Where it is processed',
        blocks: [p(`The applications run in ${facts.hosting.provider.replace(/ Corporation$/, '')}'s ${facts.hosting.appRegion} region.`), p(regions)],
      },
      {
        id: 'how-long',
        heading: 'How long we keep it',
        blocks: [
          {
            kind: 'table',
            caption: 'How long each item is kept',
            head: ['Item', 'Kept'],
            rows: [
              ['The site\'s local-storage item', 'Until the next reset, or until you choose "Forget"'],
              ['Demo cookies', 'Until the next reset, and never more than 24 hours'],
              ['IP codes', 'Up to two hours'],
              ['What you type into the demo', 'Until the next reset'],
              ['Demo activity records', audit.charAt(0).toUpperCase() + audit.slice(1)],
              ['Hosting request logs', logs.charAt(0).toUpperCase() + logs.slice(1)],
            ],
          },
        ],
      },
      {
        id: 'security',
        heading: 'Security',
        blocks: [p('Connections are encrypted, each area keeps its sign-in cookies to its own address, and the demo runs apart from every real organisation\'s data.')],
      },
      {
        id: 'your-rights',
        heading: 'Your rights',
        blocks: [
          p(
            "Under the UK GDPR you can ask for access to, correction of or deletion of personal data we hold about you, and object to how we use it. You can also complain to the Information Commissioner's Office (ico.org.uk).",
          ),
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        blocks: [p('The site and the demo are for business users aged 18 or over.')],
      },
      {
        id: 'changes',
        heading: 'Changes',
        blocks: [p('When this policy changes, the date at the top of the page changes with it.')],
      },
      { id: 'contact', heading: 'Contact', blocks: [p(contact)] },
    ],
    missingFacts: read.missing,
  };
}
