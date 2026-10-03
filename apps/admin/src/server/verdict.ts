import { HEALTH_VERDICT_LOOK, worstHealthVerdict, type HealthIcon, type HealthTone, type HealthVerdict } from '@itsm/contracts/health';
import { COMPONENT_STATE_LOOK, type ComponentStateKey, type IconName, type Tone } from '@itsm/ui';

/**
 * The three heroes' verdicts, decided on the server by pure functions
 * (A7 §2.1 G4, §4.1, §4.6, §4.7; SPEC §7.3).
 *
 * - **`serviceHealth()`**, the Command centre's "Service health": six
 *   dimensions, each banded On track · At risk · Off track, and the verdict
 *   is the worst one shown — a `HealthVerdict` from `@itsm/contracts/health`,
 *   the same words and tones as the Service Desk Overview (R7, X-M3). "At
 *   risk" is amber because it *is* the risk of missing a target, the one
 *   meaning D5 keeps amber for. Fewer than two dimensions with an answer is
 *   no verdict at all: one number is not a judgement of a service.
 * - **`aiTriageHealth()`** says what AI triage is doing, which is a mode, not
 *   a health: neutral, info or success, and `high` when it stepped itself
 *   back (not an SLA risk, so not amber).
 * - **`statusPageHealth()`** is the worst visible component's state, in
 *   `COMPONENT_STATE_LOOK`'s tones — never `warning` (X-B3).
 *
 * Every percentage arrives 0–100 and the SLA target is passed in (from
 * `attainmentTarget()`); nothing here holds a target of its own.
 */

/* =========================================================================
 * Service health
 * ====================================================================== */

export type ServiceDimensionId = 'response' | 'resolution' | 'flow' | 'major-incidents' | 'automation' | 'customer';

export interface OpenMajorIncident {
  /** `MI-0004`. */
  readonly number: string;
  /** `SEV1`–`SEV3`, as `modules/incident` stores them. */
  readonly severity: string;
  readonly title?: string;
}

/**
 * What the hero is judged on. A dimension the person may not see is left
 * `undefined` and is not drawn; one they may see whose source answered with
 * nothing is `null`, drawn as "No data" and left out of the verdict.
 */
export interface ServiceHealthInput {
  /** The attainment target, 0–100 (`attainmentTarget(result).percent`). */
  readonly target: number;
  readonly responseSla?: number | null;
  readonly resolutionSla?: number | null;
  /** Tickets raised and resolved over the period, for Flow; both needed. */
  readonly flow?: { readonly raised: number | null; readonly resolved: number | null } | null;
  readonly majorIncidents?: readonly OpenMajorIncident[] | null;
  /** Failed workflow runs plus failed deliveries now. */
  readonly automationFailures?: number | null;
  /** The satisfaction score, 0–100. */
  readonly satisfaction?: number | null;
  /** The same SLA, Flow and Customer inputs over the previous period, for the trend line. */
  readonly previous?: Pick<ServiceHealthInput, 'responseSla' | 'resolutionSla' | 'flow' | 'satisfaction'>;
  /** The period's length, for "in the previous 30 days". */
  readonly periodDays: number;
  readonly locale?: string;
}

export interface HealthDimension {
  readonly id: ServiceDimensionId;
  readonly label: string;
  /** `null`: the source answered with nothing; drawn as "No data", left out of the verdict. */
  readonly verdict: HealthVerdict | null;
  readonly tone: HealthTone | 'neutral';
  readonly icon: HealthIcon | 'minus';
  /** "92% · target 90%", "Resolved 93 for every 100 raised", "1 open · Sev 2". */
  readonly detail: string;
}

export interface HealthChip {
  readonly verdict: HealthVerdict;
  readonly label: string;
  /** The first dimension with this verdict, as an in-page anchor. */
  readonly href: string;
}

export interface ServiceHealth {
  readonly verdict: HealthVerdict;
  readonly label: string;
  readonly tone: HealthTone;
  readonly icon: HealthIcon;
  readonly dimensions: readonly HealthDimension[];
  readonly chips: readonly HealthChip[];
  /** One sentence: an open major incident first, then the worst SLA, then Flow. */
  readonly narrative: string;
  /** "SLA and flow were at risk in the previous 30 days"; `null` without previous figures. */
  readonly trend: string | null;
}

/** Points under the target at which an SLA dimension turns from at risk to off track. */
export const SLA_BAND_POINTS = 10;
/** Flow, resolved for every 100 raised: at or over this is on track. */
export const FLOW_ON_TRACK = 98;
/** Flow under this is off track. */
export const FLOW_OFF_TRACK = 90;
/** Automation failures at or over this are off track. */
export const AUTOMATION_OFF_TRACK = 5;
/** Satisfaction, 0–100: at or over this is on track. */
export const CUSTOMER_ON_TRACK = 80;
/** Satisfaction under this is off track. */
export const CUSTOMER_OFF_TRACK = 70;

function percent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

function whole(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function gapPoints(gap: number, locale: string): string {
  const size = Math.round(Math.abs(gap));
  return `${whole(size, locale)} ${size === 1 ? 'point' : 'points'}`;
}

export function slaVerdict(value: number, target: number): HealthVerdict {
  if (value >= target) return 'on_track';
  return value >= target - SLA_BAND_POINTS ? 'at_risk' : 'off_track';
}

/** Resolved for every 100 raised; nothing raised is keeping pace by definition. */
export function flowRate(raised: number, resolved: number): number {
  return raised <= 0 ? 100 : (resolved / raised) * 100;
}

export function flowVerdict(rate: number): HealthVerdict {
  if (rate >= FLOW_ON_TRACK) return 'on_track';
  return rate >= FLOW_OFF_TRACK ? 'at_risk' : 'off_track';
}

/** "Sev 2" from `SEV2`; any other value as written. */
export function severityWords(severity: string): string {
  const match = /^SEV([1-9])$/i.exec(severity.trim());
  return match ? `Sev ${match[1]}` : severity;
}

export function majorIncidentVerdict(open: readonly OpenMajorIncident[]): HealthVerdict {
  if (open.length === 0) return 'on_track';
  return open.some((incident) => /^SEV1$/i.test(incident.severity)) ? 'off_track' : 'at_risk';
}

export function automationVerdict(failures: number): HealthVerdict {
  if (failures <= 0) return 'on_track';
  return failures < AUTOMATION_OFF_TRACK ? 'at_risk' : 'off_track';
}

export function customerVerdict(score: number): HealthVerdict {
  if (score >= CUSTOMER_ON_TRACK) return 'on_track';
  return score >= CUSTOMER_OFF_TRACK ? 'at_risk' : 'off_track';
}

/** A 0–100 score as stars out of five, one decimal (85 → 4.4). */
function starsText(score: number, locale: string): string {
  const stars = Math.round((1 + (score * 4) / 100) * 10) / 10;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(stars)} out of 5`;
}

function dimension(id: ServiceDimensionId, label: string, verdict: HealthVerdict | null, detail: string): HealthDimension {
  if (verdict === null) return { id, label, verdict, tone: 'neutral', icon: 'minus', detail };
  const look = HEALTH_VERDICT_LOOK[verdict];
  return { id, label, verdict, tone: look.tone, icon: look.icon, detail };
}

function slaDimension(id: 'response' | 'resolution', label: string, value: number | null, target: number, locale: string): HealthDimension {
  if (value === null || !Number.isFinite(value)) return dimension(id, label, null, 'No data');
  const gap = value - target;
  const detail = gap >= 0 ? `${percent(value, locale)} · target ${percent(target, locale)}` : `${percent(value, locale)} · ${gapPoints(gap, locale)} under`;
  return dimension(id, label, slaVerdict(value, target), detail);
}

/** The most severe open major incident, then the newest (the input's order). */
function leadIncident(open: readonly OpenMajorIncident[]): OpenMajorIncident | undefined {
  const rank = (incident: OpenMajorIncident): number => {
    const match = /^SEV([1-9])$/i.exec(incident.severity);
    return match ? Number(match[1]) : 9;
  };
  return [...open].sort((a, b) => rank(a) - rank(b))[0];
}

/** The dimensions shown, in the hero's order. */
export function serviceDimensions(input: ServiceHealthInput): HealthDimension[] {
  const locale = input.locale ?? 'en-GB';
  const out: HealthDimension[] = [];
  if (input.responseSla !== undefined) out.push(slaDimension('response', 'Response SLA', input.responseSla, input.target, locale));
  if (input.resolutionSla !== undefined) out.push(slaDimension('resolution', 'Resolution SLA', input.resolutionSla, input.target, locale));
  if (input.flow !== undefined) {
    const raised = input.flow?.raised;
    const resolved = input.flow?.resolved;
    if (typeof raised !== 'number' || typeof resolved !== 'number') out.push(dimension('flow', 'Flow', null, 'No data'));
    else if (raised <= 0 && resolved <= 0) out.push(dimension('flow', 'Flow', null, 'Nothing raised or resolved'));
    else {
      const rate = flowRate(raised, resolved);
      out.push(dimension('flow', 'Flow', flowVerdict(rate), `Resolved ${whole(rate, locale)} for every 100 raised`));
    }
  }
  if (input.majorIncidents !== undefined) {
    const open = input.majorIncidents;
    if (open === null) out.push(dimension('major-incidents', 'Major incidents', null, 'No data'));
    else {
      const lead = leadIncident(open);
      out.push(dimension('major-incidents', 'Major incidents', majorIncidentVerdict(open), lead ? `${whole(open.length, locale)} open · ${severityWords(lead.severity)}` : 'None open'));
    }
  }
  if (input.automationFailures !== undefined) {
    const failures = input.automationFailures;
    if (failures === null || !Number.isFinite(failures)) out.push(dimension('automation', 'Automation', null, 'No data'));
    else out.push(dimension('automation', 'Automation', automationVerdict(failures), failures <= 0 ? 'Nothing failed' : `${whole(failures, locale)} failed`));
  }
  if (input.satisfaction !== undefined) {
    const score = input.satisfaction;
    if (score === null || !Number.isFinite(score)) out.push(dimension('customer', 'Customer', null, 'No responses'));
    else out.push(dimension('customer', 'Customer', customerVerdict(score), starsText(score, locale)));
  }
  return out;
}

/** "MI-0004 is open at Sev 2, and resolution attainment is 84% against a 90% target". */
export function heroNarrative(input: ServiceHealthInput, dimensions: readonly HealthDimension[]): string {
  const locale = input.locale ?? 'en-GB';
  const clauses: string[] = [];
  const lead = input.majorIncidents ? leadIncident(input.majorIncidents) : undefined;
  if (lead) clauses.push(`${lead.number} is open at ${severityWords(lead.severity)}`);

  const sla = (['response', 'resolution'] as const)
    .map((id) => ({ id, value: id === 'response' ? input.responseSla : input.resolutionSla }))
    .filter((entry): entry is { id: 'response' | 'resolution'; value: number } => typeof entry.value === 'number' && entry.value < input.target)
    .sort((a, b) => a.value - b.value)[0];
  if (sla) clauses.push(`${sla.id} attainment is ${percent(sla.value, locale)} against a ${percent(input.target, locale)} target`);

  const flow = dimensions.find((entry) => entry.id === 'flow');
  if (flow?.verdict && flow.verdict !== 'on_track' && clauses.length < 2) clauses.push(`flow is behind: ${flow.detail.charAt(0).toLowerCase()}${flow.detail.slice(1)}`);

  if (clauses.length === 0) {
    const behind = dimensions.filter((entry) => entry.verdict && entry.verdict !== 'on_track');
    if (behind.length === 0) return 'Every measure shown is on track';
    return `${behind[0]!.label} is ${HEALTH_VERDICT_LOOK[behind[0]!.verdict!].label.toLowerCase()}: ${behind[0]!.detail}`;
  }
  const sentence = clauses.join(', and ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The trend line (X-m21): how SLA, flow and satisfaction did over the
 * previous period, named one by one — never a verdict on the whole service,
 * which the previous period's major incidents and automation cannot be
 * judged for.
 */
export function previousTrend(input: ServiceHealthInput): string | null {
  const previous = input.previous;
  if (!previous) return null;
  const span = `in the previous ${input.periodDays} days`;
  const judged: { readonly word: string; readonly verdict: HealthVerdict }[] = [];
  const slaValues = [previous.responseSla, previous.resolutionSla].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (slaValues.length > 0) judged.push({ word: 'SLA', verdict: worstHealthVerdict(slaValues.map((value) => slaVerdict(value, input.target)))! });
  if (previous.flow && typeof previous.flow.raised === 'number' && typeof previous.flow.resolved === 'number' && (previous.flow.raised > 0 || previous.flow.resolved > 0)) {
    judged.push({ word: 'flow', verdict: flowVerdict(flowRate(previous.flow.raised, previous.flow.resolved)) });
  }
  if (typeof previous.satisfaction === 'number' && Number.isFinite(previous.satisfaction)) judged.push({ word: 'satisfaction', verdict: customerVerdict(previous.satisfaction) });
  if (judged.length === 0) return null;

  const words = (verdict: HealthVerdict): string[] => judged.filter((entry) => entry.verdict === verdict).map((entry) => entry.word);
  const behind = (['off_track', 'at_risk'] as const).filter((verdict) => words(verdict).length > 0);
  const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  if (behind.length === 0) {
    const all = judged.map((entry) => entry.word);
    return capital(`${joinWords(all)} ${all.length === 1 ? 'was' : 'were'} on track ${span}`);
  }
  const parts = behind.map((verdict, index) => {
    const named = words(verdict);
    const label = HEALTH_VERDICT_LOOK[verdict].label.toLowerCase();
    return index === 0 ? `${joinWords(named)} ${named.length === 1 ? 'was' : 'were'} ${label}` : `${joinWords(named)} ${label}`;
  });
  return capital(`${parts.join(' and ')} ${span}`);
}

/**
 * The Command centre's verdict, or `null` when fewer than two dimensions
 * answered: the hero is then not drawn and the KPI row moves up (A7 §4.1).
 */
export function serviceHealth(input: ServiceHealthInput): ServiceHealth | null {
  const dimensions = serviceDimensions(input);
  const judged = dimensions.filter((entry) => entry.verdict !== null);
  if (judged.length < 2) return null;
  const verdict = worstHealthVerdict(judged.map((entry) => entry.verdict))!;
  const look = HEALTH_VERDICT_LOOK[verdict];
  const chips: HealthChip[] = [];
  for (const each of ['on_track', 'at_risk', 'off_track'] as const) {
    const matching = judged.filter((entry) => entry.verdict === each);
    if (matching.length > 0) chips.push({ verdict: each, label: `${matching.length} ${HEALTH_VERDICT_LOOK[each].label.toLowerCase()}`, href: `#health-${matching[0]!.id}` });
  }
  return {
    verdict,
    label: look.label,
    tone: look.tone,
    icon: look.icon,
    dimensions,
    chips,
    narrative: heroNarrative(input, dimensions),
    trend: previousTrend(input),
  };
}

/* =========================================================================
 * AI triage
 * ====================================================================== */

export type TriageMode = 'off' | 'shadow' | 'suggest' | 'auto';

export interface AiTriageInput {
  readonly mode: TriageMode;
  /** Fields AI may set by itself in `auto`. */
  readonly autoFields?: number;
  /** When AI last stepped itself back from auto, if it did. */
  readonly lastStepDownAt?: string | null;
  /** Decisions answered by the sample provider: the demo's (D13). */
  readonly samples?: number;
  readonly now?: Date;
}

export interface AiTriageVerdict {
  readonly kicker: string;
  readonly label: string;
  readonly tone: Extract<Tone, 'neutral' | 'info' | 'success' | 'high'>;
  readonly icon: IconName;
  /** True when the figures come from sample decisions: the page shows `SampleNote`. */
  readonly sample: boolean;
}

/** A step back from auto counts as news for this long. */
export const STEP_DOWN_NEWS_DAYS = 7;

/** What AI triage is doing, in words (A7 §4.6). */
export function aiTriageHealth(input: AiTriageInput): AiTriageVerdict {
  const sample = (input.samples ?? 0) > 0;
  const kicker = sample ? 'AI triage · sample data' : 'AI triage';
  const now = (input.now ?? new Date()).getTime();
  const stepped = input.lastStepDownAt ? Date.parse(input.lastStepDownAt) : Number.NaN;
  if (input.mode !== 'auto' && Number.isFinite(stepped) && now - stepped <= STEP_DOWN_NEWS_DAYS * 24 * 60 * 60 * 1000 && now >= stepped) {
    return { kicker, label: 'Stepped back to suggest', tone: 'high', icon: 'undo-2', sample };
  }
  switch (input.mode) {
    case 'off':
      return { kicker, label: 'Off', tone: 'neutral', icon: 'circle-dashed', sample };
    case 'shadow':
      return { kicker, label: 'Learning in shadow', tone: 'info', icon: 'eye', sample };
    case 'suggest':
      return { kicker, label: 'Suggesting to agents', tone: 'info', icon: 'sparkles', sample };
    case 'auto': {
      const fields = input.autoFields ?? 0;
      return { kicker, label: `Setting ${fields} ${fields === 1 ? 'field' : 'fields'} by itself`, tone: 'success', icon: 'circle-check', sample };
    }
  }
}

/* =========================================================================
 * Status page
 * ====================================================================== */

export interface StatusComponentInput {
  readonly name: string;
  readonly status: string;
}

export interface StatusPageVerdict {
  readonly state: ComponentStateKey;
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
  /** The components not running, worst first: the hero's dimensions. */
  readonly affected: readonly StatusComponentInput[];
}

/** Worst last. Maintenance is planned, so it is less severe than anything broken. */
const COMPONENT_ORDER: readonly ComponentStateKey[] = ['operational', 'maintenance', 'degraded', 'partial_outage', 'major_outage'];

const STATUS_PAGE_WORDS: Readonly<Record<ComponentStateKey, string>> = {
  operational: 'All services running',
  maintenance: 'Under maintenance',
  degraded: 'Degraded',
  partial_outage: 'Partly down',
  major_outage: 'Down',
};

function componentState(status: string): ComponentStateKey {
  return (COMPONENT_ORDER as readonly string[]).includes(status) ? (status as ComponentStateKey) : 'operational';
}

/** The public status page's verdict: its worst visible component, in `COMPONENT_STATE_LOOK`'s tones (A7 §4.7, X-B3). */
export function statusPageHealth(components: readonly StatusComponentInput[]): StatusPageVerdict {
  const rank = (status: string): number => COMPONENT_ORDER.indexOf(componentState(status));
  const affected = components.filter((component) => componentState(component.status) !== 'operational').sort((a, b) => rank(b.status) - rank(a.status));
  const state = affected.length > 0 ? componentState(affected[0]!.status) : 'operational';
  const look = COMPONENT_STATE_LOOK[state];
  return { state, label: STATUS_PAGE_WORDS[state], tone: look.tone, icon: look.icon, affected };
}
