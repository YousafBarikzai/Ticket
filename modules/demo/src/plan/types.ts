import type { BusinessCalendar } from '@itsm/business-time';
import type { CanonicalState, Priority } from '@itsm/contracts';
import type { DemoPersonaKey } from '@itsm/contracts/demo';
import type { RichBlock } from '@itsm/contracts/forms';
import type {
  CastRole,
  CategoryKey,
  ChangeKindKey,
  ChangeRisk,
  DemoTicketType,
  FunctionKey,
  HeroKey,
  KnowledgeCategoryKey,
  KnowledgeKey,
  MajorIncidentNumber,
  ProblemNumber,
  RequestItemKey,
  ServiceKey,
  SiteKey,
  SkillKey,
  SubcategoryKey,
  TeamKey,
  TicketChannel,
} from './content-types.js';
import type { TargetType } from './model.js';
import type { Instant } from './time.js';

/**
 * A demo generation's plan: everything the build writes, decided before the
 * first row exists (A4 §3.1 S3).
 *
 * Pure data. Instants are epoch milliseconds (UTC), people are referred to by
 * key (the parts map keys to the ids they create), and nothing in it depends
 * on anything but (seed, T0, scale, history days, generator version), so its
 * SHA-256 (`planHash`) is the same for the same inputs (W8) and goes into the
 * generation ledger.
 *
 * The configuration parts (01–07, WP-56) write `people`, `teams`, `calendars`,
 * `knowledge` and `assets`; the history parts (08–19, WP-57) write the rest.
 * Each `Planned…` type says which part reads it.
 */
export interface DemoPlan {
  readonly version: 1;
  readonly generatorVersion: string;
  readonly seed: number;
  /** T0, floored to the minute. */
  readonly anchor: Instant;
  readonly scale: number;
  readonly historyDays: number;
  /** Day or night mode for the live major incident (A4 §1.9.4). */
  readonly mode: 'day' | 'night';
  /** The history window: `from` is the first planned day's local midnight; `to` is T0. */
  readonly window: { readonly from: Instant; readonly to: Instant; readonly firstDay: string; readonly lastDay: string };
  readonly company: { readonly name: string; readonly emailDomain: string; readonly plan: string };
  readonly calendars: PlannedCalendars;
  readonly teams: readonly PlannedTeam[];
  readonly people: readonly PlannedPerson[];
  readonly tickets: readonly PlannedTicket[];
  /** Ticket-to-ticket links (`importLinks`): problem and major-incident links live on their own objects. */
  readonly links: readonly PlannedTicketLink[];
  readonly approvals: readonly PlannedApproval[];
  readonly surveys: readonly PlannedSurvey[];
  readonly timeEntries: readonly PlannedTimeEntry[];
  readonly knowledge: readonly PlannedArticle[];
  readonly problems: readonly PlannedProblem[];
  readonly changes: readonly PlannedChange[];
  readonly majorIncidents: readonly PlannedMajorIncident[];
  readonly statusPage: PlannedStatusPage;
  readonly aiSamples: readonly PlannedAiSample[];
  readonly notifications: readonly PlannedNotification[];
  readonly assets: PlannedAssets;
  readonly workforce: PlannedWorkforce;
  /** What S10 checks this generation against (V3–V8), derived from the plan. */
  readonly expectations: PlanExpectations;
  readonly totals: PlanTotals;
}

/* ------------------------------------------------------------------ Calendars, teams, people (parts 01–02, 04) */

export interface PlannedCalendars {
  /** `northwind-uk`: every team's calendar and the default SLA policy's. */
  readonly business: { readonly key: string; readonly name: string } & BusinessCalendar;
  /** The bank holidays inside the calendar, for its exceptions list. */
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
}

export interface PlannedTeam {
  readonly key: TeamKey;
  readonly name: string;
  /** Person keys; the lead first. */
  readonly members: readonly string[];
  readonly lead: string;
  readonly calendarKey: string;
}

export interface PlannedPerson {
  /** A cast key (`emma-clarke`), `gen-001` … for generated people, or `monitoring`. */
  readonly key: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly function: FunctionKey;
  readonly site: SiteKey;
  readonly managerKey: string | null;
  readonly roles: readonly CastRole[];
  readonly team?: { readonly key: TeamKey; readonly lead: boolean };
  readonly skills: readonly { readonly key: SkillKey; readonly level: 1 | 2 | 3 }[];
  /** When they joined: `createUser`'s `createdAt` for imported people (A4 §2.3). */
  readonly createdAt: Instant;
  readonly persona?: DemoPersonaKey;
  readonly kind: 'cast' | 'generated' | 'monitoring';
}

/* ------------------------------------------------------------------ Tickets (parts 08, 09, 11, 13) */

/** One step of a ticket's timeline, oldest first (written as `ticket_event`s on import). */
export type PlannedEvent =
  | { readonly kind: 'created'; readonly at: Instant; readonly actor: string | null; readonly channel: TicketChannel }
  | {
      readonly kind: 'assigned';
      readonly at: Instant;
      readonly actor: string | null;
      readonly team: TeamKey;
      readonly assignee: string | null;
      readonly method: 'least_loaded' | 'manual' | 'rule';
    }
  | {
      readonly kind: 'status';
      readonly at: Instant;
      readonly actor: string | null;
      readonly from: CanonicalState;
      readonly to: CanonicalState;
      readonly reason?: string;
    }
  | { readonly kind: 'task.created'; readonly at: Instant; readonly actor: string | null; readonly title: string }
  | { readonly kind: 'task.completed'; readonly at: Instant; readonly actor: string | null; readonly title: string };

export interface PlannedComment {
  readonly at: Instant;
  /** A person key, or `null` for an automated message. */
  readonly author: string | null;
  readonly visibility: 'public' | 'internal';
  readonly body: string;
  /** Agents reply over `api` so no channel chip shows; requesters over the ticket's channel (A4 §1.13.2). */
  readonly channel: TicketChannel | 'api';
}

export interface PlannedTask {
  readonly title: string;
  readonly team: TeamKey;
  readonly assignee: string | null;
  readonly createdAt: Instant;
  readonly completedAt: Instant | null;
}

/** A target's verdict at T0, the way MOD-07's replay will see it. */
export type PlannedVerdict = 'met' | 'breached' | 'running' | 'cancelled';

export interface PlannedTicketSla {
  readonly verdicts: Readonly<Record<TargetType, PlannedVerdict>>;
  /** For a timer still running at T0: when it falls due (V8 keeps these clear of T0 + 10 min). */
  readonly dueAt: Readonly<Partial<Record<TargetType, Instant>>>;
}

export interface PlannedTicket {
  /**
   * The import's `externalRef`, stable for the ticket's whole life:
   * `demo:hero:H1`, `demo:t:<UK date>:<nn>` for history keyed on its calendar
   * day, `demo:o:<overlay>:<nn>` and `demo:mi:<n>:<nn>` for the story's
   * overlays, `demo:fill:<n>` for the queue fill.
   */
  readonly ref: string;
  readonly hero?: HeroKey;
  readonly type: DemoTicketType;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly channel: TicketChannel;
  readonly category: CategoryKey;
  readonly subcategory: SubcategoryKey;
  readonly service: ServiceKey;
  readonly team: TeamKey;
  readonly requester: string;
  /** Who raised it, when not the requester (an agent logging a call). */
  readonly createdBy: string | null;
  /** The assignee at T0. */
  readonly assignee: string | null;
  readonly status: CanonicalState;
  readonly createdAt: Instant;
  readonly resolvedAt: Instant | null;
  readonly closedAt: Instant | null;
  readonly events: readonly PlannedEvent[];
  readonly comments: readonly PlannedComment[];
  readonly tasks: readonly PlannedTask[];
  /** A catalogue submission's item, when it came through the catalogue (part 11). */
  readonly requestItem?: RequestItemKey;
  /** For a `variant` item: whether the approved variant was asked for (performance laptop, paid licence). */
  readonly variant?: 'standard' | 'approved';
  readonly custom: { readonly site?: string; readonly assetTag?: string; readonly affectedUsers?: number };
  readonly sla: PlannedTicketSla;
  /** The major incident it was raised against, if any. */
  readonly majorIncident?: MajorIncidentNumber;
  readonly problem?: ProblemNumber;
}

export interface PlannedTicketLink {
  readonly from: string;
  readonly to: string;
  readonly linkType: 'related_to' | 'duplicate_of' | 'caused_by' | 'parent_of' | 'child_of' | 'blocks' | 'affects';
  readonly at: Instant;
}

/* ------------------------------------------------------------------ Approvals (part 10) */

export interface PlannedApproval {
  /** The ticket (request) it is on, or the change it is on. */
  readonly subject: { readonly kind: 'ticket'; readonly ref: string } | { readonly kind: 'change'; readonly number: number };
  readonly policy: 'manager-approval' | 'cab';
  readonly requestedBy: string;
  readonly approver: string;
  readonly requestedAt: Instant;
  readonly outcome: 'pending' | 'approved' | 'rejected';
  readonly decidedAt: Instant | null;
  readonly comment?: string;
}

/* ------------------------------------------------------------------ Feedback and time (parts 12, 13) */

export interface PlannedSurvey {
  readonly ticketRef: string;
  readonly recipient: string;
  readonly channel: 'portal' | 'email';
  readonly invitedAt: Instant;
  /** `null`: invited, never answered. */
  readonly response: { readonly at: Instant; readonly stars: 1 | 2 | 3 | 4 | 5; readonly comment: string | null } | null;
  /** Unanswered invitations older than the survey window read `expired`. */
  readonly expired: boolean;
}

export interface PlannedTimeEntry {
  readonly ticketRef: string;
  readonly person: string;
  readonly minutes: number;
  readonly loggedAt: Instant;
  readonly note?: string;
}

/* ------------------------------------------------------------------ Knowledge (part 05) */

export interface PlannedArticle {
  readonly key: KnowledgeKey;
  readonly title: string;
  readonly summary: string;
  readonly category: KnowledgeCategoryKey;
  readonly audience: 'all' | 'internal';
  readonly state: 'published' | 'draft' | 'in_review';
  readonly owner: string;
  readonly keywords: readonly string[];
  readonly body: readonly RichBlock[];
  readonly service?: ServiceKey;
  readonly createdAt: Instant;
  readonly publishedAt: Instant | null;
  /** `importUsage` (A4 §2.3). */
  readonly usage: {
    readonly views: number;
    readonly helpful: number;
    readonly notHelpful: number;
    readonly feedback: readonly { readonly helpful: boolean; readonly at: Instant; readonly comment?: string }[];
  };
  /** Tickets it was used to resolve (`linkToTicket`). */
  readonly resolved: readonly { readonly ticketRef: string; readonly at: Instant }[];
}

/* ------------------------------------------------------------------ Problems, changes, major incidents (parts 14, 15, 16) */

export interface PlannedProblem {
  readonly number: ProblemNumber;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly owner: string;
  readonly team: TeamKey;
  readonly service: ServiceKey;
  readonly createdAt: Instant;
  /** Lifecycle steps up to its state at T0. */
  readonly transitions: readonly { readonly to: 'known_error' | 'resolved' | 'closed'; readonly at: Instant }[];
  readonly state: 'investigating' | 'known_error' | 'resolved' | 'closed';
  readonly workaround?: string;
  readonly workaroundArticle?: KnowledgeKey;
  readonly rootCause?: string;
  readonly majorIncident?: MajorIncidentNumber;
  /** Linked tickets, with when they were linked. */
  readonly tickets: readonly { readonly ref: string; readonly at: Instant }[];
}

export interface PlannedChange {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly kind: ChangeKindKey;
  readonly risk: ChangeRisk;
  readonly impact: ChangeRisk;
  readonly team: TeamKey;
  readonly owner: string;
  readonly service: ServiceKey;
  readonly createdAt: Instant;
  /** The planned window; `null` for a draft. */
  readonly window: { readonly start: Instant; readonly end: Instant } | null;
  /** Lifecycle steps up to its state at T0, oldest first. */
  readonly transitions: readonly { readonly to: 'submitted' | 'approved' | 'scheduled' | 'implementing' | 'review' | 'closed'; readonly at: Instant }[];
  readonly state: 'draft' | 'submitted' | 'scheduled' | 'implementing' | 'closed';
  readonly closeCode?: 'successful' | 'successful_with_issues' | 'backed_out' | 'failed';
  readonly maintenanceWindow: boolean;
  /** Inside the month-end blackout: the clash the CAB should see. */
  readonly inBlackout: boolean;
  /** Owes a retrospective approval (the emergency change). */
  readonly retrospective: boolean;
  readonly majorIncident?: MajorIncidentNumber;
  readonly problem?: ProblemNumber;
  readonly implementationPlan?: string;
  readonly backoutPlan?: string;
}

export interface PlannedMajorIncidentUpdate {
  readonly at: Instant;
  readonly kind: 'status' | 'comms' | 'action' | 'observation';
  readonly audience: 'internal' | 'stakeholders' | 'public';
  readonly body: string;
  /** For a status update: the state it moved to. */
  readonly to?: 'identified' | 'mitigating' | 'monitoring' | 'resolved' | 'closed';
  readonly author: string;
}

export interface PlannedMajorIncident {
  readonly number: MajorIncidentNumber;
  readonly title: string;
  readonly severity: 'SEV1' | 'SEV2' | 'SEV3';
  readonly declaredAt: Instant;
  readonly declaredBy: string;
  readonly roles: { readonly commander: string; readonly comms: string; readonly scribe: string };
  readonly services: readonly ServiceKey[];
  readonly customerFacing: boolean;
  readonly bridgeUrl?: string;
  readonly state: 'declared' | 'identified' | 'mitigating' | 'monitoring' | 'resolved' | 'closed';
  readonly updateIntervalMinutes: number;
  readonly nextUpdateDueAt: Instant | null;
  readonly updates: readonly PlannedMajorIncidentUpdate[];
  /** The tickets raised against it. */
  readonly tickets: readonly string[];
  readonly problem?: ProblemNumber;
  /** The post-incident review: draft (MI-0003) or published with actions. */
  readonly review?: {
    readonly state: 'draft' | 'published';
    readonly summary: string;
    readonly savedAt: Instant;
    readonly publishedAt: Instant | null;
    readonly actions: readonly { readonly title: string; readonly owner: string; readonly done: boolean; readonly dueAt: Instant }[];
  };
}

/* ------------------------------------------------------------------ Status page (part 16) */

export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

export interface PlannedStatusPage {
  /** One component per service; the status at T0. */
  readonly components: readonly { readonly service: ServiceKey; readonly status: ComponentStatus }[];
  readonly incidents: readonly {
    readonly majorIncident: MajorIncidentNumber;
    readonly title: string;
    readonly openedAt: Instant;
    readonly resolvedAt: Instant | null;
    readonly components: readonly { readonly service: ServiceKey; readonly status: ComponentStatus }[];
    readonly updates: readonly { readonly at: Instant; readonly status: 'investigating' | 'identified' | 'monitoring' | 'resolved'; readonly body: string }[];
  }[];
  readonly maintenance: readonly {
    readonly changeNumber: number;
    readonly title: string;
    readonly start: Instant;
    readonly end: Instant;
    readonly services: readonly ServiceKey[];
  }[];
}

/* ------------------------------------------------------------------ AI samples and notifications (part 17) */

export interface PlannedAiSample {
  readonly ticketRef: string;
  readonly at: Instant;
  readonly suggestion: { readonly subcategory: SubcategoryKey; readonly team: TeamKey; readonly priority: Priority; readonly summary: string };
  /** What the agent did with it; `untouched` stays a pending suggestion. */
  readonly response: 'accepted' | 'dismissed' | 'untouched';
  readonly respondedAt: Instant | null;
  readonly respondedBy: string | null;
  /** Whether the ticket was later settled (resolved), for the score's `settled` (A4 §1.14). */
  readonly settled: boolean;
}

export interface PlannedNotification {
  readonly recipient: string;
  readonly ticketRef?: string;
  /** What the panel files it under (WP-26's kinds). */
  readonly kind: 'assignment' | 'breach' | 'warning' | 'reply' | 'approval' | 'incident' | 'general';
  readonly subject: string;
  readonly body: string;
  readonly createdAt: Instant;
  readonly readAt: Instant | null;
}

/* ------------------------------------------------------------------ Assets and workforce (parts 06, 07) */

export interface PlannedAssets {
  /** Laptops whose warranty ends within 30 days of T0 (the 23 that light Jordan's row). */
  readonly expiringWarranties: readonly { readonly tag: string; readonly endsOn: string }[];
  /** The asset tag behind `{device}` slots and custom fields. */
  readonly laptopTags: readonly string[];
  /** The Salesforce contract renews 45 days after T0 (A4 §1.6). */
  readonly salesforceRenewal: string;
}

export interface PlannedWorkforce {
  /** Availability at T0 (A4 §1.2), keyed by person. */
  readonly availability: readonly {
    readonly person: string;
    readonly state: 'available' | 'busy' | 'away' | 'on_call';
    readonly until: Instant | null;
  }[];
  /** Who is on call this week. */
  readonly onCall: readonly { readonly rota: 'network-oncall' | 'security-oncall'; readonly person: string; readonly from: Instant; readonly to: Instant }[];
}

/* ------------------------------------------------------------------ What S10 checks */

export interface PlanExpectations {
  /** The live major incident's state at T0: `mitigating` (day) or `monitoring` (night). */
  readonly liveIncidentState: 'mitigating' | 'monitoring';
  /** The pending approvals at T0 (A4 §1.9.5): five, with these approvers. */
  readonly pendingApprovals: readonly { readonly subject: string; readonly approver: string }[];
  /** Every hero's `externalRef`, status and team at T0. */
  readonly heroes: readonly { readonly ref: string; readonly key: HeroKey; readonly status: CanonicalState; readonly team: TeamKey }[];
  /** Laptops whose warranty ends within 30 days. */
  readonly warrantiesWithin30Days: number;
  /** Planned attainment over the 30 days before T0, per target and overall, per cent. */
  readonly attainment30d: Readonly<Record<TargetType | 'overall', number>>;
  /** Planned CSAT score over the 30 days before T0 (0–100). */
  readonly csat30d: number;
  /** Planned shares of the whole history, per cent. */
  readonly channelMix: Readonly<Record<TicketChannel, number>>;
  readonly priorityMix: Readonly<Record<Priority, number>>;
}

export interface PlanTotals {
  readonly tickets: number;
  readonly ticketsLast30Days: number;
  readonly ticketsLast90Days: number;
  readonly openAtT0: number;
  readonly comments: number;
  readonly events: number;
  readonly tasks: number;
  readonly approvals: number;
  readonly submissions: number;
  readonly surveyInvitations: number;
  readonly surveyResponses: number;
  readonly timeEntries: number;
  readonly people: number;
}
