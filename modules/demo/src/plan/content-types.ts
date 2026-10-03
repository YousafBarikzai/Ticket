import type { CanonicalState, Priority } from '@itsm/contracts';
import type { DemoHeroKey, DemoRole } from '@itsm/contracts/demo';
import type { RichBlock } from '@itsm/contracts/forms';

/**
 * The shapes of the demo's content library (A4 §1.13): the words a person
 * would have written, kept apart from the planner that decides when they were
 * written.
 *
 * The planner (`plan/**`) codes against these types only, and each file under
 * `content/` declares its export with `satisfies` the matching type below, so
 * a story change and a content change can land in separate commits and still
 * fail the type check the moment they disagree (SPEC §15.0 rule 8).
 *
 * Every content module exports exactly one constant, named here:
 *
 * | File                   | Export           | Type                                  |
 * |------------------------|------------------|---------------------------------------|
 * | `content/titles.ts`    | `TITLES`, `SLOTS`| `TitleLibrary`, `SlotBank`            |
 * | `content/replies.ts`   | `REPLIES`        | `ReplyLibrary`                        |
 * | `content/knowledge.ts` | `KNOWLEDGE`      | `readonly KnowledgeArticleContent[]`  |
 * | `content/people.ts`    | `PEOPLE`         | `PeopleLibrary`                       |
 * | `content/holidays.ts`  | `BANK_HOLIDAYS`  | `readonly BankHoliday[]`              |
 * | `content/csat.ts`      | `CSAT_VERBATIMS` | `CsatLibrary`                         |
 * | `content/heroes.ts`    | `HEROES`         | `readonly HeroContent[]`              |
 * | `content/changes.ts`   | `CHANGES`        | `readonly ChangeContent[]`            |
 * | `content/problems.ts`  | `PROBLEMS`       | `readonly ProblemContent[]`           |
 *
 * The key lists below are constants rather than bare unions so the planner can
 * walk them and a content test can check every key is covered. They are the
 * story bible's own names (A4 §1.2–§1.6); a content file never invents a key.
 *
 * Text rules every string here obeys (A4 §1.13, checked by `content.test.ts`
 * and by the build's V10): British English; fictional people only;
 * `northwind.example` addresses only; the company is "Northwind Traders (UK)"
 * exactly; links are `https:` or `mailto:` (D23); and a template uses only the
 * slots its type names, so no `{` or `}` survives into a ticket.
 */

/* ------------------------------------------------------------------ Organisation */

/** The five IT support teams (A4 §1.2). `service-desk` is Alex Morgan's. */
export const TEAM_KEYS = ['service-desk', 'euc', 'network', 'bizapps', 'identity'] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];

/** The four sites, each an organisation under Northwind Traders (UK) (A4 §1.1). */
export const SITE_KEYS = ['london', 'leeds', 'bristol', 'field'] as const;
export type SiteKey = (typeof SITE_KEYS)[number];

/** Functions: there is no job-title column, so a function lives in the story only (A4 §1.1). */
export const FUNCTION_KEYS = [
  'executive',
  'finance',
  'sales',
  'marketing',
  'hr',
  'legal',
  'it',
  'warehouse',
  'transport',
  'facilities',
  'customer-service',
  'quality',
  'field-sales',
] as const;
export type FunctionKey = (typeof FUNCTION_KEYS)[number];

/** Agent skills (A4 §1.2); each agent holds two to five, at levels 1–3. */
export const SKILL_KEYS = [
  'vpn',
  'wifi',
  'windows',
  'macos',
  'intune',
  'exchange',
  'teams',
  'salesforce-admin',
  'sage-intacct',
  'bamboohr',
  'wms',
  'entra-id',
  'phishing-triage',
  'printing',
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** The nine services (A4 §1.3). */
export const SERVICE_KEYS = [
  'microsoft-365',
  'network-vpn',
  'end-user-devices',
  'printing',
  'salesforce',
  'finance-systems',
  'hr-systems',
  'warehouse-wms',
  'identity-access',
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/* ------------------------------------------------------------------ Categories */

/** The seven parent categories (A4 §1.3). */
export const CATEGORY_KEYS = [
  'access-identity',
  'software-m365',
  'hardware',
  'business-apps',
  'network',
  'security',
  'facilities-howto',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** The 26 subcategories, grouped under their parent (A4 §1.3). */
export const SUBCATEGORIES = {
  'access-identity': ['password-sign-in', 'mfa', 'mailbox-drive-access', 'joiners-leavers', 'app-access'],
  'software-m365': ['outlook', 'teams', 'office-apps', 'install-request', 'onedrive-sharepoint'],
  hardware: ['laptop', 'monitor-dock', 'printer', 'mobile'],
  'business-apps': ['salesforce', 'sage-intacct', 'bamboohr', 'wms'],
  network: ['vpn', 'wifi', 'site-connectivity'],
  security: ['phishing', 'suspicious-sign-in', 'lost-stolen-device'],
  'facilities-howto': ['meeting-room-av', 'questions'],
} as const satisfies Readonly<Record<CategoryKey, readonly string[]>>;

export type SubcategoryKey = (typeof SUBCATEGORIES)[CategoryKey][number];

/** Every subcategory key, in the table's order. */
export const SUBCATEGORY_KEYS: readonly SubcategoryKey[] = Object.freeze(
  CATEGORY_KEYS.flatMap((category) => [...SUBCATEGORIES[category]]) as SubcategoryKey[],
);

/** The parent of a subcategory. */
export function categoryOfSubcategory(subcategory: SubcategoryKey): CategoryKey {
  for (const category of CATEGORY_KEYS) {
    if ((SUBCATEGORIES[category] as readonly string[]).includes(subcategory)) return category;
  }
  throw new RangeError(`unknown subcategory "${String(subcategory)}"`);
}

/* ------------------------------------------------------------------ Catalogue and knowledge */

/** The 14 published request items, plus the one draft (A4 §1.4). */
export const REQUEST_ITEM_KEYS = [
  'new-starter',
  'leaver',
  'laptop',
  'desk-equipment',
  'mobile-phone',
  'software-install',
  'shared-mailbox',
  'drive-access',
  'salesforce-licence',
  'vpn-access',
  'mfa-reset',
  'guest-wifi',
  'report-phishing',
  'system-access',
] as const;
export type RequestItemKey = (typeof REQUEST_ITEM_KEYS)[number];

/** The draft item that lights Jordan's "drafts" attention row (A4 §1.4, §1.12). */
export const DRAFT_REQUEST_ITEM_KEY = 'standing-desk';

/** The 24 published articles and the two unpublished ones (A4 §1.5). */
export const KNOWLEDGE_KEYS = [
  'email-on-phone',
  'office-wifi',
  'vpn-from-home',
  'meeting-room-screens',
  'authenticator-new-phone',
  'share-securely',
  'shared-mailbox-howto',
  'out-of-office',
  'outlook-password-prompt',
  'printer-offline',
  'mapped-drive-missing',
  'vpn-authentication-failed',
  'dock-black-screen',
  'teams-camera',
  'onedrive-sync-paused',
  'password-policy',
  'travel-devices',
  'acceptable-use',
  'rb-new-starter',
  'rb-leaver',
  'rb-unlock-account',
  'rb-reset-mfa',
  'rb-month-end',
  'rb-major-incident',
  'ricoh-printers',
  'expenses-sage',
] as const;
export type KnowledgeKey = (typeof KNOWLEDGE_KEYS)[number];

/** The article the live major incident points every caller at (A4 §1.5, §1.9.4). */
export const LIVE_INCIDENT_ARTICLE: KnowledgeKey = 'vpn-authentication-failed';

export const KNOWLEDGE_CATEGORY_KEYS = ['how-to', 'troubleshooting', 'policies', 'runbooks'] as const;
export type KnowledgeCategoryKey = (typeof KNOWLEDGE_CATEGORY_KEYS)[number];

/* ------------------------------------------------------------------ Numbered story objects */

/** `PRB-0411` … `PRB-0418` (A4 §1.9.1). */
export const PROBLEM_NUMBERS = [411, 412, 413, 414, 415, 416, 417, 418] as const;
export type ProblemNumber = (typeof PROBLEM_NUMBERS)[number];

/** `MI-0001` … `MI-0004`; `MI-0004` is live at every T0 (A4 §1.9.3, §1.9.4). */
export const MAJOR_INCIDENT_NUMBERS = [1, 2, 3, 4] as const;
export type MajorIncidentNumber = (typeof MAJOR_INCIDENT_NUMBERS)[number];

/** `CHG-1151` … `CHG-1192`, a fixed list of 42 (A4 §1.9.2). */
export const FIRST_CHANGE_NUMBER = 1151;
export const LAST_CHANGE_NUMBER = 1192;

/* ------------------------------------------------------------------ Shared text types */

/** A local wall-clock time, `HH:MM`, 24-hour. */
export type WallTime = `${number}:${number}`;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * The channels a demo ticket arrives on (A4 §1.11). Never `import`, `api`,
 * `slack` or `whatsapp`: the build's V5 refuses a generation that has any.
 */
export const TICKET_CHANNELS = ['portal', 'email', 'teams', 'voice', 'mobile', 'system'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export type DemoTicketType = 'incident' | 'request' | 'question';

/* ------------------------------------------------------------------ titles.ts */

/**
 * Slots a title or description template may use (A4 §1.13.1). The planner
 * fills `device` (an asset tag in the `NW-LT-0241` style) and `colleague` (a
 * colleague's first name) itself; the others come from `SLOTS`.
 */
export const TICKET_SLOTS = ['device', 'site', 'floor', 'app', 'colleague', 'error', 'since', 'room'] as const;
export type TicketSlot = (typeof TICKET_SLOTS)[number];

/** The slot values the content supplies (`content/titles.ts` `SLOTS`). */
export type SlotBank = Readonly<Record<Exclude<TicketSlot, 'device' | 'colleague'>, readonly string[]>>;

/**
 * One subcategory's words (`content/titles.ts` `TITLES`). Titles and
 * description templates are drawn independently, so every description must
 * read naturally under any title of its subcategory.
 */
export interface SubcategoryText {
  /** At least 12 (A4 §1.13.1). May use `TICKET_SLOTS`. */
  readonly titles: readonly string[];
  /** At least 4 templates, in the terse-e-mail and friendly-portal registers. May use `TICKET_SLOTS`. */
  readonly descriptions: readonly string[];
  /**
   * "Called in: …" write-ups an agent types for a phoned-in ticket; a voice
   * ticket falls back to `descriptions` without them.
   */
  readonly phoned?: readonly string[];
}

export type TitleLibrary = Readonly<Record<SubcategoryKey, SubcategoryText>>;

/* ------------------------------------------------------------------ replies.ts */

/**
 * Reply banks (A4 §1.13.2). A reply may use `{first}` (the requester's first
 * name) and `{agent}` (the replying agent's first name), and nothing else.
 */
export const REPLY_SLOTS = ['first', 'agent'] as const;
export type ReplySlot = (typeof REPLY_SLOTS)[number];

export const REPLY_KINDS = [
  /** The agent's first public answer: an acknowledgement or a first fix to try. */
  'firstResponse',
  /** A progress note that keeps the update promise (F1 cadence). */
  'update',
  /** A question back to the requester; the ticket then waits on them. */
  'clarifying',
  /** The ticket is handed to a supplier and waits on them. */
  'thirdParty',
  'requesterPositive',
  'requesterMoreInfo',
  'requesterFrustrated',
  /** Agent-only notes; never shown to the requester. */
  'internalNote',
  /** The resolution note, written as the ticket is resolved. */
  'resolution',
  /** "We think this is sorted — let us know if it comes back…" */
  'isItFixed',
  /** The requester's reason for reopening. */
  'reopen',
  /** Why a ticket was cancelled ("No longer needed…"). */
  'cancelled',
] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

/** At least three entries per kind. */
export type ReplyLibrary = Readonly<Record<ReplyKind, readonly string[]>> & {
  /**
   * Optional subcategory-specific banks ("Replaced the DisplayPort cable"),
   * preferred over the general ones when present.
   */
  readonly bySubcategory?: Readonly<
    Partial<Record<SubcategoryKey, Readonly<Partial<Record<'firstResponse' | 'update' | 'internalNote' | 'resolution', readonly string[]>>>>>
  >;
};

/* ------------------------------------------------------------------ knowledge.ts */

/** One knowledge article (A4 §1.5): 24 published, one draft, one in review. */
export interface KnowledgeArticleContent {
  readonly key: KnowledgeKey;
  readonly title: string;
  /** One or two sentences, shown under the title in lists and search. */
  readonly summary: string;
  readonly category: KnowledgeCategoryKey;
  /** `all` for everyone; `internal` for the six runbooks. */
  readonly audience: 'all' | 'internal';
  readonly state: 'published' | 'draft' | 'in_review';
  /**
   * Lifetime views at T0; 0 for the unpublished two. The live-incident
   * article reads differently in day and night mode (A4 §1.5).
   */
  readonly views: number | { readonly day: number; readonly night: number };
  /** Share of "helpful" votes, 78–94 for a published article; 0 otherwise. */
  readonly helpfulPercent: number;
  /**
   * How long ago it was first published, in days (spread over nine months).
   * Ignored for the live-incident article, which the planner publishes minutes
   * or hours before T0, and for the unpublished two.
   */
  readonly publishedDaysAgo: number;
  readonly keywords: readonly string[];
  /** Structured blocks, never HTML; links `https:` or `mailto:` only. */
  readonly body: readonly RichBlock[];
  /** The service the article belongs to, when it belongs to one. */
  readonly service?: ServiceKey;
  /** True for the eight articles reused verbatim from the portal's design seed. */
  readonly reused?: boolean;
}

/* ------------------------------------------------------------------ people.ts */

/**
 * Members of the fixed cast the planner refers to by key. The content may add
 * more people to the cast (A4 counts 43), but never fewer, and a key is the
 * person's `first-last` name in lower case.
 */
export const STORY_CAST_KEYS = [
  // Directors (A4 §1.1).
  'victoria-lane',
  'richard-hale',
  'mark-ellison',
  'gareth-pryce',
  'nadia-begum',
  'claire-donovan',
  // The three personas (`DEMO_PERSONAS`).
  'emma-clarke',
  'alex-morgan',
  'jordan-lee',
  // Emma's six reports.
  'marcus-chen',
  'olivia-bennett',
  'ravi-patel',
  'kwame-mensah',
  'lucy-turner',
  'hamza-ali',
  // The other eleven agents (A4 §1.2).
  'priya-shah',
  'tom-fletcher',
  'grace-okafor',
  'ben-carter',
  'sofia-rossi',
  'daniel-hughes',
  'aisha-rahman',
  'liam-walsh',
  'hannah-becker',
  'chloe-nguyen',
  'ryan-webb',
  // Hero requesters outside Emma's team (A4 §1.13.3).
  'elena-kovacs',
  'james-whitfield',
  'fatima-khan',
  'sam-doyle',
  'oliver-grant',
  'megan-price',
  'zara-hussain',
] as const;
export type StoryCastKey = (typeof STORY_CAST_KEYS)[number];

/** The roles a cast member is granted; everyone else is a `requester`. */
export type CastRole = DemoRole;

/** One named person in the story (A4 §1.1, §1.2). */
export interface CastMember {
  /** `first-last`, lower case, hyphenated: `emma-clarke`. */
  readonly key: string;
  readonly firstName: string;
  readonly lastName: string;
  /** `first.last@northwind.example`; the personas' match `DEMO_PERSONAS` exactly. */
  readonly email: string;
  readonly function: FunctionKey;
  readonly site: SiteKey;
  /** The cast member they report to; `null` for the Managing Director only. */
  readonly managerKey: string | null;
  /** A short line of who they are in the story, for presenters; never shown in the product. */
  readonly storyRole?: string;
  /** Roles granted; omitted means `['requester']`. The personas' match `DEMO_PERSONAS` exactly. */
  readonly roles?: readonly CastRole[];
  /** IT agents only: their team, and whether they lead it (A4 §1.2). */
  readonly team?: { readonly key: TeamKey; readonly lead: boolean };
  /** IT agents only: two to five skills at levels 1–3. */
  readonly skills?: readonly { readonly key: SkillKey; readonly level: 1 | 2 | 3 }[];
}

export interface PeopleLibrary {
  /** The fixed cast, at least every `STORY_CAST_KEYS` entry. */
  readonly cast: readonly CastMember[];
  /**
   * Common British first names and surnames for the 205 generated people
   * (A4 §1.13.6): enough of each that 205 unique pairs never collide with the
   * cast. At least 60 of each.
   */
  readonly firstNames: readonly string[];
  readonly surnames: readonly string[];
  /** The requester on `system`-channel alerts (A4 §1.1). */
  readonly monitoring: { readonly firstName: string; readonly lastName: string; readonly email: string };
}

/* ------------------------------------------------------------------ holidays.ts */

/** An England and Wales bank holiday (A4 §1.10.4); `date` is `YYYY-MM-DD` and always a weekday. */
export interface BankHoliday {
  readonly date: string;
  readonly name: string;
}

/* ------------------------------------------------------------------ csat.ts */

/**
 * CSAT comments by tone (A4 §1.13.5), about 80 in all. A comment may use
 * `{agent}` (the resolver's first name) and nothing else.
 */
export type CsatLibrary = Readonly<Record<'positive' | 'neutral' | 'negative', readonly string[]>>;

/* ------------------------------------------------------------------ heroes.ts */

/** Every hero ticket (A4 §1.12, §1.13.3); `DEMO_SD_HEROES` is the subset routed to the Service Desk. */
export const HERO_KEYS = [
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'H7',
  'H8',
  'H9',
  'H10',
  'H11',
  'H12',
  'H13',
  'A1',
  'A2',
  'A3',
  'A4',
  'E1',
  'E2',
  'E3',
  'E4',
] as const;
export type HeroKey = (typeof HERO_KEYS)[number];

type MustHold<T extends true> = T;

/**
 * The heroes routed through `service-desk` (`DEMO_SD_HEROES`). The constraint
 * fails to compile the day the contracts name a hero this list lacks.
 */
export type ServiceDeskHeroKey = MustHold<DemoHeroKey extends HeroKey ? true : false> extends true ? DemoHeroKey : never;

/** The states a hero stands in at T0. */
export type HeroState = Extract<CanonicalState, 'new' | 'in_progress' | 'pending_requester' | 'pending_third_party' | 'pending_approval' | 'resolved'>;

/** One message in a hero's conversation, oldest first. */
export interface HeroMessage {
  /** `requester`, `assignee`, or a cast key (another agent, a manager). */
  readonly author: 'requester' | 'assignee' | string;
  readonly visibility: 'public' | 'internal';
  /** May use `{first}` and `{agent}` like a reply. */
  readonly body: string;
}

/** A fulfilment task on a hero request (H11 has four, two done; E3 has one for `euc`). */
export interface HeroTask {
  readonly title: string;
  readonly team: TeamKey;
  readonly done: boolean;
}

/**
 * A hero ticket's words and facts (A4 §1.13.3). When it happens is the
 * planner's (`plan/heroes.ts`): heroes are re-timed in business time against
 * every T0, so the content carries no instants.
 */
export interface HeroContent {
  readonly key: HeroKey;
  /** The story's short name, e.g. `outlook-password`; presenters use it. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** A cast key. */
  readonly requester: string;
  readonly channel: Exclude<TicketChannel, 'system'>;
  readonly type: DemoTicketType;
  readonly priority: Priority;
  readonly subcategory: SubcategoryKey;
  /** Every `DEMO_SD_HEROES` hero is `service-desk` (R8, X-B2). */
  readonly team: TeamKey;
  /** A cast key, or `null` for an unassigned hero (H8, H9, H10). */
  readonly assignee: string | null;
  /** Who assigned it, when that is part of the story (H5: Priya). A cast key. */
  readonly assignedBy?: string;
  readonly status: HeroState;
  /** A catalogue request's item (E3 `desk-equipment`, H11 `new-starter`, …). */
  readonly requestItem?: RequestItemKey;
  /** The problem it is linked to (H2 → 415, H5 → 412, H7 → 413). */
  readonly problem?: ProblemNumber;
  /** Who decides its approval, when it has one (H4: Mark Ellison; E2: Richard Hale). A cast key. */
  readonly approver?: string;
  readonly tasks?: readonly HeroTask[];
  /** The conversation so far, oldest first; may be empty. */
  readonly thread: readonly HeroMessage[];
  /** For a resolved hero: the note the agent resolved it with. */
  readonly resolutionNote?: string;
  /** H5 and H8 carry a pending sample AI suggestion (A4 §1.14): its one-line summary. */
  readonly aiSuggestion?: string;
  /** Custom fields (A4 §1.3): the asset tag, the site, how many people are affected. */
  readonly custom?: { readonly site?: string; readonly assetTag?: string; readonly affectedUsers?: number };
}

/* ------------------------------------------------------------------ changes.ts */

export type ChangeKindKey = 'standard' | 'normal' | 'emergency';
export type ChangeRisk = 'low' | 'medium' | 'high';

/** Where a change stands at T0 (A4 §1.9.2). `submitted` is awaiting CAB. */
export type ChangeStateAtT0 = 'closed' | 'scheduled' | 'submitted' | 'draft' | 'implementing';

/**
 * When a change happens, relative to T0, in the story's own terms. The
 * planner turns each into instants inside the change windows (weekday
 * evenings 18:00–22:00, Saturdays 08:00–18:00).
 */
export type ChangeWhen =
  /** Closed in the window: `daysBeforeT0` days before T0, at `start` local, for `minutes`. */
  | { readonly kind: 'past'; readonly daysBeforeT0: number; readonly start: WallTime; readonly minutes: number }
  /** Scheduled: the first `weekday` strictly after T0's UK date, plus `weeksAhead` weeks. */
  | { readonly kind: 'week'; readonly weekday: Weekday; readonly weeksAhead: 0 | 1 | 2; readonly start: WallTime; readonly minutes: number }
  /** Planned inside the next month-end blackout, so the clash warning shows (the WMS move). */
  | { readonly kind: 'blackout'; readonly start: WallTime; readonly minutes: number }
  /** The live emergency change (CHG-1192): timed with `MI-0004` by the planner. */
  | { readonly kind: 'live' }
  /** Not scheduled yet (drafts). */
  | { readonly kind: 'unscheduled' };

/** One of the 42 changes (A4 §1.9.2), in number order. */
export interface ChangeContent {
  /** 1151 … 1192. */
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly kind: ChangeKindKey;
  readonly risk: ChangeRisk;
  readonly impact: ChangeRisk;
  readonly team: TeamKey;
  /** The person who raised it and implements it. A cast key. */
  readonly owner: string;
  readonly service: ServiceKey;
  readonly state: ChangeStateAtT0;
  /** Closed changes only: how it ended (one is `backed_out`). */
  readonly closeCode?: 'successful' | 'successful_with_issues' | 'backed_out' | 'failed';
  readonly when: ChangeWhen;
  /** Published as a maintenance window on the status page (the two scheduled this week). */
  readonly maintenanceWindow?: boolean;
  readonly majorIncident?: MajorIncidentNumber;
  readonly problem?: ProblemNumber;
  readonly implementationPlan?: string;
  readonly backoutPlan?: string;
}

/* ------------------------------------------------------------------ problems.ts */

/**
 * Where a problem's linked incidents come from:
 * - `history`: generated incidents of the problem's subcategory, in its window;
 * - `rollout`: the Windows 11 rollout overlay (D−49 … D−36);
 * - `major-incident`: the tickets raised against its major incident;
 * - `early-vpn`: the two VPN authentication incidents of D−9.
 */
export type ProblemLinkSource = 'history' | 'rollout' | 'major-incident' | 'early-vpn';

/** One of the eight problems (A4 §1.9.1). */
export interface ProblemContent {
  readonly number: ProblemNumber;
  readonly title: string;
  readonly description: string;
  readonly state: 'investigating' | 'known_error' | 'resolved' | 'closed';
  readonly priority: Priority;
  /** A cast key. */
  readonly owner: string;
  readonly team: TeamKey;
  readonly service: ServiceKey;
  /** The subcategory its incidents are drawn from. */
  readonly subcategory: SubcategoryKey;
  /** How many generated incidents are linked, and from where; heroes are listed apart. */
  readonly links: readonly { readonly source: ProblemLinkSource; readonly count: number }[];
  /** Heroes linked to it (H2, H5, H7). */
  readonly heroes?: readonly HeroKey[];
  readonly majorIncident?: MajorIncidentNumber;
  readonly workaround?: string;
  readonly workaroundArticle?: KnowledgeKey;
  readonly rootCause?: string;
  /** How long before T0 it was raised, in days. */
  readonly raisedDaysBeforeT0: number;
}

/* ------------------------------------------------------------------ The whole library */

/** The nine content modules together, as `plan/library.ts` assembles them. */
export interface DemoContent {
  readonly titles: TitleLibrary;
  readonly slots: SlotBank;
  readonly replies: ReplyLibrary;
  readonly knowledge: readonly KnowledgeArticleContent[];
  readonly people: PeopleLibrary;
  readonly holidays: readonly BankHoliday[];
  readonly csat: CsatLibrary;
  readonly heroes: readonly HeroContent[];
  readonly changes: readonly ChangeContent[];
  readonly problems: readonly ProblemContent[];
}
