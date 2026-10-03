import type { PublicStatus } from '@itsm/sdk';

/**
 * The rules of "How can we help?", as plain data (SPEC D17, §6.3): what a
 * draft holds, how a first sentence becomes a title, which open incidents a
 * description is probably about, what a failed send means. No React and no
 * design system here, so a server page (Home, `/report`) can use the same
 * rules as the sheet without shipping anything, and every rule is a unit
 * test away.
 */

/* ------------------------------------------------------------- Permissions */

/**
 * What the flow may ask for while somebody types. Without `search` and
 * `readKnowledge` there are no answers; without `readCatalogue`, no
 * services. Their own requests need nothing: every requester may list those.
 */
export interface HelpCan {
  readonly search: boolean;
  readonly readKnowledge: boolean;
  readonly readCatalogue: boolean;
}

/** Everything allowed — for a caller that has not been told (the tests, an older frame). */
export const HELP_CAN_ALL: HelpCan = { search: true, readKnowledge: true, readCatalogue: true };

/* ------------------------------------------------------------------ Urgency */

export type Urgency = 'low' | 'medium' | 'high';

/** "It is slowing me down": the honest middle, and what most reports are. */
export const DEFAULT_URGENCY: Urgency = 'medium';

export function isUrgency(value: unknown): value is Urgency {
  return value === 'low' || value === 'medium' || value === 'high';
}

/**
 * Each urgency card's tile and its one-line consequence (SPEC v3 §7.2, X-M12):
 * what choosing it means for the person, beside the words they choose by.
 * Only "I cannot work" takes a tone of its own (`high`, never a status
 * colour: urgency is the requester's word, not a state); the others stay
 * neutral, so the cards differ by shape and words first.
 */
export const URGENCY_LOOK: Readonly<Record<Urgency, { readonly icon: 'circle-check' | 'hourglass' | 'circle-alert'; readonly tone: 'neutral' | 'high'; readonly consequence: string }>> = {
  low: { icon: 'circle-check', tone: 'neutral', consequence: 'We’ll fit it in around more urgent work.' },
  medium: { icon: 'hourglass', tone: 'neutral', consequence: 'We’ll pick it up in the usual order.' },
  high: { icon: 'circle-alert', tone: 'high', consequence: 'We’ll treat it as urgent.' },
};

/* ------------------------------------------------------------------- Drafts */

/** The three steps (v3 §7.2: Describe · Details · Review). */
export type HelpStep = 'describe' | 'details' | 'review';

/** What is kept on this device while somebody writes a report. */
export interface ReportDraft {
  readonly step: HelpStep;
  /** Step 1's words. */
  readonly text: string;
  readonly title: string;
  readonly details: string;
  readonly urgency: Urgency;
}

export const EMPTY_DRAFT: ReportDraft = { step: 'describe', text: '', title: '', details: '', urgency: DEFAULT_URGENCY };

/**
 * `itsm-draft:report:<user>` (SPEC §6.3): one per person on this device, so
 * a shared machine never shows one person's half-written report to the next
 * (and sign-out clears every `itsm-draft:` key). No person, no draft.
 */
export function draftKey(userId: string | null | undefined): string | null {
  return userId ? `itsm-draft:report:${userId}` : null;
}

/** Nothing typed anywhere: not worth keeping (an urgency on its own is not a report). */
export function isEmptyDraft(draft: ReportDraft): boolean {
  return draft.text.trim() === '' && draft.title.trim() === '' && draft.details.trim() === '';
}

/** A stored draft, checked field by field: storage is anybody's to edit, and an old shape must not break the sheet. */
export function readReportDraft(value: unknown): ReportDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');
  const draft: ReportDraft = {
    step: record.step === 'details' || record.step === 'review' ? record.step : 'describe',
    text: text('text'),
    title: text('title'),
    details: text('details'),
    urgency: isUrgency(record.urgency) ? record.urgency : DEFAULT_URGENCY,
  };
  return isEmptyDraft(draft) ? null : draft;
}

/* ------------------------------------------------------------ Description */

/** The API's limits (`POST /tickets`). */
export const TITLE_MAX = 500;
export const DETAILS_MAX = 10_000;

/** Past this, what somebody typed in step 1 is a description, not a title. */
export const TITLE_COMFORT = 120;

/**
 * Step 1's words as step 2's title and details. A short line is the title as
 * it stands. A long one keeps its first sentence (or its first 100-odd
 * characters, cut at a word) as the title, and all of it as the details — so
 * nothing they wrote is lost, and the desk's list does not show a paragraph.
 */
export function splitDescription(text: string): { title: string; details: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_COMFORT) return { title: clean, details: '' };
  const sentence = /^(.{12,}?[.!?])(?:\s|$)/.exec(clean)?.[1];
  if (sentence && sentence.length <= TITLE_COMFORT) return { title: sentence, details: text.trim() };
  const cut = clean.slice(0, TITLE_COMFORT - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).replace(/[\s,;:.–-]+$/, '');
  return { title: `${atWord}…`, details: text.trim() };
}

/** Field problems before anything is sent, in the words the API would use but kinder. */
export function validateReport(input: { title: string; details: string }): Record<'title' | 'details', string | undefined> {
  const title = input.title.trim();
  return {
    title: title === '' ? 'Give it a short title, like “Laptop won’t connect to the VPN”.' : title.length > TITLE_MAX ? `Keep the title under ${TITLE_MAX} characters.` : undefined,
    details: input.details.trim().length > DETAILS_MAX ? `That’s too long to send. Keep it under ${DETAILS_MAX.toLocaleString('en-GB')} characters.` : undefined,
  };
}

/* ------------------------------------------------------------ Known issues */

/** An open incident on the tenant's status page, as the flow and Home's banner show it. */
export interface KnownIssue {
  readonly id: string;
  readonly title: string;
  /** `minor`, `major`, `critical`… as the status page records it. */
  readonly impact: string;
  /** The affected components' names. */
  readonly components: readonly string[];
  /** When it last changed: its latest update, else when it started. */
  readonly updatedAt: string;
}

const IMPACT_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, none: 3 };

/** The incidents still open, worst first, then the most recently updated. */
export function knownIssuesFrom(status: PublicStatus | null): KnownIssue[] {
  if (!status) return [];
  const names = new Map(status.components.map((component) => [component.key, component.name]));
  return status.incidents
    .filter((incident) => incident.resolvedAt === null && incident.status !== 'resolved')
    .map((incident): KnownIssue => {
      const latest = [...incident.updates].sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0];
      return {
        id: incident.id,
        title: incident.title,
        impact: incident.impact,
        components: incident.components.map((key) => names.get(key) ?? key),
        updatedAt: latest?.postedAt ?? incident.startedAt,
      };
    })
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 2) - (IMPACT_RANK[b.impact] ?? 2) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Whether an incident is serious enough to be drawn in danger rather than warning colours. */
export function isSevere(issue: Pick<KnownIssue, 'impact'>): boolean {
  return issue.impact === 'major' || issue.impact === 'critical';
}

/** Words too common to say what somebody's problem is about. */
const STOP_WORDS = new Set(
  'the and for with not but can cant cannot wont won dont does doesnt isnt its our your this that from have has had was were are you all any get got just into when what why how who where there their them then than too very also able work working broken issue problem help need please'.split(' '),
);

function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** "printers" and "printer" are the same thing to somebody describing a fault. */
function singular(word: string): string {
  return word.replace(/(?<=...)s$/, '');
}

/**
 * "Is it this?" — the open incidents a description is probably about: one of
 * its words (plurals folded) names the incident or an affected component.
 * Deliberately simple and visible: a wrong guess costs one "It's something
 * else", a missed one costs a duplicate report the desk links anyway.
 */
export function matchingIssues(issues: readonly KnownIssue[], text: string): KnownIssue[] {
  const words = new Set(wordsOf(text).map(singular));
  if (words.size === 0) return [];
  return issues.filter((issue) => wordsOf([issue.title, ...issue.components].join(' ')).some((word) => words.has(singular(word))));
}

/* ------------------------------------------------------------------ Timing */

/** The first-response target's due time, when its clock is running — the promise the success screen repeats. */
export function responseDueAt(timers: readonly { targetType: string; state: string; dueAt: string | null }[]): string | null {
  const response = timers.find((timer) => timer.targetType === 'response' && timer.dueAt !== null && timer.state !== 'met' && timer.state !== 'cancelled');
  return response?.dueAt ?? null;
}

/* ---------------------------------------------------------------- Failures */

/** The problem a refused send came back with, as far as the flow needs it. */
export interface SendProblem {
  readonly status: number;
  /** Field → message, from a 422. `description` is the details field's name on the wire. */
  readonly fields: Readonly<Record<string, string>>;
  readonly detail?: string;
  readonly retryAfterSeconds?: number;
}

/** Reads an RFC 9457 problem document off a refused response, if that is what came back. */
export async function sendProblemOf(response: Response): Promise<SendProblem> {
  const retryAfter = Number(response.headers.get('retry-after'));
  const base = { status: response.status, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
  try {
    const body = (await response.json()) as { detail?: unknown; errors?: { field?: unknown; message?: unknown }[] } | null;
    const fields: Record<string, string> = {};
    for (const entry of Array.isArray(body?.errors) ? body.errors : []) {
      if (typeof entry.field === 'string' && typeof entry.message === 'string') fields[entry.field] = entry.message;
    }
    return { ...base, fields, ...(typeof body?.detail === 'string' && body.detail ? { detail: body.detail } : {}) };
  } catch {
    return { ...base, fields: {} };
  }
}

/**
 * What to say when a report did not go through (SPEC §4.10) — always with
 * the reassurance that what they wrote is still here, because it is.
 */
export function sendFailureMessage(problem: SendProblem): string {
  switch (problem.status) {
    case 402:
      return 'Your organisation has reached its ticket limit. Tell your IT team — your report is still here.';
    case 403:
      return 'You can’t report issues here any more. Your access may have changed — ask your IT team.';
    case 422:
      return Object.keys(problem.fields).length > 0 ? 'Check the highlighted fields and send it again.' : (problem.detail ?? 'Something in the report wasn’t accepted. Check it and send it again.');
    case 429:
      return problem.retryAfterSeconds
        ? `Too many reports at once. Try again in ${problem.retryAfterSeconds} s — your report is still here.`
        : 'Too many reports at once. Wait a moment and try again — your report is still here.';
    default:
      return problem.status >= 500
        ? 'The service desk couldn’t take it just now. Your report is still here — try again.'
        : 'That didn’t send. Your report is still here — try again.';
  }
}
