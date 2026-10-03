import { DEMO_RESET } from '@itsm/contracts/demo';
import { CONTINUE_KEY } from '../client/continue-read.js';
import { LEGAL_FACTS, type LegalFacts } from './facts.js';
import { FactReader, list, p, type LegalDocument } from './types.js';

/**
 * The cookie policy (`/cookies`; A5 §11.3).
 *
 * The cookie names are written out rather than imported: the site may not
 * depend on the BFF outside its tests (`guards.test.ts`).
 * `cookies-page.test.ts` imports the real constants from `@itsm/bff/cookies`
 * and the Service Desk's `LAST_VIEW_COOKIE` and fails when one is missing
 * here, so a renamed cookie breaks the build instead of leaving the policy
 * wrong.
 */
export const PRODUCT_COOKIES = Object.freeze({
  session: '__Host-session',
  demo: '__Host-itsm-demo',
  retry: '__Host-itsm-retry',
  lastPath: '__Host-itsm-last',
  lastView: 'itsm-wb-last-view',
});

export function cookiesDocument(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  const read = new FactReader(facts);
  const contact = read.or(
    facts.privacyEmail && `Write to ${facts.privacyEmail} with any question about cookies.`,
    'A contact address for questions about cookies will be published here.',
  );
  return {
    path: '/cookies',
    title: 'Cookie policy',
    lede: 'The cookies and browser storage the site, the demo and the product use.',
    updated: facts.updated,
    sections: [
      {
        id: 'at-a-glance',
        heading: 'At a glance',
        blocks: [
          p(
            'This site sets no cookies. The demo and the product use only cookies that are strictly necessary to sign you in and keep you signed in, so there is no cookie banner. No analytics, advertising or third-party cookies.',
          ),
        ],
      },
      {
        id: 'product-cookies',
        heading: "Cookies set by the product's areas",
        blocks: [
          p('The Help Portal, the Service Desk and Administration each set these on their own address.'),
          {
            kind: 'table',
            caption: "Cookies set by the product's areas",
            head: ['Name', 'Set when', 'Purpose', 'Type', 'Expires'],
            rows: [
              [PRODUCT_COOKIES.session, 'You open the demo or sign in', 'Keeps you signed in to that area', 'Strictly necessary', 'Demo: up to 24 hours. Work account: up to 12 hours'],
              [PRODUCT_COOKIES.demo, 'You open the demo', 'Lets a demo link bring you back to the demo in that area', 'Strictly necessary', `At the next reset, ${DEMO_RESET.label}`],
              [PRODUCT_COOKIES.retry, 'A sign-in is interrupted, for example by Back', 'Lets that sign-in recover once', 'Strictly necessary', '60 seconds'],
              [PRODUCT_COOKIES.lastPath, 'You move around an area', 'Returns you to the page you were on when you switch areas', 'Strictly necessary', '12 hours'],
              [PRODUCT_COOKIES.lastView, 'You choose an inbox view in the Service Desk', 'Opens the inbox on that view', 'Functional, set by your action', 'One year'],
            ],
          },
        ],
      },
      {
        id: 'sign-in-cookies',
        heading: 'Cookies set by the sign-in service',
        blocks: [
          p(
            'Only when you sign in with a work account, never in the demo: AUTH_SESSION_ID, KC_RESTART, KEYCLOAK_IDENTITY and KEYCLOAK_SESSION. These are the sign-in service\'s own cookies. They are strictly necessary and end when you sign out or reach the session limit.',
          ),
        ],
      },
      {
        id: 'browser-storage',
        heading: 'Browser storage',
        blocks: [
          p('These items stay in your browser and are never sent to us.'),
          list([
            `The site: ${CONTINUE_KEY}, the demo role you last opened, so we can offer "Continue the demo". It is removed at the next reset or when you choose "Forget".`,
            'The areas: itsm-prefs (appearance), itsm-recents:* and itsm-pins:* (recent and pinned items), itsm-split:inbox, itsm-nav-collapsed:*, itsm-datatable-hint, itsm-demo:last-gen and itsm-demo:notice-seen (the demo-reset notice), and unsent reply drafts.',
            'Offline copies: the Help Portal and the Service Desk keep copies of pages you visited for use offline.',
          ]),
        ],
      },
      {
        id: 'why-no-banner',
        heading: 'Why there is no banner',
        blocks: [
          p(
            'The Privacy and Electronic Communications Regulations allow cookies that are strictly necessary for a service you ask for without consent. The one functional cookie is set only by your own action.',
          ),
        ],
      },
      {
        id: 'clearing',
        heading: 'How to clear them',
        blocks: [p("Signing out ends the session cookies. Your browser's settings can remove every cookie and stored item for these addresses at any time.")],
      },
      {
        id: 'changes',
        heading: 'Changes and contact',
        blocks: [p('When this policy changes, the date at the top of the page changes with it.'), p(contact)],
      },
    ],
    missingFacts: read.missing,
  };
}
