import { AREAS, PRODUCT_NAME } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_RESET, type DemoPersona, type DemoPersonaKey } from '@itsm/contracts/demo';

/**
 * Every sentence of the sign-in chooser and the role pages (SPEC v3 §6.3;
 * A5 §6.3–§6.8), as data.
 *
 * Kept apart from the pages so the honesty rules (A5 §11.6 H1–H3, H7, H8) can
 * scan the copy as strings, and so the chooser and `/try` cannot word the
 * same note two ways. Names, titles and area names are never typed here:
 * they come from `DEMO_PERSONAS` and `AREAS`, the one table every surface
 * reads (D1, D11).
 */

/** The line under a persona card's title: what that person can try first. */
export const PERSONA_TRY_LINE: Readonly<Record<DemoPersonaKey, string>> = Object.freeze({
  employee: 'Raise requests, approve and find answers.',
  agent: 'Work the inbox, the board and a live major incident.',
  admin: 'Set up SLAs, rules, the catalogue and reports.',
});

/** Shown in place of a link whose app origin this deployment lacks (A5 §3.8). */
export const UNAVAILABLE = "This part of the demo isn't available right now.";

/** The three demo notes, one line under the persona cards and on every role page. */
export const DEMO_NOTES: readonly string[] = Object.freeze([
  `Demo data resets every day at ${DEMO_RESET.label}`,
  'Shared with other visitors',
  "Please don't enter real personal data.",
]);

export const CHOOSER = Object.freeze({
  demo: Object.freeze({
    title: 'Explore the demo',
    heading: 'Explore the demo',
    intro: `Choose a role. You'll be signed in to a shared demo for ${DEMO_COMPANY.name}, a fictional company. No sign-up.`,
  }),
  account: Object.freeze({
    title: 'Sign in',
    heading: 'Sign in',
    intro: "Choose where you're going.",
  }),
  /** The work-account section's own heading, used only when it follows the demo. */
  accountHeading: 'Sign in with your work account',
  accountLead: "You'll continue to your organisation's sign-in page. You can switch areas after you sign in.",
  accountHelp: 'No account yet? Ask your IT team to invite you.',
  divider: 'or',
});

export const CONTINUE = Object.freeze({
  title: 'Continue the demo',
  forget: 'Forget',
  forgetLabel: 'Forget the demo I was using',
  line: (persona: DemoPersona) => `Return to the ${AREAS[persona.area].name} as ${persona.name}.`,
});

/** Accessible-name prefixes: the visible card shows the parts, the link's name says what it does. */
export const PERSONA_LINK_PREFIX = 'Explore the demo as';
export const AREA_LINK_PREFIX = 'Sign in to';

export const LEGAL_LINKS: readonly { readonly href: '/privacy' | '/cookies' | '/terms'; readonly label: string }[] = Object.freeze([
  { href: '/privacy', label: 'Privacy' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/terms', label: 'Terms' },
]);

/** The role page `/try/[persona]` (A5 §6.8). */
export const ROLE_PAGE = Object.freeze({
  title: (persona: DemoPersona) => `Explore the ${AREAS[persona.area].name} as ${persona.name}`,
  description: `A one-click demo of ${PRODUCT_NAME} with a fictional company. Demo data resets every night.`,
  heading: (persona: DemoPersona) => `Explore the ${AREAS[persona.area].name}`,
  /** Split around the name, which the page sets in bold. */
  bodyBefore: "You'll be signed in as ",
  bodyAfter: (persona: DemoPersona) => `, ${persona.title} at ${DEMO_COMPANY.name}, a fictional company.`,
  deepLink: (persona: DemoPersona) => `This link opens a specific page in the ${AREAS[persona.area].name}.`,
  primary: 'Open the demo',
  secondary: 'See all roles',
});

/** Every string above with its variables filled for each persona: what the honesty test scans. */
export function rolesCopy(personas: readonly DemoPersona[]): readonly string[] {
  return [
    ...Object.values(PERSONA_TRY_LINE),
    UNAVAILABLE,
    ...DEMO_NOTES,
    CHOOSER.demo.title,
    CHOOSER.demo.intro,
    CHOOSER.account.title,
    CHOOSER.account.intro,
    CHOOSER.accountHeading,
    CHOOSER.accountLead,
    CHOOSER.accountHelp,
    CONTINUE.title,
    CONTINUE.forgetLabel,
    ROLE_PAGE.description,
    ROLE_PAGE.primary,
    ROLE_PAGE.secondary,
    ...personas.flatMap((persona) => [
      CONTINUE.line(persona),
      ROLE_PAGE.title(persona),
      ROLE_PAGE.heading(persona),
      `${ROLE_PAGE.bodyBefore}${persona.name}${ROLE_PAGE.bodyAfter(persona)}`,
      ROLE_PAGE.deepLink(persona),
    ]),
  ];
}
