import { AREAS, PRODUCT_NAME, type AreaId } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_COPY, DEMO_PERSONAS, demoEtaPhrase, type DemoPersona, type DemoPersonaKey } from '@itsm/contracts/demo';
import { VENDOR } from '@itsm/contracts/marketing';
import type { IconName } from '@itsm/ui/icons';
import type { ShotId } from './shots.config.js';

/**
 * Every sentence of the landing page (SPEC v3 §6.2, §6.6; A5 §4 as amended by
 * X-M1, X-B2, X-m3, X-m7, X-m24).
 *
 * In one file so the honesty rules (A5 §11.6) can be tested over all of it at
 * once: `content.test.ts` checks the fictional-company sentences, British
 * spelling, copy lengths and that every "Try it" names a real persona and a
 * real shot; `honesty.test.ts` bans claims, figures, superlatives and vendor
 * names. A sentence typed into a component instead would escape both.
 *
 * Names are never typed here. Persona names, titles and role words come from
 * `DEMO_PERSONAS`, area names from `AREAS`, the company from `DEMO_COMPANY`
 * and the vendor from `VENDOR`, so the landing cannot call Alex Morgan by a
 * title the demo does not give him. The only numbers are the reset time and
 * the cooldown, both from the demo's own constants, and the Overview's period
 * names; sample figures live in `hero-sample.ts` and are drawn, never said.
 */

/** A persona from the table, by key: the table is the only place a name is spelt. */
export function persona(key: DemoPersonaKey): DemoPersona {
  const found = DEMO_PERSONAS.find((entry) => entry.key === key);
  if (!found) throw new RangeError(`no demo persona "${key}"`);
  return found;
}

const employee = persona('employee');
const agent = persona('agent');
const admin = persona('admin');

/** "Alex" from "Alex Morgan": the persona chip on a "Try it" says "As Alex · Agent". */
export function firstName(entry: DemoPersona): string {
  return entry.name.split(' ')[0] ?? entry.name;
}

/** "Emma Clarke, Finance Manager": the secondary hero links and their accessible names (V-m3). */
export function nameAndTitle(entry: DemoPersona): string {
  return `${entry.name}, ${entry.title}`;
}

/** The area a persona opens in, by name: "Service Desk". */
export function areaName(entry: DemoPersona): string {
  return AREAS[entry.area as AreaId].name;
}

/** The page's `<title>` and description (A5 §3.12). */
export const META = Object.freeze({
  title: `${PRODUCT_NAME} · Interactive demo`,
  titleOff: PRODUCT_NAME,
  template: `%s · ${PRODUCT_NAME}`,
  description: `Explore ${PRODUCT_NAME} with a fictional company: ask for help in the ${AREAS.portal.name}, work tickets in the ${AREAS.workbench.name} and set it all up in ${AREAS.admin.name}. No sign-up.`,
  descriptionOff: `Give employees one place to ask for help, give your service desk a clear view of every ticket and its SLA, and run it all from one console.`,
});

export const HEADER = Object.freeze({
  /** The lockup's second line. */
  by: `by ${VENDOR.name}`,
  homeLabel: `${PRODUCT_NAME} home`,
  navLabel: 'On this page',
  features: 'Features',
  howItWorks: 'How the demo works',
  signIn: 'Sign in',
  /** After the hero scrolls away: one click into the Service Desk as the agent (X-M1). */
  cta: 'Try the demo',
  ctaLabel: `Try the demo — explore the ${AREAS.workbench.name} as ${agent.name}`,
});

/** A line with a glyph: the hero's reassurance lines. */
export interface IconLine {
  readonly icon: IconName;
  readonly text: string;
}

function line(icon: IconName, text: string): IconLine {
  return Object.freeze({ icon, text });
}

export type DemoPillState = 'ready' | 'preparing' | 'paused';

export const HERO = Object.freeze({
  pill: (state: DemoPillState, etaSec: number | null): string =>
    state === 'preparing'
      ? `Interactive demo · being prepared, ready in ${demoEtaPhrase(etaSec)}`
      : state === 'paused'
        ? 'Interactive demo · paused for maintenance'
        : 'Interactive demo · resets every night',
  titleA: PRODUCT_NAME,
  titleB: 'for every request, ticket and team',
  lead: 'Give employees one place to ask for help, give your service desk a clear view of every ticket and its SLA, and run it all from one console.',
  /** The one-click entry (X-M1): the Service Desk is the product's strongest first screen. */
  primary: 'Explore as an agent',
  personaLine: `You'll be ${agent.name}, ${agent.title}`,
  /** Before the two other personas (V-m3). */
  or: 'or explore as',
  /** The accessible name of a secondary persona link: "Explore as Employee — Emma Clarke, Finance Manager". */
  secondaryLabel: (entry: DemoPersona): string => `Explore as ${entry.button} — ${nameAndTitle(entry)}`,
  signIn: 'Sign in',
  /** DEMO_MODE off: the hero's two buttons. */
  offPrimary: 'Sign in',
  offSecondary: "See what's inside",
  meta: Object.freeze([
    line('history', DEMO_COPY.resetsDaily),
    line('people', 'The demo uses a fictional company and fictional people.'),
  ]),
  metaOff: Object.freeze([line('people', `The preview shows sample data for ${DEMO_COMPANY.name}, a fictional company.`)]),
});

/** The device frame around the live preview (A5 §4.4). */
export const PREVIEW = Object.freeze({
  /** What a screen reader hears for the whole frame: one sentence, not twenty chart labels. */
  label: `A preview of the ${AREAS.workbench.name} overview with sample data: open tickets, work due today, breached tickets, work waiting on others, SLA attainment against its target, and tickets raised and resolved over the last month.`,
  caption: 'Illustrative sample data, not results from a customer.',
  company: DEMO_COMPANY.name,
  sample: DEMO_COPY.sampleData,
  title: 'Overview',
  trendTitle: 'Raised vs resolved',
  slaTitle: 'SLA met',
  navSectionLabel: 'Service Desk navigation',
  /** The user card at the foot of the preview's sidebar. */
  user: agent,
});

export interface TryIt {
  readonly persona: DemoPersonaKey;
  readonly text: string;
  /**
   * A Service Desk route the instruction needs. While it is still pending
   * (`isServiceDeskRoutePending`, RV6) the "Try it" is not shown: the page
   * never asks a visitor to open something that is not in this build (H4).
   */
  readonly needs?: string;
}

export interface Spotlight {
  readonly id: string;
  readonly kicker: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly tryIt: TryIt;
  readonly shot: ShotId;
}

export const EXPLORE = Object.freeze({
  eyebrow: 'What you can explore',
  title: 'A working service desk, ready to explore',
  sub: `The demo runs the real product for ${DEMO_COMPANY.name}, a fictional company: requests, tickets, SLAs, approvals, knowledge and a major incident in progress. Pick a role and change anything.`,
  subOff: `${PRODUCT_NAME} brings requests, tickets, SLAs, approvals and knowledge into one product, from the ${AREAS.portal.name} to ${AREAS.admin.name}.`,
  tryIt: 'Try it',
  /** "As Alex · Agent". */
  asPersona: (entry: DemoPersona): string => `As ${firstName(entry)} · ${entry.button}`,
});

export const SPOTLIGHTS: readonly Spotlight[] = Object.freeze([
  {
    id: 'S1',
    kicker: AREAS.workbench.name,
    icon: 'inbox',
    title: 'Every ticket in one calm inbox',
    body: 'Views for your work, your team and what is due next, with the conversation, SLA timers and the requester beside each ticket. Agents reply, add internal notes and move work on without leaving the list.',
    points: [
      'Saved views with live counts: My work, Unassigned, Due soon and more',
      'Replies, internal notes, links and status changes in one place',
      'SLA timers on every ticket, with what is at risk shown first',
    ],
    tryIt: { persona: 'agent', text: 'Open “Outlook keeps asking for my password” and reply to Marcus.' },
    shot: 'desk-inbox',
  },
  {
    id: 'S2',
    kicker: 'SLAs and the overview',
    icon: 'sla',
    title: 'See service levels before they slip',
    body: `The ${AREAS.workbench.name} overview shows open work, what is due next and how the team is tracking against each SLA target, with trends for the last 7, 30 or 90 days and a written headline for every chart.`,
    points: [
      'Response, update and resolution targets on every ticket',
      'Due-soon and breached work surfaced first',
      'Charts with a headline that says what changed',
    ],
    tryIt: { persona: 'agent', text: 'Open Overview and switch the period to 90 days.' },
    shot: 'sla-overview',
  },
  {
    id: 'S3',
    kicker: AREAS.portal.name,
    icon: 'life-buoy',
    title: 'Help that employees can find for themselves',
    body: 'Employees search for answers, request what they need from the catalogue and follow each request to the end, in plain language. Approvers decide from the same place.',
    points: [
      'A catalogue of requests with forms that ask the right questions',
      'Approvals routed to the right person',
      'Clear updates on every request, from raised to resolved',
    ],
    // X-B2: the request routes to the Service Desk team with no approval, so it lands where Alex can see it.
    tryIt: {
      persona: 'employee',
      text: `Request “SharePoint or shared-drive access”, then switch to the ${AREAS.workbench.name}: it is first in Unassigned.`,
    },
    shot: 'portal-home',
  },
  {
    id: 'S4',
    kicker: 'Major incidents',
    icon: 'siren',
    title: 'Run a major incident from one place',
    body: 'Declare a major incident, name the incident commander and the communications lead, link the affected tickets and post updates for staff and stakeholders. The timeline shows when the next update is due, and a post-incident review closes it.',
    points: [
      'One timeline for updates, decisions and linked tickets',
      'A reminder when the next stakeholder update is due',
      'A post-incident review with actions and owners',
    ],
    tryIt: { persona: 'agent', text: 'Open the live major incident, “VPN sign-in failures for remote staff”, and post an update.', needs: '/major-incidents' },
    shot: 'war-room',
  },
] satisfies Spotlight[]);

export interface FeatureCard {
  readonly id: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly tryIt: TryIt;
  readonly shot: ShotId;
}

export const CARDS: readonly FeatureCard[] = Object.freeze([
  {
    id: 'C1',
    icon: 'columns-3',
    title: 'Board',
    body: 'Drag tickets between stages to see the flow of work at a glance, for the whole desk or for one team.',
    tryIt: { persona: 'agent', text: 'Drag a ticket from New to In progress.', needs: '/board' },
    shot: 'board',
  },
  {
    id: 'C2',
    icon: 'insights',
    title: 'Dashboards',
    body: 'Volume, SLA attainment, satisfaction and workload, with a sentence on each chart that says what changed.',
    tryIt: { persona: 'admin', text: 'Open Insights and compare the last 30 and 90 days.' },
    shot: 'insights',
  },
  {
    id: 'C3',
    icon: 'knowledge',
    title: 'Knowledge',
    body: `Articles that employees find in the ${AREAS.portal.name} and agents share from a ticket, with one search across both.`,
    tryIt: { persona: 'employee', text: `Search the ${AREAS.portal.name} for “VPN”.` },
    shot: 'knowledge',
  },
  {
    id: 'C4',
    icon: 'ai',
    title: 'AI triage, with sample decisions',
    body: 'Suggested type, category, team and priority for new tickets, with the reasons shown. Agents accept or change each suggestion. In the demo the suggestions are labelled samples and nothing is sent to an AI provider.',
    tryIt: { persona: 'agent', text: 'Open “Laptop won’t wake from sleep when docked” and review the suggested triage.' },
    shot: 'ai-triage',
  },
  {
    id: 'C5',
    icon: 'workflow',
    title: 'Rules and workflows',
    body: 'Route, escalate and notify with rules you can test before you publish them, and workflows for requests that take several steps.',
    tryIt: { persona: 'admin', text: 'Open a rule and press Try it.' },
    shot: 'rules',
  },
  {
    id: 'C6',
    icon: 'settings-2',
    title: AREAS.admin.name,
    // X-m7: the console opens on a service-health summary, not the retired briefing.
    body: 'Teams, SLAs, the catalogue, rules and reports in one console that opens on a service-health summary and what needs attention.',
    tryIt: { persona: 'admin', text: 'Open the Command centre and work through Needs attention.' },
    shot: 'command-centre',
  },
] satisfies FeatureCard[]);

export interface HowStep {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

export const HOW = Object.freeze({
  eyebrow: 'Before you start',
  title: 'How the demo works',
  sub: 'A shared copy of the real product, with a fictional company. Explore freely: it starts again every night.',
  steps: Object.freeze([
    {
      icon: 'log-in',
      title: 'Pick a role',
      body: `${employee.button}, ${agent.button} or ${admin.button}. One click signs you in as ${employee.name}, ${agent.name} or ${admin.name}. No sign-up.`,
    },
    {
      icon: 'pencil',
      title: 'Change anything',
      body: 'Raise requests, reply to tickets, approve, publish an article or edit a rule. It works as the product does.',
    },
    {
      icon: 'chevrons-up-down',
      title: 'Move between areas',
      body: `Use the area switcher to go between the ${AREAS.portal.name}, the ${AREAS.workbench.name} and ${AREAS.admin.name}. Each area opens as its own persona.`,
    },
    {
      icon: 'people',
      title: 'Shared with other visitors',
      body: "Your changes are visible to other visitors until the next reset, and you'll see theirs. Please don't enter real personal or confidential data.",
    },
    {
      icon: 'history',
      title: 'Back to the start every night',
      body: `${DEMO_COPY.resetsDaily} Anyone in the demo can reset it sooner; after any reset it can't be reset again for 30 minutes.`,
    },
  ] satisfies HowStep[]),
  note: 'Anything that would send email, connect to other systems or change sign-in and security settings is switched off in the demo and marked with a lock. AI suggestions in the demo are pre-written samples.',
});

export const FINAL = Object.freeze({
  title: 'Open the demo as an employee, an agent or an admin',
  sub: "No sign-up and nothing to install. Pick a role and you're in.",
  /** Visually hidden before each role button, so its name is a sentence. */
  rolePrefix: 'Explore the demo as',
  /** "Finance Manager · Help Portal". */
  roleLine: (entry: DemoPersona): string => `${entry.title} · ${areaName(entry)}`,
  already: 'Already have an account?',
  signIn: 'Sign in',
  titleOff: `Sign in to ${PRODUCT_NAME}`,
  subOff: 'Choose where you work. You can switch areas after you sign in.',
  ctaOff: 'Sign in',
});

export const FOOTER = Object.freeze({
  name: PRODUCT_NAME,
  by: `by ${VENDOR.name}`,
  copyright: (year: number): string => `© ${year} ${VENDOR.name}. A public demo with fictional data.`,
  copyrightOff: (year: number): string => `© ${year} ${VENDOR.name}.`,
  navLabel: 'Legal',
  links: Object.freeze([
    Object.freeze({ href: '/privacy', label: 'Privacy' }),
    Object.freeze({ href: '/cookies', label: 'Cookies' }),
    Object.freeze({ href: '/terms', label: 'Terms' }),
    Object.freeze({ href: '/sign-in', label: 'Sign in' }),
  ]),
  cookies: 'We only use essential cookies.',
  fineprint: Object.freeze([
    `${DEMO_COMPANY.name} and everyone in the demo are fictional. Any resemblance to real people or organisations is coincidental.`,
    'Microsoft 365, Salesforce, Sage, BambooHR and other product names appear in fictional tickets and belong to their owners. Their use does not imply any affiliation with or endorsement by them.',
    `${VENDOR.line}.`,
  ]),
});

/** What a link whose origin this deployment lacks says instead (A5 §3.8). */
export const UNAVAILABLE = "This part of the demo isn't available right now.";

/**
 * Alt text for each screenshot, by shot id (A5 §5.1). Each says "in the demo"
 * and none counts anything, because the counts move by a few per cent a day.
 */
export const SHOT_ALT: Readonly<Record<ShotId, string>> = Object.freeze({
  'desk-inbox': `The ${AREAS.workbench.name} inbox in the demo: a list of tickets with SLA timers, and a ticket about Outlook password prompts open beside it with the conversation and an internal note.`,
  'sla-overview': `The ${AREAS.workbench.name} overview in the demo: open work, tickets due soon, SLA attainment against target and a chart of tickets raised and resolved.`,
  'portal-home': `The ${AREAS.portal.name} home in the demo: a search box, popular requests from the catalogue and the employee's open requests with their progress.`,
  'war-room': 'A live major incident in the demo: the incident commander and communications lead, linked tickets, and a timeline showing when the next update is due.',
  board: `The ${AREAS.workbench.name} board in the demo: tickets in columns from New to Resolved, each with its priority and SLA timer.`,
  insights: 'An Insights dashboard in the demo: ticket volume, SLA attainment and satisfaction charts, each with a written headline.',
  knowledge: `Knowledge search in the ${AREAS.portal.name} in the demo: articles about connecting to the VPN.`,
  'ai-triage': 'A ticket in the demo with a suggested category, team and priority, each with its reason, labelled as a sample decision.',
  rules: 'A routing rule in the demo with its Try it panel showing which tickets it would match.',
  'command-centre': `The ${AREAS.admin.name} command centre in the demo: a service-health summary and what needs attention, with desk health and volume below it.`,
});

/**
 * Every string the landing can say, with each wording function called for
 * every case it has: what `content.test.ts` and `honesty.test.ts` hold to the
 * rules, kept beside the copy so a new export cannot be missed by them.
 */
export function landingCopy(): string[] {
  const strings: string[] = [];
  // Keys that hold identifiers rather than words.
  const skip = new Set(['id', 'icon', 'shot', 'persona', 'needs', 'href']);
  const walk = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) if (!skip.has(key)) walk(inner);
  };
  walk([META, HEADER, EXPLORE, SPOTLIGHTS, CARDS, HOW, FINAL, FOOTER, SHOT_ALT, UNAVAILABLE]);
  walk({ ...PREVIEW, user: undefined });
  walk({ ...HERO, pill: undefined, secondaryLabel: undefined });
  for (const state of ['ready', 'preparing', 'paused'] as const) strings.push(HERO.pill(state, null), HERO.pill(state, 240));
  for (const persona of DEMO_PERSONAS) strings.push(HERO.secondaryLabel(persona), EXPLORE.asPersona(persona), FINAL.roleLine(persona));
  strings.push(FOOTER.copyright(2026), FOOTER.copyrightOff(2026));
  return strings;
}
