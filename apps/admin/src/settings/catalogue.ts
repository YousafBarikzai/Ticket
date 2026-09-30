import type { SettingType } from '@itsm/sdk';
import type { ConfirmSpec } from '@itsm/ui';

/**
 * The settings catalogue: what each setting and feature flag is called in
 * words, where it lives in Settings, and how it is edited (SPEC §6.1
 * Settings, X-11, MOD-13-E1-S1).
 *
 * The API says *what kind* of value a setting takes (`type`, A2) and the
 * modules say what it does (`description`); neither says what an
 * administrator should read on the row, which section it belongs to, or that
 * "7" means seven days. That is this file — labels and arrangement only, so a
 * setting a module adds later still shows up (under its module's section,
 * with a label made from its key) and is edited by its type.
 *
 * A pure module with no React and no fetches: the server pages, the client
 * views and the tests all read it.
 */

/* =========================================================================
 * Sections
 * ====================================================================== */

export type SettingGroupId =
  | 'tickets'
  | 'approvals'
  | 'knowledge'
  | 'notifications'
  | 'sign-in'
  | 'email-chat'
  | 'assets'
  | 'change'
  | 'incidents'
  | 'problems'
  | 'rules'
  | 'workflows'
  | 'workload'
  | 'ai'
  | 'other';

export interface SettingGroup {
  readonly id: SettingGroupId;
  readonly title: string;
}

/** General's sections, in the SPEC's order. AI settings live on the AI tab. */
export const GENERAL_GROUPS: readonly SettingGroup[] = [
  { id: 'tickets', title: 'Tickets' },
  { id: 'approvals', title: 'Approvals' },
  { id: 'knowledge', title: 'Knowledge' },
  { id: 'notifications', title: 'Notifications' },
  { id: 'sign-in', title: 'Sign-in & sessions' },
  { id: 'email-chat', title: 'Email & chat' },
  { id: 'assets', title: 'Assets & contracts' },
  { id: 'change', title: 'Change' },
  { id: 'incidents', title: 'Incidents' },
  { id: 'problems', title: 'Problems' },
  { id: 'rules', title: 'Rules' },
  { id: 'workflows', title: 'Workflows' },
  { id: 'workload', title: 'Workload' },
  { id: 'other', title: 'Other settings' },
];

/** Which section a key the catalogue does not know goes in, by the first part of its key. */
const PREFIX_GROUPS: Readonly<Record<string, SettingGroupId>> = {
  ticket: 'tickets',
  approval: 'approvals',
  knowledge: 'knowledge',
  notification: 'notifications',
  auth: 'sign-in',
  channel: 'email-chat',
  cmdb: 'assets',
  assets: 'assets',
  contracts: 'assets',
  change: 'change',
  incident: 'incidents',
  problem: 'problems',
  rules: 'rules',
  workflow: 'workflows',
  workload: 'workload',
  ai: 'ai',
};

/* =========================================================================
 * Settings
 * ====================================================================== */

export interface Unit {
  readonly one: string;
  readonly other: string;
}

const DAYS: Unit = { one: 'day', other: 'days' };
const HOURS: Unit = { one: 'hour', other: 'hours' };
const MINUTES: Unit = { one: 'minute', other: 'minutes' };

export interface SettingEntry {
  readonly label: string;
  /** Said instead of the module's own description, where that is written for engineers ("OD-03"). */
  readonly description?: string;
  readonly group: SettingGroupId;
  /** Words after a number: "7 days". */
  readonly unit?: Unit;
  /**
   * How it is edited, where the type alone would choose worse: a duration
   * field for minutes, a percentage for a 0–1 confidence, a select for a free
   * string with known values.
   */
  readonly control?: 'segmented' | 'select' | 'duration' | 'percent';
  /** Value → words, for an enum or a string with known values. */
  readonly options?: Readonly<Record<string, string>>;
  /** Asked before the switch changes (a boolean that stops something for everyone). */
  readonly confirm?: { readonly on?: ConfirmSpec; readonly off?: ConfirmSpec };
  /** Labels for the parts of a structured value (`{ SEV1: 30, … }`). */
  readonly fields?: Readonly<Record<string, string>>;
  /** Set elsewhere, where it is explained: the row shows the value and links there. */
  readonly managedAt?: { readonly href: string; readonly label: string };
}

export const SETTINGS: Readonly<Record<string, SettingEntry>> = {
  // Tickets
  'ticket.defaultPriority': {
    label: 'Default priority',
    group: 'tickets',
    control: 'segmented',
    options: { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' },
  },
  'ticket.autoClose.days': { label: 'Close resolved tickets after', group: 'tickets', unit: DAYS },
  'ticket.reopen.windowDays': { label: 'Requesters may reopen for', group: 'tickets', unit: DAYS },
  // Approvals
  'approval.reminder.hours': { label: 'Remind approvers after', group: 'approvals', unit: HOURS },
  // Knowledge
  'knowledge.requireApprovalToPublish': { label: 'Approve articles before they’re published', group: 'knowledge' },
  'knowledge.reviewIntervalDays': { label: 'Review articles every', group: 'knowledge', unit: DAYS },
  // Notifications
  'notification.email.enabled': {
    label: 'Email notifications',
    group: 'notifications',
    confirm: {
      off: {
        title: 'Stop sending email notifications?',
        body: 'Nobody on this desk is emailed about their tickets, approvals or assignments until this is turned back on. Notifications inside the apps carry on.',
        confirmLabel: 'Stop emails',
        tone: 'danger',
      },
    },
  },
  // Sign-in & sessions
  'auth.session.idleMinutes': { label: 'Sign people out after inactivity', group: 'sign-in', control: 'duration' },
  'auth.session.absoluteHours': { label: 'Longest a session lasts', group: 'sign-in', unit: HOURS },
  'auth.requiredAcr': { label: 'Required sign-in strength', group: 'sign-in' },
  // Email & chat
  'channel.email.transport': {
    label: 'Email provider',
    description: 'Which provider this desk sends and receives email through.',
    group: 'email-chat',
    control: 'select',
    options: { development: 'Development — nothing is delivered', postmark: 'Postmark', 'microsoft-graph': 'Microsoft Graph' },
  },
  'channel.email.maxPerSenderPerHour': { label: 'Emails one sender may send an hour', group: 'email-chat', unit: { one: 'email', other: 'emails' } },
  'channel.chat.maxBytes': { label: 'Largest chat message', group: 'email-chat', unit: { one: 'byte', other: 'bytes' } },
  // Assets & contracts
  'assets.warrantyWarningDays': { label: 'Warn about warranties ending within', group: 'assets', unit: DAYS },
  'contracts.noticeWarningDays': { label: 'Warn before a contract’s notice date', group: 'assets', unit: DAYS },
  'cmdb.impactDepth': { label: 'Impact analysis looks this far', group: 'assets', unit: { one: 'hop', other: 'hops' } },
  // Change
  'change.retrospectiveDueHours': { label: 'Emergency change approval due within', group: 'change', unit: HOURS },
  // Incidents
  'incident.updateIntervalMinutes': {
    label: 'Major incident updates every',
    group: 'incidents',
    unit: MINUTES,
    fields: { SEV1: 'Severity 1', SEV2: 'Severity 2', SEV3: 'Severity 3' },
  },
  'incident.reviewDueDays': { label: 'Post-incident review due within', group: 'incidents', unit: { one: 'working day', other: 'working days' } },
  // Problems
  'problem.recurrenceThreshold': {
    label: 'Suggest a problem after',
    group: 'problems',
    fields: { tickets: 'Tickets in one category', withinDays: 'Within (days)' },
  },
  // Rules
  'rules.test.sampleSize': { label: 'Tickets a rule test replays', group: 'rules', unit: { one: 'ticket', other: 'tickets' } },
  // Workflows
  'workflow.maxActiveRuns': { label: 'Warn when runs in progress pass', group: 'workflows', unit: { one: 'run', other: 'runs' } },
  // Workload
  'workload.defaultStrategy': {
    label: 'How work is shared out',
    group: 'workload',
    control: 'select',
    options: { least_loaded: 'Least loaded first', round_robin: 'Round robin', skill: 'By skill' },
  },
  'workload.defaultCapacity': { label: 'Open tickets one agent holds', group: 'workload', unit: { one: 'ticket', other: 'tickets' } },
  // AI (the AI tab)
  'ai.tone': { label: 'Reply tone', group: 'ai', control: 'segmented', options: { plain: 'Plain', formal: 'Formal', friendly: 'Friendly' } },
  'ai.language': { label: 'Reply language', group: 'ai' },
  'ai.retainDays': { label: 'Keep prompts and answers for', group: 'ai', unit: DAYS },
  'ai.decision.triage.mode': {
    label: 'Triage mode',
    group: 'ai',
    options: { off: 'Off', shadow: 'Shadow', suggest: 'Suggest', auto: 'Auto' },
    managedAt: { href: '/ai-triage', label: 'AI triage' },
  },
  'ai.decision.suggestThreshold': { label: 'Suggest answers from', group: 'ai', control: 'percent' },
  'ai.decision.autoThreshold': { label: 'Apply answers automatically from', group: 'ai', control: 'percent' },
};

/** "maxActiveRuns" → "Max active runs": a readable label for a key nobody has named yet. */
export function labelFromKey(key: string): string {
  const last = key.split('.').at(-1) ?? key;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function settingEntry(key: string): SettingEntry {
  const known = SETTINGS[key];
  if (known) return known;
  const prefix = key.split('.')[0] ?? '';
  return { label: labelFromKey(key), group: PREFIX_GROUPS[prefix] ?? 'other' };
}

/* =========================================================================
 * Controls
 * ====================================================================== */

/**
 * How a setting is edited, from its type and the catalogue. `readonly`
 * covers structured values the page cannot draw a form for and anything the
 * API describes as `json` — shown as JSON, changed through the API (ADR-0049:
 * no JSON text box).
 */
export type ControlKind = 'switch' | 'segmented' | 'select' | 'number' | 'percent' | 'duration' | 'text' | 'fields' | 'readonly';

/** The parts of an object or fixed-key record whose every part is a whole number: a small group of number fields. */
export function numberParts(type: SettingType): readonly { readonly key: string; readonly type: Extract<SettingType, { kind: 'number' }> }[] | null {
  if (type.kind === 'object') {
    const parts = Object.entries(type.fields);
    if (parts.length === 0 || parts.some(([, part]) => part.kind !== 'number')) return null;
    return parts.map(([key, part]) => ({ key, type: part as Extract<SettingType, { kind: 'number' }> }));
  }
  if (type.kind === 'record' && type.keys && type.keys.length > 0 && type.value.kind === 'number') {
    const value = type.value;
    return type.keys.map((key) => ({ key, type: value }));
  }
  return null;
}

export function controlFor(key: string, type: SettingType): ControlKind {
  const entry = settingEntry(key);
  switch (type.kind) {
    case 'boolean':
      return 'switch';
    case 'enum':
      if (entry.control === 'select') return 'select';
      // Four short choices fit a segmented control; more read better as a list.
      return entry.control === 'segmented' || (type.options.length <= 4 && type.options.every((option) => (entry.options?.[option] ?? option).length <= 12))
        ? 'segmented'
        : 'select';
    case 'number':
      if (entry.control === 'percent') return 'percent';
      if (entry.control === 'duration' && type.int) return 'duration';
      return 'number';
    case 'string':
      return entry.control === 'select' && entry.options ? 'select' : 'text';
    case 'object':
    case 'record':
      return numberParts(type) ? 'fields' : 'readonly';
    default:
      return 'readonly';
  }
}

/** The choices of a select or segmented control: the type's options, or the catalogue's for a string, plus the current value if it is neither. */
export function choicesFor(key: string, type: SettingType, current: unknown): { readonly value: string; readonly label: string }[] {
  const entry = settingEntry(key);
  const values = type.kind === 'enum' ? [...type.options] : Object.keys(entry.options ?? {});
  if (typeof current === 'string' && current !== '' && !values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: entry.options?.[value] ?? humanise(value) }));
}

function humanise(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* =========================================================================
 * Values in words
 * ====================================================================== */

function unitWords(n: number, unit: Unit | undefined): string {
  if (!unit) return String(n);
  return `${n} ${n === 1 ? unit.one : unit.other}`;
}

/** Minutes in words without the design system: "1 hour", "90 minutes" → "1 h 30 min". */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return unitWords(rest, MINUTES);
  if (rest === 0) return unitWords(hours, HOURS);
  return `${hours} h ${rest} min`;
}

/**
 * A setting's value in words, for the search, the history and the
 * confirmation texts: "7 days", "On", "Least loaded first", "Severity 1: 30
 * minutes · …". An empty string reads "Not set".
 */
export function valueText(key: string, type: SettingType | undefined, value: unknown): string {
  const entry = settingEntry(key);
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') {
    if (entry.control === 'percent') return `${Math.round(value * 100)}%`;
    if (entry.control === 'duration') return minutesText(value);
    return unitWords(value, entry.unit);
  }
  if (typeof value === 'string') return entry.options?.[value] ?? value;
  if (type && typeof value === 'object') {
    const parts = numberParts(type);
    if (parts) {
      const record = value as Record<string, unknown>;
      return parts
        .map((part) => `${entry.fields?.[part.key] ?? humanise(part.key)}: ${typeof record[part.key] === 'number' ? unitWords(record[part.key] as number, entry.unit) : '—'}`)
        .join(' · ');
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Stable JSON: two values with the same members in another key order are the same value. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/**
 * "Changed from default": the value differs from the module's default. Not
 * "has a stored version" — a setting put back to its default by hand is not
 * changed, and saying so would send someone looking for a difference that
 * is not there.
 */
export function isChanged(value: unknown, defaultValue: unknown): boolean {
  return !sameValue(value, defaultValue);
}

/* =========================================================================
 * Validation (the same rules the API's schema applies, said in words)
 * ====================================================================== */

/** Why a number would be refused, or null. `value` is in the setting's own units (0–1 for a percentage). */
export function numberProblem(type: SettingType, value: number | null): string | null {
  if (type.kind !== 'number') return null;
  if (value === null || !Number.isFinite(value)) return 'Enter a number.';
  if (type.int && !Number.isInteger(value)) return 'Enter a whole number.';
  if (type.min !== undefined && (type.minExclusive ? value <= type.min : value < type.min)) {
    return type.minExclusive ? `Enter more than ${type.min}.` : `Enter ${type.min} or more.`;
  }
  if (type.max !== undefined && (type.maxExclusive ? value >= type.max : value > type.max)) {
    return type.maxExclusive ? `Enter less than ${type.max}.` : `Enter ${type.max} or less.`;
  }
  return null;
}

/** The same, for a percentage field showing 0–100 over a 0–1 setting. */
export function percentProblem(type: SettingType, percent: number | null): string | null {
  if (type.kind !== 'number') return null;
  if (percent === null || !Number.isFinite(percent)) return 'Enter a percentage.';
  const value = percent / 100;
  if (type.min !== undefined && (type.minExclusive ? value <= type.min : value < type.min)) {
    return type.minExclusive ? `Enter more than ${Math.round(type.min * 100)}%.` : `Enter ${Math.round(type.min * 100)}% or more.`;
  }
  if (type.max !== undefined && (type.maxExclusive ? value >= type.max : value > type.max)) {
    return type.maxExclusive ? `Enter less than ${Math.round(type.max * 100)}%.` : `Enter ${Math.round(type.max * 100)}% or less.`;
  }
  return null;
}

export function textProblem(type: SettingType, value: string): string | null {
  if (type.kind !== 'string') return null;
  if (type.min !== undefined && value.length < type.min) return type.min === 1 ? 'Enter a value.' : `Enter at least ${type.min} characters.`;
  if (type.max !== undefined && value.length > type.max) return `Enter ${type.max} characters or fewer.`;
  return null;
}

/* =========================================================================
 * Feature flags
 * ====================================================================== */

export type FlagGroupId = 'ai' | 'rules' | 'tickets' | 'other';

export const FLAG_GROUPS: readonly { readonly id: FlagGroupId; readonly title: string }[] = [
  { id: 'ai', title: 'AI' },
  { id: 'rules', title: 'Rules' },
  { id: 'tickets', title: 'Tickets' },
  { id: 'other', title: 'Other features' },
];

export interface FlagEntry {
  readonly label: string;
  /** Said instead of the module's own description, where that is written for engineers. */
  readonly description?: string;
  readonly group: FlagGroupId;
  /**
   * A kill switch: turning it off stops something for everyone at once, so
   * it asks first ("Turn off AI for everyone?") and says what stops.
   */
  readonly kill?: ConfirmSpec;
  /** What turning it off means, said under the switch. */
  readonly offMeans?: string;
  /** Changed on another page, which explains it; the switch here is read-only and links there. */
  readonly managedAt?: { readonly href: string; readonly label: string };
}

export const AI_FLAG = 'ai.enabled';
export const AI_CAPABILITIES = ['ai.capability.reply-draft', 'ai.capability.ticket-summary', 'ai.capability.article-draft', 'ai.capability.similar-work'] as const;

export const FLAGS: Readonly<Record<string, FlagEntry>> = {
  'ai.enabled': {
    label: 'AI for this workspace',
    description: 'The switch for every AI feature at once. Off refuses them all, for everyone, within moments.',
    group: 'ai',
    kill: {
      title: 'Turn off AI for everyone?',
      body: 'Every AI feature stops at once: reply drafts, summaries, article drafts, similar work and triage decisions. Nothing more is sent to any provider. New tickets keep what intake gives them. You can turn it back on here at any time.',
      confirmLabel: 'Turn off AI',
      tone: 'danger',
    },
    offMeans: 'Off: every AI feature is refused, whatever the switches below say.',
  },
  'ai.capability.reply-draft': { label: 'Reply drafts', group: 'ai', offMeans: 'Off: agents write every reply themselves.' },
  'ai.capability.ticket-summary': { label: 'Ticket summaries', group: 'ai', offMeans: 'Off: no summaries for handovers or escalations.' },
  'ai.capability.article-draft': { label: 'Article drafts', group: 'ai', offMeans: 'Off: articles are written from scratch.' },
  'ai.capability.similar-work': { label: 'Similar work', group: 'ai', offMeans: 'Off: agents aren’t shown similar tickets or known errors.' },
  'ai.decision.triage': {
    label: 'Triage decisions',
    description: 'The AI’s decisions on new tickets’ category and team. Off by default: nothing is sent anywhere until it is switched on and a mode chosen.',
    group: 'ai',
    managedAt: { href: '/ai-triage', label: 'AI triage' },
  },
  'rules.engine.enabled': {
    label: 'Business rules',
    group: 'rules',
    kill: {
      title: 'Turn off business rules for everyone?',
      body: 'No rule runs on any ticket until this is turned back on: no priorities, assignments, tags or notifications set by rules. Workflows already running carry on.',
      confirmLabel: 'Turn off rules',
      tone: 'danger',
    },
    offMeans: 'Off: no rule runs on any ticket.',
  },
  'ticket.customFields': { label: 'Custom fields on tickets', description: 'Check and show the desk’s own ticket fields.', group: 'tickets' },
};

const MODULE_FLAG_GROUPS: Readonly<Record<string, FlagGroupId>> = { 'MOD-09-AI': 'ai', 'MOD-06': 'rules', 'MOD-04': 'tickets' };

export function flagEntry(key: string, module?: string): FlagEntry {
  const known = FLAGS[key];
  if (known) return known;
  const prefix = key.split('.')[0] ?? '';
  const group: FlagGroupId = (module ? MODULE_FLAG_GROUPS[module] : undefined) ?? (prefix === 'ai' ? 'ai' : prefix === 'rules' ? 'rules' : prefix === 'ticket' ? 'tickets' : 'other');
  return { label: labelFromKey(key), group };
}

/** "core-squad" → "Core squad"; "ai" → "AI". */
export function ownerText(owner: string): string {
  const words = owner.replace(/[_-]+/g, ' ').trim();
  if (words.toLowerCase() === 'ai') return 'AI';
  return words.charAt(0).toUpperCase() + words.slice(1).replace(/\bai\b/g, 'AI');
}

/**
 * A flag's expiry in words: permanent flags have none; a temporary one is to
 * be removed by a delivery phase ("PH-3" → "phase 3"), which is what the
 * chip says.
 */
export function expiryText(expires: string): string | null {
  if (expires === 'permanent') return null;
  const phase = /^PH-(\d+)$/i.exec(expires);
  if (phase) return `Temporary · review by phase ${phase[1]}`;
  const date = Date.parse(expires);
  if (!Number.isNaN(date)) {
    return `Temporary · review by ${new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)}`;
  }
  return `Temporary · review by ${expires}`;
}

/* =========================================================================
 * Search (MOD-13-E1-S1): label, key, value and description, across tabs
 * ====================================================================== */

export type SettingsTabId = 'general' | 'features' | 'ai';

export interface SearchEntry {
  readonly kind: 'setting' | 'flag';
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** The value in words, so "least loaded" or "7 days" finds it. */
  readonly value: string;
  /** The section title, so "workload" finds its settings. */
  readonly section: string;
  readonly tab: SettingsTabId;
  readonly changed: boolean;
}

/** Folded for matching: lower case, accents off, so "cafe" finds "Café". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Every word of the query somewhere in the entry. An empty query matches everything. */
export function matches(entry: SearchEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold([entry.label, entry.key, entry.description, entry.value, entry.section].join(' '));
  return words.every((word) => haystack.includes(word));
}

export function sectionTitle(group: SettingGroupId): string {
  if (group === 'ai') return 'AI';
  return GENERAL_GROUPS.find((entry) => entry.id === group)?.title ?? 'Other settings';
}

/** The tab a setting is on: AI settings on AI, everything else on General. */
export function tabOfSetting(key: string): SettingsTabId {
  return settingEntry(key).group === 'ai' ? 'ai' : 'general';
}

/**
 * The tab a search sends a flag to: Features, which lists every flag. (The AI
 * tab repeats the AI switches beside the settings they go with; a view
 * leaves out of "elsewhere" whatever it already shows.)
 */
export function tabOfFlag(): SettingsTabId {
  return 'features';
}

export interface SettingLike {
  readonly key: string;
  readonly module?: string;
  readonly description: string | null;
  readonly value: unknown;
  readonly default: unknown;
  readonly type?: SettingType;
}

export interface FlagLike {
  readonly key: string;
  readonly module?: string;
  readonly description: string | null;
  readonly value: boolean;
  readonly default: boolean;
}

export function searchIndex(settings: readonly SettingLike[], flags: readonly FlagLike[]): SearchEntry[] {
  return [
    ...settings.map((setting) => {
      const entry = settingEntry(setting.key);
      return {
        kind: 'setting' as const,
        key: setting.key,
        label: entry.label,
        description: entry.description ?? setting.description ?? '',
        value: valueText(setting.key, setting.type, setting.value),
        section: sectionTitle(entry.group),
        tab: tabOfSetting(setting.key),
        changed: isChanged(setting.value, setting.default),
      };
    }),
    ...flags.map((flag) => {
      const entry = flagEntry(flag.key, flag.module);
      return {
        kind: 'flag' as const,
        key: flag.key,
        label: entry.label,
        description: entry.description ?? flag.description ?? '',
        value: flag.value ? 'On' : 'Off',
        section: FLAG_GROUPS.find((group) => group.id === entry.group)?.title ?? 'Other features',
        tab: tabOfFlag(),
        changed: flag.value !== flag.default,
      };
    }),
  ];
}

export const TAB_LABELS: Readonly<Record<SettingsTabId, string>> = { general: 'General', features: 'Features', ai: 'AI' };
export const TAB_HREFS: Readonly<Record<SettingsTabId, string>> = { general: '/settings', features: '/settings/features', ai: '/settings/ai' };

/** The element id a row carries, which a jump link's fragment names. */
export function anchorId(kind: 'setting' | 'flag', key: string): string {
  return `${kind}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** Where a search match lives: its tab, with the query kept and the row as the fragment. */
export function hrefFor(entry: Pick<SearchEntry, 'kind' | 'key' | 'tab'>, query: string, changedOnly = false): string {
  const params = new URLSearchParams();
  if (query.trim() !== '') params.set('q', query.trim());
  if (changedOnly) params.set('changed', '1');
  const search = params.toString();
  return `${TAB_HREFS[entry.tab]}${search ? `?${search}` : ''}#${anchorId(entry.kind, entry.key)}`;
}
