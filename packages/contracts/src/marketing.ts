/**
 * `@itsm/contracts/marketing` — the words the product says about itself
 * before anyone has signed in (SPEC v3 §6.3; A5 §6.9).
 *
 * One source for the sign-in panel wherever it is drawn: the public site's
 * `/sign-in` and `/try` pages, each app's `/demo`, `/sign-in` and
 * `/signed-out` (all through `SignInLayout`), and the Keycloak theme, whose
 * `loginTitleHtml` is generated from this file (A5 §9.3). Three copies of a
 * pitch drift the first time someone tidies one of them, and a prospect who
 * clicks from the landing page into a sign-in screen notices.
 *
 * Pure and isomorphic, with no imports at all: the panel renders on server
 * pages that ship no JavaScript, and the generator that writes the Keycloak
 * messages runs under plain `tsx`. `__tests__/client-safe.test.ts` keeps it
 * zod-free, and `__tests__/marketing.test.ts` holds the copy to the honesty
 * rules (A5 §11.6): no figures, no percentages, short enough for a panel.
 *
 * Icons are named as strings because this package cannot depend on the
 * design system; `packages/ui`'s `sign-in-layout.test.tsx` checks that each
 * one is an `IconName`.
 */

/** The company behind the product, and the one line that names it (honesty rule H10). */
export const VENDOR = Object.freeze({ name: 'VNE Technologies', line: 'Powered by VNE Technologies' } as const);

/** One point of the panel's pitch: a glyph and a sentence-case line with no full stop. */
export interface SignInPanelPoint {
  /** An `@itsm/ui` `IconName`, drawn in a 36 px tile on the navy panel. */
  readonly icon: string;
  readonly text: string;
}

/** What the navy panel beside a sign-in column says (A5 §6.2). */
export interface SignInPanelCopy {
  /** Under the product name in the lockup: the three areas, in their canonical order. */
  readonly suffix: string;
  /** The pitch, set large. A paragraph, never a heading: the page's own `h1` is in the column. */
  readonly headline: string;
  readonly points: readonly SignInPanelPoint[];
  /** At the foot of the panel: {@link VENDOR}'s line. */
  readonly poweredBy: string;
}

/**
 * The panel every sign-in surface shows. Frozen to the leaves, because every
 * server render shares this one object and a mutation would reach the next
 * visitor's page.
 */
export const SIGN_IN_PANEL: SignInPanelCopy = Object.freeze({
  suffix: 'Help Portal · Service Desk · Administration',
  headline: 'Every request, ticket and change in one place',
  points: Object.freeze([
    Object.freeze({ icon: 'sla', text: 'Live queues and SLA timers for your service desk' }),
    Object.freeze({ icon: 'life-buoy', text: 'A Help Portal for requests, approvals and answers' }),
    Object.freeze({ icon: 'workflow', text: 'Rules, workflows and reports you set up yourself' }),
  ]),
  poweredBy: VENDOR.line,
});
