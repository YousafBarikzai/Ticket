import type { ActionRow, CredentialRow, ErrorQueueRow, WebhookRow } from '@itsm/sdk';
import type { IconName, Tone } from '@itsm/ui';

/**
 * Integrations in words (SPEC §6.1 `/integrations/**`, §6.4 "Failed
 * deliveries"): what went wrong with an outbound call, where it came from,
 * how close a credential is to expiring, whether an action can be trusted,
 * and which values in a payload look like secrets.
 *
 * Pure and server-safe — the pages build their rows here and hand plain data
 * to the client tables — and tested, because each of these is a place a
 * screen could say something it does not know: a credential "healthy" that
 * expired yesterday, an action "live" whose credential was deleted, a
 * bearer token printed in a payload viewer.
 */

export const DAY_MS = 86_400_000;

/** How close to its expiry a credential is flagged — the Command centre's window too. */
export const EXPIRY_WARNING_DAYS = 30;

/** At or above this many attempts a failure reads as a warning: it has been tried, and tried again. */
export const ATTEMPTS_WARNING = 3;

export interface Look {
  readonly label: string;
  readonly tone: Tone;
  readonly icon?: IconName;
}

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `aws_sigv4` → "Aws sigv4": the fallback for a word this file does not know. */
function words(value: string): string {
  return capitalise(value.replace(/[_.-]+/g, ' ').trim());
}

/* =========================================================================
 * Failed deliveries (the error queue)
 * ====================================================================== */

export type DeliveryStatus = 'open' | 'replayed' | 'dismissed';

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = ['open', 'replayed', 'dismissed'];

/** `?status=` as the page reads it: anything unknown is the open queue, which is what the page is for. */
export function deliveryStatus(value: string | string[] | undefined | null): DeliveryStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'replayed' || raw === 'dismissed' ? raw : 'open';
}

export const DELIVERY_LOOK: Readonly<Record<DeliveryStatus, Look>> = {
  open: { label: 'Failed', tone: 'danger' },
  replayed: { label: 'Delivered on replay', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export const DELIVERY_SCOPE_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  open: 'Open',
  replayed: 'Replayed',
  dismissed: 'Dismissed',
};

const SOURCES: Readonly<Record<string, string>> = {
  workflow: 'Workflow',
  rule: 'Rule',
  webhook: 'Webhook',
};

/** What sent the call: "Workflow", "Rule", "Webhook". */
export function sourceLabel(source: string): string {
  return SOURCES[source] ?? words(source);
}

/**
 * The first line of an error, for a table cell: a stack trace or a response
 * body is for the drawer. Cut at a word where it can be, with an ellipsis.
 */
export function firstLine(text: string, max = 160): string {
  const line = (text.split(/\r?\n/).find((entry) => entry.trim() !== '') ?? '').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function attemptsTone(attempts: number): Tone {
  return attempts >= ATTEMPTS_WARNING ? 'warning' : 'neutral';
}

/** A failed delivery as a row: plain data, names already resolved, secrets already hidden. */
export interface DeliveryView extends Record<string, unknown> {
  readonly id: string;
  readonly status: DeliveryStatus;
  readonly actionKey: string | null;
  /** The action's name, "Unnamed action" when the failure names none, or its key when the list could not be read. */
  readonly actionName: string;
  readonly source: string;
  readonly sourceLabel: string;
  readonly sourceId: string;
  /** "Workflow · Starter onboarding", or just "Workflow" when the run's workflow is not known. */
  readonly from: string;
  /** Where the thing that sent it can be opened, when this person may open it. */
  readonly fromHref?: string;
  readonly error: string;
  readonly errorLine: string;
  readonly attempts: number;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedByName: string | null;
  readonly dismissedReason: string | null;
  readonly idempotencyKey: string;
  /** With values that look like secrets replaced. */
  readonly payload: unknown;
  /** Only a failure an action produced can be sent again. */
  readonly replayable: boolean;
}

export interface DeliveryContext {
  readonly actionNames: ReadonlyMap<string, string>;
  /** Run id → workflow name, for failures a workflow sent. */
  readonly runWorkflows?: ReadonlyMap<string, string>;
  /** Where a source can be opened, or undefined when this person may not open it. */
  readonly hrefFor?: (row: ErrorQueueRow) => string | undefined;
  readonly people?: ReadonlyMap<string, string | null>;
}

export function deliveryView(row: ErrorQueueRow, context: DeliveryContext): DeliveryView {
  const label = sourceLabel(row.source);
  const workflow = row.source === 'workflow' ? context.runWorkflows?.get(row.sourceId) : undefined;
  const href = context.hrefFor?.(row);
  return {
    id: row.id,
    status: deliveryStatus(row.status),
    actionKey: row.actionKey,
    actionName: row.actionKey ? (context.actionNames.get(row.actionKey) ?? row.actionKey) : 'Unnamed action',
    source: row.source,
    sourceLabel: label,
    sourceId: row.sourceId,
    from: workflow ? `${label} · ${workflow}` : label,
    ...(href ? { fromHref: href } : {}),
    error: row.error,
    errorLine: firstLine(row.error),
    attempts: row.attempts,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    resolvedByName: row.resolvedBy ? (context.people?.get(row.resolvedBy) ?? null) : null,
    dismissedReason: row.dismissedReason,
    idempotencyKey: row.idempotencyKey,
    payload: redact(row.payload),
    replayable: row.actionKey !== null && deliveryStatus(row.status) === 'open',
  };
}

/** What a bulk replay or dismissal did, said once when it finishes (X-51). */
export interface BulkTally {
  readonly done: number;
  readonly failed: number;
  /** Not attempted: a failure no action produced cannot be replayed. */
  readonly skipped?: number;
  /** Not reached because the person pressed Cancel. */
  readonly left?: number;
}

export function replaySummary(tally: BulkTally): { readonly text: string; readonly tone: 'success' | 'warning' | 'danger' } {
  const parts: string[] = [];
  if (tally.done > 0 || (tally.failed === 0 && !tally.skipped)) parts.push(`Delivered ${tally.done}`);
  if (tally.failed > 0) parts.push(`${tally.failed} failed again`);
  if (tally.skipped) parts.push(`${plural(tally.skipped, 'has', 'have')} no action to replay`);
  if (tally.left) parts.push(`${tally.left} left as ${tally.left === 1 ? 'it was' : 'they were'}`);
  const tone = tally.done === 0 && (tally.failed > 0 || (tally.skipped ?? 0) > 0) ? 'danger' : tally.failed > 0 || tally.skipped || tally.left ? 'warning' : 'success';
  return { text: parts.join(' · '), tone };
}

export function dismissSummary(tally: BulkTally): { readonly text: string; readonly tone: 'success' | 'warning' | 'danger' } {
  const parts = [`Dismissed ${tally.done}`];
  if (tally.failed > 0) parts.push(`${tally.failed} couldn’t be dismissed`);
  if (tally.left) parts.push(`${tally.left} left as ${tally.left === 1 ? 'it was' : 'they were'}`);
  const tone = tally.done === 0 && tally.failed > 0 ? 'danger' : tally.failed > 0 || tally.left ? 'warning' : 'success';
  return { text: parts.join(' · '), tone };
}

/* =========================================================================
 * Secrets
 * ====================================================================== */

/** Keys whose values are secrets often enough that a viewer should never print them. */
const SECRET_NAME = /(secret|token|passw(or)?d|pwd|api[-_ ]?key|apikey|authori[sz]ation|^auth$|credential|private[-_ ]?key|signature|cookie|session|bearer)/i;

export const REDACTED = '•••••• hidden';

export function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** A URL with the values of secret-looking query parameters hidden (`?token=…`). */
function redactUrl(text: string): string {
  if (!/^https?:\/\//i.test(text) || !text.includes('?')) return text;
  try {
    const url = new URL(text);
    let changed = false;
    for (const name of [...url.searchParams.keys()]) {
      if (looksSecret(name)) {
        url.searchParams.set(name, 'hidden');
        changed = true;
      }
    }
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      changed = true;
    }
    return changed ? url.toString() : text;
  } catch {
    return text;
  }
}

/**
 * The value with every secret-looking field hidden: by key name (`token`,
 * `Authorization`, `api_key`…), bearer and basic credentials written into a
 * string, and secret query parameters in URLs. A copy — the value passed in
 * is not changed. What stays is what an administrator needs to see where a
 * call went and with what.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 20) return '…';
  if (typeof value === 'string') {
    if (/^\s*(bearer|basic)\s+\S+/i.test(value)) return REDACTED;
    return redactUrl(value);
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        looksSecret(key) && entry !== null && entry !== undefined && entry !== '' && typeof entry !== 'object' ? REDACTED : redact(entry, depth + 1),
      ]),
    );
  }
  return value;
}

/* =========================================================================
 * Credentials
 * ====================================================================== */

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';

export interface ExpiryLook extends Look {
  readonly state: ExpiryState;
  /** Whole days to go (soon) or since (expired); null without an expiry. */
  readonly days: number | null;
}

/**
 * How near a credential is to its expiry, always in words beside the colour
 * (SPEC: "Expires in 9 days" warning, "Expired" danger, text always).
 */
export function expiryLook(expiresAt: string | null, now: number): ExpiryLook {
  if (!expiresAt) return { state: 'none', days: null, label: 'Doesn’t expire', tone: 'neutral' };
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return { state: 'none', days: null, label: 'Doesn’t expire', tone: 'neutral' };
  if (at <= now) {
    const days = Math.floor((now - at) / DAY_MS);
    return { state: 'expired', days, label: days === 0 ? 'Expired today' : `Expired ${plural(days, 'day', 'days')} ago`, tone: 'danger', icon: 'circle-alert' };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  if (days <= EXPIRY_WARNING_DAYS) {
    return { state: 'soon', days, label: days <= 1 ? 'Expires within a day' : `Expires in ${days} days`, tone: 'warning', icon: 'clock' };
  }
  return { state: 'ok', days, label: `Expires in ${days} days`, tone: 'neutral' };
}

const CREDENTIAL_KINDS: Readonly<Record<string, string>> = {
  generic: 'Secret',
  aws_sigv4: 'AWS signature',
};

export const CREDENTIAL_KIND_OPTIONS: readonly { readonly value: string; readonly label: string; readonly hint: string }[] = [
  { value: 'generic', label: 'Secret', hint: 'An API key, token or password, sent in the header the action names.' },
  { value: 'aws_sigv4', label: 'AWS signature', hint: 'JSON with accessKeyId and secretAccessKey; requests are signed rather than sent a header.' },
];

export function credentialKindLabel(kind: string): string {
  return CREDENTIAL_KINDS[kind] ?? words(kind);
}

/** A credential's reference as the API accepts it: lowercase letters, digits and hyphens, starting with a letter. */
export const CREDENTIAL_REF = /^[a-z][a-z0-9-]{1,60}$/;

export function credentialRefProblem(ref: string, taken: readonly string[]): string | null {
  const value = ref.trim();
  if (value === '') return 'Enter a reference.';
  if (!/^[a-z]/.test(value)) return 'Start with a lowercase letter.';
  if (!CREDENTIAL_REF.test(value)) return 'Use lowercase letters, digits and hyphens only (2 to 61 characters).';
  if (taken.includes(value)) return `A credential called ${value} already exists. Rotate it instead.`;
  return null;
}

/** The overall state of one credential: its expiry, then its encryption key. */
export function credentialHealth(credential: Pick<CredentialRow, 'expiresAt' | 'needsRewrap'>, now: number): Look {
  const expiry = expiryLook(credential.expiresAt, now);
  if (expiry.state === 'expired') return { label: expiry.label, tone: 'danger', icon: 'circle-alert' };
  if (expiry.state === 'soon') return { label: expiry.label, tone: 'warning', icon: 'clock' };
  if (credential.needsRewrap) return { label: 'Needs re-encrypting', tone: 'warning', icon: 'key' };
  return { label: 'Healthy', tone: 'success' };
}

export interface CredentialView extends Record<string, unknown> {
  readonly ref: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly description: string | null;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly expiry: ExpiryLook;
  readonly expiryLabel: string;
  readonly needsRewrap: boolean;
  readonly keyLabel: string;
  readonly health: Look;
  /** The actions that authenticate with it, by name. */
  readonly usedBy: readonly string[];
}

export function credentialView(row: CredentialRow, now: number, actions: readonly ActionRow[] = []): CredentialView {
  const expiry = expiryLook(row.expiresAt, now);
  return {
    ref: row.ref,
    kind: row.kind,
    kindLabel: credentialKindLabel(row.kind),
    description: row.description,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    expiry,
    expiryLabel: expiry.label,
    needsRewrap: row.needsRewrap,
    keyLabel: row.needsRewrap ? 'Needs re-encrypting' : 'Current',
    health: credentialHealth(row, now),
    usedBy: actions.filter((action) => action.credentialRef === row.ref).map((action) => action.name),
  };
}

/* =========================================================================
 * Actions
 * ====================================================================== */

const ACTION_KINDS: Readonly<Record<string, string>> = { http: 'HTTP call', transform: 'Transform' };

export function actionKindLabel(kind: string): string {
  return ACTION_KINDS[kind] ?? words(kind);
}

export const ACTION_STATUS_LOOK: Readonly<Record<string, Look>> = {
  published: { label: 'Live', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
};

export function actionStatusLook(status: string): Look {
  return ACTION_STATUS_LOOK[status] ?? { label: words(status), tone: 'neutral' };
}

/** "15 s", "500 ms", "1 min 30 s": how long one call may take before it is given up. */
export function timeoutText(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * Whether an action can be trusted to work, in one look: its credential
 * first (missing or expired means every call fails), then open failures,
 * then a credential about to expire, then whether it is live at all.
 */
export function actionHealth(
  action: Pick<ActionRow, 'status' | 'credentialRef'>,
  credential: Pick<CredentialRow, 'expiresAt' | 'needsRewrap'> | null | undefined,
  openFailures: number,
  now: number,
  credentialsKnown = true,
): Look {
  if (action.credentialRef && credentialsKnown && !credential) return { label: 'Credential missing', tone: 'danger', icon: 'circle-alert' };
  const expiry = credential ? expiryLook(credential.expiresAt, now) : null;
  if (expiry?.state === 'expired') return { label: 'Credential expired', tone: 'danger', icon: 'circle-alert' };
  if (openFailures > 0) return { label: plural(openFailures, 'failed delivery', 'failed deliveries'), tone: 'danger', icon: 'circle-alert' };
  if (expiry?.state === 'soon') return { label: `Credential ${expiry.label.charAt(0).toLowerCase()}${expiry.label.slice(1)}`, tone: 'warning', icon: 'clock' };
  if (credential?.needsRewrap) return { label: 'Credential needs re-encrypting', tone: 'warning', icon: 'key' };
  if (action.status !== 'published') return { label: 'Not live yet', tone: 'neutral' };
  return { label: 'Healthy', tone: 'success' };
}

export interface ActionView extends Record<string, unknown> {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: string;
  readonly kindLabel: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly credentialRef: string | null;
  readonly credentialHeader: string | null;
  /** The credential's own state, for the chip; null without one. */
  readonly credentialLook: Look | null;
  readonly health: Look;
  readonly healthLabel: string;
  readonly openFailures: number;
  readonly timeoutMs: number;
  readonly timeoutLabel: string;
  readonly retryMax: number;
  /** "POST https://…", for HTTP calls. */
  readonly target: string | null;
  readonly config: unknown;
  readonly responseMapping: unknown;
  readonly updatedAt: string;
}

function targetOf(action: ActionRow): string | null {
  if (action.kind !== 'http' || !action.config || typeof action.config !== 'object') return null;
  const config = action.config as { method?: unknown; url?: unknown };
  if (typeof config.url !== 'string') return null;
  const method = typeof config.method === 'string' ? config.method : 'POST';
  return `${method} ${redact(config.url) as string}`;
}

export function actionView(
  action: ActionRow,
  context: { readonly credentials: ReadonlyMap<string, CredentialRow> | null; readonly failures: ReadonlyMap<string, number>; readonly now: number },
): ActionView {
  const credential = action.credentialRef && context.credentials ? context.credentials.get(action.credentialRef) : undefined;
  const failures = context.failures.get(action.key) ?? 0;
  const health = actionHealth(action, credential, failures, context.now, context.credentials !== null);
  const credentialLook: Look | null = !action.credentialRef
    ? null
    : context.credentials === null
      ? { label: action.credentialRef, tone: 'neutral' }
      : credential
        ? credentialHealth(credential, context.now)
        : { label: 'Missing', tone: 'danger', icon: 'circle-alert' };
  const status = actionStatusLook(action.status);
  return {
    key: action.key,
    name: action.name,
    description: action.description,
    kind: action.kind,
    kindLabel: actionKindLabel(action.kind),
    status: action.status,
    statusLabel: status.label,
    credentialRef: action.credentialRef,
    credentialHeader: action.credentialHeader,
    credentialLook,
    health,
    healthLabel: health.label,
    openFailures: failures,
    timeoutMs: action.timeoutMs,
    // A transform makes no call, so there is nothing to give up on.
    timeoutLabel: action.kind === 'transform' ? '—' : timeoutText(action.timeoutMs),
    retryMax: action.retryMax,
    target: targetOf(action),
    config: redact(action.config),
    responseMapping: action.responseMapping,
    updatedAt: action.updatedAt,
  };
}

/** Open failures by action key: what the Actions table counts against each action. */
export function failuresByAction(rows: readonly Pick<ErrorQueueRow, 'actionKey' | 'status'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.actionKey || deliveryStatus(row.status) !== 'open') continue;
    counts.set(row.actionKey, (counts.get(row.actionKey) ?? 0) + 1);
  }
  return counts;
}

/* =========================================================================
 * Webhooks
 * ====================================================================== */

export interface WebhookView extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly eventsLabel: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly failureCount: number;
  readonly health: Look;
}

export function webhookHealth(row: Pick<WebhookRow, 'status' | 'failureCount'>): Look {
  if (row.status !== 'active') return { label: words(row.status), tone: 'danger', icon: 'circle-alert' };
  // Failing now, not about to: `danger` (D5, A7 §2.9).
  if (row.failureCount > 0) return { label: `${plural(row.failureCount, 'delivery', 'deliveries')} failing`, tone: 'danger', icon: 'circle-alert' };
  return { label: 'Delivering', tone: 'success' };
}

export function webhookView(row: WebhookRow): WebhookView {
  const shown = row.eventTypes.slice(0, 2).join(', ');
  const more = row.eventTypes.length - 2;
  const health = webhookHealth(row);
  return {
    id: row.id,
    name: row.name,
    url: redact(row.url) as string,
    events: row.eventTypes,
    eventsLabel: more > 0 ? `${shown} and ${more} more` : shown,
    status: row.status,
    statusLabel: health.label,
    failureCount: row.failureCount,
    health,
  };
}

/** A webhook URL the API will take: absolute http(s); the API insists on https in production. */
export function webhookUrlProblem(url: string): string | null {
  const value = url.trim();
  if (value === '') return 'Enter the address to send events to.';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'Use an https:// address.';
    return null;
  } catch {
    return 'Enter a full address, starting https://.';
  }
}

/* =========================================================================
 * The summary above the tabs
 * ====================================================================== */

export interface IntegrationsHealth {
  readonly deliveries?: { readonly open: number; readonly capped: boolean };
  readonly actions?: { readonly live: number; readonly draft: number; readonly attention: number };
  readonly credentials?: { readonly total: number; readonly expired: number; readonly soon: number; readonly rewrap: number };
}

/** The credentials line: "1 expired · 2 expire within 30 days", or "All 4 healthy". */
export function credentialsSummary(counts: NonNullable<IntegrationsHealth['credentials']>): { readonly text: string; readonly tone: 'default' | 'attention' | 'critical' } {
  if (counts.total === 0) return { text: 'None stored', tone: 'default' };
  const parts: string[] = [];
  if (counts.expired > 0) parts.push(`${counts.expired} expired`);
  if (counts.soon > 0) parts.push(`${counts.soon} expiring soon`);
  if (counts.rewrap > 0) parts.push(`${counts.rewrap} to re-encrypt`);
  if (parts.length === 0) return { text: counts.total === 1 ? 'Healthy' : `All ${counts.total} healthy`, tone: 'default' };
  return { text: parts.join(' · '), tone: counts.expired > 0 ? 'critical' : 'attention' };
}

export function countCredentials(rows: readonly Pick<CredentialRow, 'expiresAt' | 'needsRewrap'>[], now: number): NonNullable<IntegrationsHealth['credentials']> {
  let expired = 0;
  let soon = 0;
  let rewrap = 0;
  for (const row of rows) {
    const state = expiryLook(row.expiresAt, now).state;
    if (state === 'expired') expired += 1;
    else if (state === 'soon') soon += 1;
    if (row.needsRewrap) rewrap += 1;
  }
  return { total: rows.length, expired, soon, rewrap };
}
