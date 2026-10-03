import type { Priority } from '@itsm/contracts';
import type {
  CategoryKey,
  DemoTicketType,
  RequestItemKey,
  ServiceKey,
  SubcategoryKey,
  TeamKey,
  TicketChannel,
} from './content-types.js';

/**
 * The story's numbers (A4 §1.2–§1.4, §1.10, §1.11): the shape of four months
 * at a speciality-food distributor's service desk. Names here are what the
 * configuration parts create; shares and odds are what the planner draws from.
 * The words people wrote live in `content/`.
 */

/* ------------------------------------------------------------------ Teams and services */

export const TEAM_NAMES: Readonly<Record<TeamKey, string>> = Object.freeze({
  'service-desk': 'Service Desk',
  euc: 'End-User Computing',
  network: 'Network & Infrastructure',
  bizapps: 'Business Applications',
  identity: 'Identity & Security',
});

export interface ServiceModel {
  readonly name: string;
  readonly team: TeamKey;
}

export const SERVICES: Readonly<Record<ServiceKey, ServiceModel>> = Object.freeze({
  'microsoft-365': { name: 'Microsoft 365', team: 'service-desk' },
  'network-vpn': { name: 'Network & VPN', team: 'network' },
  'end-user-devices': { name: 'Laptops, phones & peripherals', team: 'euc' },
  printing: { name: 'Printing', team: 'euc' },
  salesforce: { name: 'Salesforce CRM', team: 'bizapps' },
  'finance-systems': { name: 'Finance (Sage Intacct)', team: 'bizapps' },
  'hr-systems': { name: 'HR (BambooHR)', team: 'bizapps' },
  'warehouse-wms': { name: 'Warehouse management (WMS)', team: 'bizapps' },
  'identity-access': { name: 'Identity & access', team: 'identity' },
});

/* ------------------------------------------------------------------ Categories */

type PriorityMix = Readonly<Record<Priority, number>>;

export interface CategoryModel {
  readonly name: string;
  /** Share of all tickets, per cent. */
  readonly share: number;
  /**
   * Priority mix, per cent. Chosen so the whole history lands on A4 §1.11's
   * P1 2 · P2 10 · P3 48 · P4 40 once the major-incident reports (P2) are in.
   */
  readonly priorities: PriorityMix;
}

export const CATEGORIES: Readonly<Record<CategoryKey, CategoryModel>> = Object.freeze({
  'access-identity': { name: 'Access & identity', share: 22, priorities: { P1: 0, P2: 2, P3: 43, P4: 55 } },
  'software-m365': { name: 'Software & Microsoft 365', share: 20, priorities: { P1: 0, P2: 2, P3: 45, P4: 53 } },
  hardware: { name: 'Hardware', share: 18, priorities: { P1: 0, P2: 3, P3: 48, P4: 49 } },
  'business-apps': { name: 'Business applications', share: 16, priorities: { P1: 3, P2: 16, P3: 65, P4: 16 } },
  network: { name: 'Network', share: 12, priorities: { P1: 7, P2: 18, P3: 58, P4: 17 } },
  security: { name: 'Security', share: 5, priorities: { P1: 6, P2: 20, P3: 62, P4: 12 } },
  'facilities-howto': { name: 'Facilities & how-to', share: 7, priorities: { P1: 0, P2: 0, P3: 19, P4: 81 } },
});

export interface SubcategoryModel {
  readonly name: string;
  readonly category: CategoryKey;
  /** Weight inside its category; a category's weights sum to 100. */
  readonly weight: number;
  readonly team: TeamKey;
  readonly service: ServiceKey;
  /** Ticket type mix, per cent. */
  readonly types: Readonly<Partial<Record<DemoTicketType, number>>>;
  /** The catalogue items a portal request here may come through. */
  readonly items?: readonly RequestItemKey[];
  /** Whether monitoring raises `system` alerts here. */
  readonly monitored?: boolean;
}

export const SUBCATEGORY_MODELS: Readonly<Record<SubcategoryKey, SubcategoryModel>> = Object.freeze({
  'password-sign-in': { name: 'Password and sign-in', category: 'access-identity', weight: 36, team: 'service-desk', service: 'identity-access', types: { incident: 85, request: 15 } },
  mfa: { name: 'MFA', category: 'access-identity', weight: 18, team: 'identity', service: 'identity-access', types: { incident: 60, request: 40 }, items: ['mfa-reset'] },
  'mailbox-drive-access': { name: 'Mailbox or drive access', category: 'access-identity', weight: 23, team: 'service-desk', service: 'identity-access', types: { incident: 10, request: 90 }, items: ['shared-mailbox', 'drive-access'] },
  'joiners-leavers': { name: 'Joiners and leavers', category: 'access-identity', weight: 14, team: 'identity', service: 'identity-access', types: { request: 100 }, items: ['new-starter', 'leaver'] },
  'app-access': { name: 'App access', category: 'access-identity', weight: 9, team: 'identity', service: 'identity-access', types: { request: 100 }, items: ['system-access'] },
  outlook: { name: 'Outlook', category: 'software-m365', weight: 30, team: 'service-desk', service: 'microsoft-365', types: { incident: 90, question: 10 } },
  teams: { name: 'Teams', category: 'software-m365', weight: 25, team: 'service-desk', service: 'microsoft-365', types: { incident: 90, question: 10 } },
  'office-apps': { name: 'Office apps', category: 'software-m365', weight: 15, team: 'service-desk', service: 'microsoft-365', types: { incident: 80, question: 20 } },
  'install-request': { name: 'Install request', category: 'software-m365', weight: 20, team: 'service-desk', service: 'microsoft-365', types: { request: 100 }, items: ['software-install'] },
  'onedrive-sharepoint': { name: 'OneDrive and SharePoint', category: 'software-m365', weight: 10, team: 'service-desk', service: 'microsoft-365', types: { incident: 80, request: 10, question: 10 } },
  laptop: { name: 'Laptop', category: 'hardware', weight: 44, team: 'euc', service: 'end-user-devices', types: { incident: 60, request: 40 }, items: ['laptop'] },
  'monitor-dock': { name: 'Monitor and dock', category: 'hardware', weight: 22, team: 'euc', service: 'end-user-devices', types: { incident: 50, request: 50 }, items: ['desk-equipment'] },
  printer: { name: 'Printer', category: 'hardware', weight: 17, team: 'euc', service: 'printing', types: { incident: 95, question: 5 }, monitored: true },
  mobile: { name: 'Mobile', category: 'hardware', weight: 17, team: 'euc', service: 'end-user-devices', types: { incident: 50, request: 50 }, items: ['mobile-phone'] },
  salesforce: { name: 'Salesforce', category: 'business-apps', weight: 38, team: 'bizapps', service: 'salesforce', types: { incident: 55, request: 40, question: 5 }, items: ['salesforce-licence'] },
  'sage-intacct': { name: 'Sage Intacct', category: 'business-apps', weight: 31, team: 'bizapps', service: 'finance-systems', types: { incident: 80, request: 15, question: 5 }, monitored: true },
  bamboohr: { name: 'BambooHR', category: 'business-apps', weight: 19, team: 'bizapps', service: 'hr-systems', types: { incident: 60, request: 30, question: 10 } },
  wms: { name: 'WMS', category: 'business-apps', weight: 12, team: 'bizapps', service: 'warehouse-wms', types: { incident: 90, request: 10 }, monitored: true },
  vpn: { name: 'VPN', category: 'network', weight: 50, team: 'network', service: 'network-vpn', types: { incident: 80, request: 20 }, items: ['vpn-access'], monitored: true },
  wifi: { name: 'Wi-Fi', category: 'network', weight: 33, team: 'network', service: 'network-vpn', types: { incident: 85, request: 15 }, items: ['guest-wifi'], monitored: true },
  'site-connectivity': { name: 'Site connectivity', category: 'network', weight: 17, team: 'network', service: 'network-vpn', types: { incident: 100 }, monitored: true },
  phishing: { name: 'Phishing report', category: 'security', weight: 60, team: 'identity', service: 'identity-access', types: { incident: 50, request: 50 }, items: ['report-phishing'] },
  'suspicious-sign-in': { name: 'Suspicious sign-in', category: 'security', weight: 20, team: 'identity', service: 'identity-access', types: { incident: 100 }, monitored: true },
  'lost-stolen-device': { name: 'Lost or stolen device', category: 'security', weight: 20, team: 'identity', service: 'identity-access', types: { incident: 100 } },
  'meeting-room-av': { name: 'Meeting-room AV', category: 'facilities-howto', weight: 43, team: 'service-desk', service: 'microsoft-365', types: { incident: 90, question: 10 } },
  questions: { name: 'Questions', category: 'facilities-howto', weight: 57, team: 'service-desk', service: 'microsoft-365', types: { question: 100 } },
});

/* ------------------------------------------------------------------ Catalogue */

export interface RequestItemModel {
  readonly name: string;
  readonly service: ServiceKey;
  /** The team that fulfils it. */
  readonly team: TeamKey;
  /** Line-manager approval: always, never, or only for the paid or performance variant (A4 §1.4). */
  readonly approval: 'always' | 'never' | 'variant';
  /** Joiners and leavers carry four fulfilment tasks. */
  readonly tasks?: readonly { readonly title: string; readonly team: TeamKey }[];
}

export const REQUEST_ITEMS: Readonly<Record<RequestItemKey, RequestItemModel>> = Object.freeze({
  'new-starter': {
    name: 'New starter',
    service: 'identity-access',
    team: 'identity',
    approval: 'never',
    tasks: [
      { title: 'Create the account and mailbox', team: 'identity' },
      { title: 'Assign licences and groups', team: 'identity' },
      { title: 'Prepare and image the laptop', team: 'euc' },
      { title: 'Hand over the laptop and phone', team: 'euc' },
    ],
  },
  leaver: {
    name: 'Leaver',
    service: 'identity-access',
    team: 'identity',
    approval: 'never',
    tasks: [
      { title: 'Disable the account at the end of the last day', team: 'identity' },
      { title: 'Forward email to the named colleague', team: 'identity' },
      { title: 'Remove licences and group memberships', team: 'identity' },
      { title: 'Collect the laptop and phone', team: 'identity' },
    ],
  },
  laptop: { name: 'Laptop (standard or performance)', service: 'end-user-devices', team: 'euc', approval: 'variant' },
  'desk-equipment': { name: 'Monitor or accessories', service: 'end-user-devices', team: 'euc', approval: 'never' },
  'mobile-phone': { name: 'Mobile phone', service: 'end-user-devices', team: 'euc', approval: 'always' },
  'software-install': { name: 'Install software', service: 'microsoft-365', team: 'service-desk', approval: 'variant' },
  'shared-mailbox': { name: 'Access to a shared mailbox', service: 'microsoft-365', team: 'service-desk', approval: 'always' },
  'drive-access': { name: 'SharePoint or shared-drive access', service: 'microsoft-365', team: 'service-desk', approval: 'never' },
  'salesforce-licence': { name: 'Salesforce licence', service: 'salesforce', team: 'bizapps', approval: 'always' },
  'vpn-access': { name: 'VPN access', service: 'network-vpn', team: 'network', approval: 'never' },
  'mfa-reset': { name: 'Reset multi-factor sign-in', service: 'identity-access', team: 'identity', approval: 'never' },
  'guest-wifi': { name: 'Guest Wi-Fi for a visitor', service: 'network-vpn', team: 'service-desk', approval: 'never' },
  'report-phishing': { name: 'Report a suspicious email', service: 'identity-access', team: 'identity', approval: 'never' },
  'system-access': { name: 'Access to another application', service: 'identity-access', team: 'identity', approval: 'always' },
});

/** Share of `variant` items that take the approved variant (performance laptop, paid licence). */
export const APPROVAL_VARIANT_SHARE = 0.35;

/** Share of portal requests with a catalogue item that came through the catalogue form. */
export const CATALOGUE_SHARE = 0.55;

/* ------------------------------------------------------------------ Arrivals (A4 §1.10.1) */

/** Weekday base λ at `DEMO_SCALE = 1`, before the weekday factor and the growth trend. */
export const WEEKDAY_LAMBDA = 18.7;
export const WEEKEND_LAMBDA = 2.5;
export const HOLIDAY_LAMBDA = 2;

export const WEEKDAY_FACTORS: Readonly<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri', number>> = Object.freeze({
  mon: 1.25,
  tue: 1.05,
  wed: 1,
  thu: 0.95,
  fri: 0.8,
});

/** Coefficient of variation of the day-to-day gamma noise. */
export const DAILY_NOISE_CV = 0.12;

/**
 * The trend: a gentle yearly swell of ±5 %, lowest in early June and highest
 * in early December, so the first window (June to October 2026) rises by
 * about 8 % as A4 asks. Keyed on the calendar date rather than on T0, so a
 * day has the same tickets in every build that contains it; and periodic
 * rather than linear, so the demo still looks like itself in 2028.
 */
export const TREND_EPOCH = '2026-06-04';
export const TREND_AMPLITUDE = 0.05;

/** Weekday hour-of-day shares, local time (A4 §1.10.1); 18:00–07:00 is the overnight 2 %. */
export const WEEKDAY_HOURS: readonly { readonly from: number; readonly to: number; readonly share: number }[] = Object.freeze([
  { from: 7, to: 8, share: 3 },
  { from: 8, to: 9, share: 9 },
  { from: 9, to: 10, share: 15 },
  { from: 10, to: 11, share: 14 },
  { from: 11, to: 12, share: 11 },
  { from: 12, to: 13, share: 7 },
  { from: 13, to: 14, share: 9 },
  { from: 14, to: 15, share: 11 },
  { from: 15, to: 16, share: 9 },
  { from: 16, to: 17, share: 7 },
  { from: 17, to: 18, share: 3 },
  { from: 18, to: 31, share: 2 },
]);

/** About how many tickets the days hold at full scale, before the story's own (A4 §1.10.3). */
export const BASE_TICKETS_AT_FULL_SCALE = 1760;

/** The P2 share aimed for: A4 §1.11's 10 %, less the half point the month-end and rollout weeks add on average. */
export const PRIORITY_TARGET_P2 = 0.096;

/* ------------------------------------------------------------------ Channels (A4 §1.11) */

/** The whole history's channel mix, per cent. */
export const CHANNEL_MIX: Readonly<Record<TicketChannel, number>> = Object.freeze({
  portal: 40,
  email: 28,
  teams: 14,
  voice: 9,
  mobile: 4,
  system: 5,
});

/** Nights, weekends and bank holidays: mostly monitoring alerts and e-mail. */
export const OFF_HOURS_CHANNELS: Readonly<Record<TicketChannel, number>> = Object.freeze({
  system: 50,
  email: 35,
  portal: 10,
  mobile: 5,
  teams: 0,
  voice: 0,
});

/** Working hours: what the whole mix leaves once the off-hours tickets (about 7 %) are counted. */
export const WORKING_HOURS_CHANNELS: Readonly<Record<TicketChannel, number>> = Object.freeze({
  portal: 42.3,
  email: 27.5,
  teams: 15.1,
  voice: 9.7,
  mobile: 3.9,
  system: 1.6,
});

/* ------------------------------------------------------------------ Service levels (A4 §1.7, §1.11) */

/** The product's default targets, in business minutes (`modules/sla/src/seed/default-policy.ts`). */
export const SLA_TARGET_MINUTES: Readonly<Record<Priority, { readonly response: number; readonly update: number; readonly resolution: number }>> =
  Object.freeze({
    P1: { response: 15, update: 30, resolution: 240 },
    P2: { response: 60, update: 240, resolution: 480 },
    P3: { response: 240, update: 480, resolution: 1440 },
    P4: { response: 480, update: 1440, resolution: 2400 },
  });

export type TargetType = 'response' | 'update' | 'resolution';
export const TARGET_TYPES: readonly TargetType[] = Object.freeze(['response', 'update', 'resolution'] as const);

/** A4 §1.11's per-priority breach odds; doubled in month-end weeks and the rollout. */
export const BREACH_ODDS: Readonly<Record<Priority, Readonly<Record<TargetType, number>>>> = Object.freeze({
  P1: { response: 0.04, update: 0.15, resolution: 0.08 },
  P2: { response: 0.06, update: 0.18, resolution: 0.14 },
  P3: { response: 0.08, update: 0.2, resolution: 0.16 },
  P4: { response: 0.09, update: 0.22, resolution: 0.18 },
});

/**
 * Per-target scale on the odds above, so the planned 30 days land on A4's
 * 92 / 80 / 84 (85 overall). Two effects pull against each other and are
 * measured, not derived: month-end doubles the odds on three business days in
 * about 21.7, and a ticket bound to breach takes longer, so near T0 more of
 * them are still open — running, and not yet counted. `plan-bands.test.ts`
 * holds the result inside the bands over 40 anchors.
 */
export const BREACH_ODDS_SCALE: Readonly<Record<TargetType, number>> = Object.freeze({ response: 1.02, update: 1.05, resolution: 0.97 });

/** Outcomes of finished tickets (A4 §1.11). */
export const CANCELLED_SHARE = 0.04;
export const REOPENED_SHARE = 0.04;

/** A ticket's wait on someone else, by kind (shares of tickets that have one). */
export const WAIT_SHARES = Object.freeze({ pending_requester: 0.22, pending_third_party: 0.08 });

/* ------------------------------------------------------------------ Feedback (A4 §1.11) */

/** Surveys go to this share of resolved incidents and requests. */
export const SURVEY_INVITE_SHARE = 0.7;
/** Of which this share answers. */
export const SURVEY_RESPONSE_SHARE = 0.3;
/** Invitations by portal (the rest by e-mail). */
export const SURVEY_PORTAL_SHARE = 0.55;

/**
 * Star shares (A4 §1.11): 60/26/9/3/2 averages 4.39; half a point moved from
 * 3★ to 5★ makes it the story's 4.40 (score 85). Dealt out exactly, so the
 * breach penalty decides *who* is unhappy, not how many.
 */
export const STAR_SHARES: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = Object.freeze({ 5: 60.5, 4: 26, 3: 8.5, 2: 3, 1: 2 });
export const BREACH_STAR_PENALTY = 0.45;

/** A4 §1.11's 30-day attainment targets, per cent; the planner steers to within a point of each. */
export const ATTAINMENT_TARGETS: Readonly<Record<TargetType, number>> = Object.freeze({ response: 92, update: 80, resolution: 84 });
