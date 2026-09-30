import type { ActivityItem } from '@itsm/ui';

/**
 * The Command centre's words: the greeting, the one-line status under it,
 * the first-run checklist, and recent changes as sentences. Pure, so the
 * server page and the tests share it, and nothing here fetches.
 */

/* -------------------------------------------------------------------------
 * Greeting and status line
 * ---------------------------------------------------------------------- */

/** The hour (0–23) at `now` where the person is; UTC when the zone is unknown. */
export function localHour(now: Date, timeZone: string): number {
  const read = (zone: string): number => {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).formatToParts(now);
    return Number(parts.find((part) => part.type === 'hour')?.value ?? now.getUTCHours()) % 24;
  };
  try {
    return read(timeZone);
  } catch {
    return now.getUTCHours();
  }
}

/** "Good morning, Alex" — the first word of the display name; no name, no comma. */
export function greeting(displayName: string | null | undefined, now: Date, timeZone: string): string {
  const hour = localHour(now, timeZone);
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** Nine and under in words, as a sentence starts: "Three". */
export function spelled(count: number): string {
  return WORDS[count] ?? String(count);
}

/**
 * The status after the greeting, from what Needs attention found.
 *
 * Never "nothing needs you" while a check could not run, and nothing at all
 * when this person's permissions let the card consult no source.
 */
export function statusLine(summary: {
  readonly items: readonly { readonly tone: 'danger' | 'warning' | 'info' }[];
  readonly failures: readonly unknown[];
  readonly consulted: number;
}): string | null {
  if (summary.consulted === 0) return null;
  const count = summary.items.length;
  const urgent = summary.items.filter((item) => item.tone === 'danger').length;
  if (count === 0) return summary.failures.length > 0 ? 'Some checks couldn’t run just now.' : 'Nothing needs you right now.';
  if (count === 1) return urgent === 1 ? 'One urgent thing needs you.' : 'One thing needs you.';
  const lead = `${spelled(count)} things need you`;
  if (urgent === 0) return `${lead}.`;
  return urgent === count ? `${lead}, all of them urgent.` : `${lead}, ${spelled(urgent).toLowerCase()} of them urgent.`;
}

/* -------------------------------------------------------------------------
 * First run: "Set up your desk" (spec §9.25)
 * ---------------------------------------------------------------------- */

export type SetupStepId = 'catalogue' | 'service-levels' | 'business-hours' | 'people' | 'email';

export interface SetupStep {
  readonly id: SetupStepId;
  readonly title: string;
  readonly description: string;
  /** Null when this person cannot read whether it is done. */
  readonly done: boolean | null;
  /** Where to do it. Every step shown has one: a step this person cannot do is not shown. */
  readonly href: string;
  readonly action: string;
}

/** What the loader found for each step; `undefined` = not readable by this person. */
export interface SetupFacts {
  readonly services?: number;
  readonly publishedRequestTypes?: number;
  readonly publishedPolicies?: number;
  readonly calendars?: number;
  readonly activePeople?: number;
  /** Whether the email transport is anything but the development default. */
  readonly emailConnected?: boolean;
}

export const SETUP_DISMISS_KEY = 'admin.setup-checklist';

/** The five steps, in the order a new desk does them, each with its state and its page. */
export function setupSteps(facts: SetupFacts, hrefFor: (step: SetupStepId, facts: SetupFacts) => string | undefined): SetupStep[] {
  const known = (value: number | undefined, done: (n: number) => boolean): boolean | null => (value === undefined ? null : done(value));
  const catalogue =
    facts.services === undefined || facts.publishedRequestTypes === undefined ? null : facts.services > 0 && facts.publishedRequestTypes > 0;
  const steps: Omit<SetupStep, 'href'>[] = [
    {
      id: 'catalogue',
      title: 'Add a service and request type',
      description: 'What people can ask for on the portal. One service with one request type is enough to start.',
      done: catalogue,
      action: facts.services === 0 ? 'Add a service' : 'Add a request type',
    },
    {
      id: 'service-levels',
      title: 'Set service levels',
      description: 'Response and resolution targets, so every ticket carries a clock.',
      done: known(facts.publishedPolicies, (n) => n > 0),
      action: 'New policy',
    },
    {
      id: 'business-hours',
      title: 'Add business hours',
      description: 'When the clocks run. Without a calendar, targets count every hour of the day.',
      done: known(facts.calendars, (n) => n > 0),
      action: 'Add hours',
    },
    {
      id: 'people',
      title: 'Invite people',
      description: 'The agents and administrators who work this desk.',
      done: known(facts.activePeople, (n) => n > 1),
      action: 'Add person',
    },
    {
      id: 'email',
      title: 'Connect email',
      description: 'Turn email into tickets, and send replies from your own address.',
      done: facts.emailConnected ?? null,
      action: 'Set up email',
    },
  ];
  // A step is only for someone who can do it: without a page to do it on
  // (the permission to change it, or the page itself) it is left out, done
  // or not — the checklist is homework, and nobody is set homework they
  // cannot do.
  return steps.flatMap((step) => {
    const href = hrefFor(step.id, facts);
    return href ? [{ ...step, href }] : [];
  });
}

/** The checklist shows while a step this person can see is not done; unreadable steps neither count nor block. */
export function setupIncomplete(steps: readonly SetupStep[]): boolean {
  return steps.some((step) => step.done === false);
}

/* -------------------------------------------------------------------------
 * Recent changes as sentences
 * ---------------------------------------------------------------------- */

/**
 * Configuration changes worth a line on the briefing, by action prefix. The
 * audit trail also holds every ticket, sign-in and applied rule; those are
 * the desk working, not the desk being changed, and they live in the Audit log.
 */
const CONFIGURATION = [
  'rule.created',
  'rule.updated',
  'rule.published',
  'rule.archived',
  'rule.rolled_back',
  'sla.policy.',
  'sla.calendar.',
  'sla.matrix.',
  'catalogue.',
  'form.',
  'workflow.',
  'integration.action.',
  'integration.credential.',
  'config.',
  'feature_flag.',
  'module.',
  'role.',
  'webhook.',
  'analytics.',
  'ai.budget.set',
  'ai.prompt.promoted',
  'approval.policy.',
  'user.',
  'team.',
  'organisation.',
  'cmdb.class.',
  'change.template.',
  'pack.',
  'scim.',
] as const;

export function isConfigurationChange(action: string): boolean {
  return CONFIGURATION.some((prefix) => action === prefix || action.startsWith(prefix));
}

/** The thing an action is about, longest prefix first. */
const NOUNS: readonly (readonly [string, string])[] = [
  ['sla.policy.targets', 'SLA targets'],
  ['sla.policy', 'SLA policy'],
  ['sla.calendar', 'business hours calendar'],
  ['sla.matrix', 'priority matrix'],
  ['catalogue.item', 'request type'],
  ['catalogue.service', 'service'],
  ['integration.action', 'integration action'],
  ['integration.credential', 'credential'],
  ['integration.error', 'failed delivery'],
  ['analytics.dashboard', 'dashboard'],
  ['analytics.metric', 'metric'],
  ['analytics.report', 'report'],
  ['analytics.schedule', 'report schedule'],
  ['approval.policy', 'approval policy'],
  ['role.assignment', 'role'],
  ['team.member', 'team member'],
  ['cmdb.class', 'configuration item class'],
  ['change.template', 'change template'],
  ['scim.role_mappings', 'directory role mapping'],
  ['scim.token', 'directory sync token'],
  ['ai.budget', 'AI budget'],
  ['ai.prompt', 'AI prompt'],
  ['feature_flag', 'feature'],
  ['config', 'setting'],
  ['module', 'module'],
  ['webhook', 'webhook'],
  ['workflow', 'workflow'],
  ['rule', 'rule'],
  ['form', 'form'],
  ['role', 'role'],
  ['user', 'person'],
  ['team', 'team'],
  ['organisation', 'organisation'],
  ['pack', 'content pack'],
];

const VERBS: Readonly<Record<string, string>> = {
  created: 'created',
  updated: 'changed',
  changed: 'changed',
  set: 'changed',
  published: 'published',
  archived: 'archived',
  rolled_back: 'restored an earlier version of',
  retired: 'retired',
  deleted: 'deleted',
  granted: 'granted',
  revoked: 'revoked',
  rotated: 'rotated',
  stored: 'added',
  provisioned: 'added',
  added: 'added',
  removed: 'removed',
  deactivated: 'deactivated',
  reactivated: 'reactivated',
  enabled: 'turned on',
  disabled: 'turned off',
  installed: 'installed',
  upgraded: 'upgraded',
  replaced: 'replaced',
  promoted: 'promoted',
  linked: 'linked',
  unlinked: 'unlinked',
};

const PLURAL_NOUNS = new Set(['SLA targets']);

/** An English indefinite article for a noun that follows it. */
function article(noun: string): string {
  return /^(?:[aeiou]|SLA|AI\b)/i.test(noun) && !/^(?:user|uni)/i.test(noun) ? 'an' : 'a';
}

/**
 * An audit action as the predicate of a sentence: `rule.published` →
 * "published a rule", or with the thing's name, "published the rule". The
 * name, when the event carries one, becomes the linked-or-quoted object.
 */
export function describeChange(action: string, name?: string | null): Pick<ActivityItem, 'verb' | 'object'> {
  const parts = action.split('.');
  const verbKey = parts.at(-1) ?? action;
  // A setting is "published" as a new version: to the person reading, it changed.
  const verb = (parts[0] === 'config' && verbKey === 'published' ? 'changed' : VERBS[verbKey]) ?? verbKey.replace(/_/g, ' ');
  const path = parts.slice(0, -1).join('.');
  const noun = NOUNS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}.`))?.[1] ?? (parts[0] ?? 'item').replace(/_/g, ' ');
  if (name && name.trim() !== '') return { verb: `${verb} the ${noun}`, object: { label: name.trim() } };
  // "changed SLA targets", not "changed an SLA targets".
  if (PLURAL_NOUNS.has(noun)) return { verb: `${verb} ${noun}` };
  return { verb: `${verb} ${article(noun)} ${noun}` };
}

/** A human name out of an audit event's before/after snapshot, when it has one. */
export function nameFrom(...snapshots: readonly unknown[]): string | null {
  for (const snapshot of snapshots) {
    if (typeof snapshot !== 'object' || snapshot === null) continue;
    const record = snapshot as Record<string, unknown>;
    for (const field of ['name', 'title', 'displayName', 'label']) {
      const value = record[field];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
  }
  return null;
}
