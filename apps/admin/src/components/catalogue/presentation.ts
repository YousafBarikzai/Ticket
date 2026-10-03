import type { FormDefinition } from '@itsm/contracts/forms';
import { PRIORITY_LOOK as SHARED_PRIORITY_LOOK, type IconName, type Tone } from '@itsm/ui';
import { countQuestions, fromDocument } from './questions.js';

/**
 * Services & requests in words (SPEC §6.1): what state a request type or a
 * form is in, what its questions are, and the counts the header shows.
 *
 * Pure and server-safe — the server pages build the rows with it and the
 * client views word things with it, so the table and the sheet never
 * disagree about whether something is live.
 */

/* =========================================================================
 * The rows the views are handed (serialisable)
 * ====================================================================== */

export interface PersonRefView {
  readonly id: string;
  readonly name: string;
}

export interface ServiceView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly ownerId: string | null;
  /** The owner by name, when the directory could say. */
  readonly owner: PersonRefView | null;
  readonly groupId: string | null;
  readonly teamName: string | null;
}

export type FormState = 'draft' | 'live' | 'changes';

export interface FormView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  /**
   * The record's version. The API starts a new form at 1 and its first
   * publish makes 2, so whether a form is live comes from `status`, never
   * from this number.
   */
  readonly version: number;
  readonly state: FormState;
  readonly document: FormDefinition;
  readonly questionCount: number;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export type RequestTypeState = 'draft' | 'live' | 'changes' | 'retired';

/** What a request type asks: nothing, a form of its own, or a form it shares. */
export type QuestionsSource =
  | { readonly kind: 'none' }
  | { readonly kind: 'own'; readonly formKey: string; readonly count: number; readonly formState: FormState; readonly version: number; readonly attached: boolean }
  | { readonly kind: 'form'; readonly formKey: string; readonly name: string; readonly count: number; readonly formState: FormState | null; readonly version: number };

export interface RequestTypeView extends Record<string, unknown> {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly serviceId: string;
  readonly serviceKey: string | null;
  readonly serviceName: string | null;
  readonly priority: string;
  readonly status: string;
  readonly state: RequestTypeState;
  /** The form the portal renders today (`formKey`), or null. */
  readonly formKey: string | null;
  readonly questions: QuestionsSource;
  /** "System access request · v3", "5 questions · not live yet", "No questions". */
  readonly questionsLabel: string;
  readonly groupId: string | null;
  readonly teamName: string | null;
  /** Who may raise it: null for everyone. */
  readonly entitlement: unknown;
  readonly sortOrder: number;
  readonly publishedAt: string | null;
}

/* =========================================================================
 * Forms
 * ====================================================================== */

/**
 * Whether a live form's stored document differs from what was published.
 *
 * Publishing stamps the document with the form's version; saving a draft
 * from this console writes it without one. So a published form whose
 * document does not carry its own version has changes nobody has published.
 */
export function hasUnpublishedChanges(row: { readonly status: string; readonly version: number; readonly document: unknown }): boolean {
  if (row.status !== 'published') return false;
  const stamped = (row.document as { version?: unknown } | null)?.version;
  return stamped !== row.version;
}

export function formState(row: { readonly status: string; readonly version: number; readonly document: unknown }): FormState {
  if (row.status !== 'published') return 'draft';
  return hasUnpublishedChanges(row) ? 'changes' : 'live';
}

export const FORM_STATE_LOOK: Readonly<Record<FormState, { readonly label: string; readonly tone: Tone; readonly icon: IconName }>> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'circle-dashed' },
  live: { label: 'Live', tone: 'success', icon: 'circle-check' },
  // Work in progress, not a risk: `info`, so amber stays SLA risk and due soon (D5, A7 §2.9).
  changes: { label: 'Unpublished changes', tone: 'info', icon: 'pencil' },
};

/** "Live · v3", "Draft", "Unpublished changes". */
export function formStateLabel(state: FormState, version: number): string {
  return state === 'live' ? `Live · v${version}` : FORM_STATE_LOOK[state].label;
}

export function formView(row: {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly document: FormDefinition;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}): FormView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    state: formState(row),
    document: row.document,
    questionCount: countQuestions(fromDocument(row.document)),
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

/* =========================================================================
 * Request types
 * ====================================================================== */

export const REQUEST_STATE_LOOK: Readonly<Record<RequestTypeState, { readonly label: string; readonly tone: Tone; readonly icon: IconName }>> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'circle-dashed' },
  live: { label: 'Live', tone: 'success', icon: 'circle-check' },
  changes: { label: 'Unpublished changes', tone: 'info', icon: 'pencil' },
  retired: { label: 'Retired', tone: 'neutral', icon: 'archive' },
};

/**
 * A request type's default priority as a pill, in the shared priority tones
 * (D5): P1 danger, P2 `high` orange — never amber, which is SLA risk — and
 * P3 and P4 neutral, with the words always shown.
 */
export const PRIORITY_LOOK: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = Object.fromEntries(
  (['P1', 'P2', 'P3', 'P4'] as const).map((key) => [key, { label: `${key} · ${SHARED_PRIORITY_LOOK[key].words}`, tone: SHARED_PRIORITY_LOOK[key].tone }]),
);

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

const plural = (count: number, one: string, other: string): string => `${count} ${count === 1 ? one : other}`;

/**
 * Where a request type's questions come from.
 *
 * A request type's *own* questions are the form that shares its key — the
 * convention the seeded catalogue already follows (`system-access`), and
 * the one the request-type sheet keeps: the form is created as a draft
 * beside the request type and attached when it is first published (the API
 * refuses to attach a form nobody has published).
 */
export function questionsSource(
  type: { readonly key: string; readonly formKey: string | null },
  forms: ReadonlyMap<string, FormView>,
): QuestionsSource {
  const own = forms.get(type.key);
  if (type.formKey && type.formKey !== type.key) {
    const form = forms.get(type.formKey);
    return {
      kind: 'form',
      formKey: type.formKey,
      name: form?.name ?? type.formKey,
      count: form?.questionCount ?? 0,
      formState: form?.state ?? null,
      version: form?.version ?? 0,
    };
  }
  if (own) return { kind: 'own', formKey: own.key, count: own.questionCount, formState: own.state, version: own.version, attached: type.formKey === own.key };
  if (type.formKey) return { kind: 'form', formKey: type.formKey, name: type.formKey, count: 0, formState: null, version: 0 };
  return { kind: 'none' };
}

export function questionsLabel(source: QuestionsSource): string {
  switch (source.kind) {
    case 'none':
      return 'No questions';
    case 'own': {
      const count = source.count === 0 ? 'No questions yet' : plural(source.count, 'question', 'questions');
      if (source.formState === 'draft') return `${count} · not live yet`;
      if (source.formState === 'changes') return `${count} · unpublished changes`;
      return `${count} · v${source.version}`;
    }
    case 'form':
      return source.version > 0 ? `${source.name} · v${source.version}` : source.name;
  }
}

export function requestTypeState(status: string, source: QuestionsSource): RequestTypeState {
  if (status === 'retired') return 'retired';
  if (status !== 'published') return 'draft';
  if (source.kind === 'own' && (source.formState === 'changes' || (source.formState === 'draft' && !source.attached))) return 'changes';
  return 'live';
}

/** "12 live · 3 drafts" — the header's meta. */
export function catalogueMeta(types: readonly { readonly state: RequestTypeState }[]): string | undefined {
  if (types.length === 0) return undefined;
  const live = types.filter((type) => type.state === 'live' || type.state === 'changes').length;
  const drafts = types.filter((type) => type.state === 'draft').length;
  const parts = [`${live} live`];
  if (drafts > 0) parts.push(plural(drafts, 'draft', 'drafts'));
  return parts.join(' · ');
}

/** The request types that use a form, by name. */
export function usedBy(formKey: string, types: readonly { readonly key: string; readonly name: string; readonly formKey: string | null }[]): { key: string; name: string }[] {
  return types.filter((type) => type.formKey === formKey).map((type) => ({ key: type.key, name: type.name }));
}

/** An empty form document, for a new form started from blank. */
export function blankDocument(key: string): FormDefinition {
  return { key, version: 0, schema: { type: 'object', properties: {} }, ui: { elements: [] } };
}

/** A request type's services, for the left-hand list: every service with its counts. */
export interface ServiceCount {
  readonly key: string;
  readonly total: number;
  readonly live: number;
  readonly drafts: number;
}

export function serviceCounts(types: readonly RequestTypeView[]): Map<string, ServiceCount> {
  const out = new Map<string, ServiceCount>();
  for (const type of types) {
    const key = type.serviceKey ?? '';
    const now = out.get(key) ?? { key, total: 0, live: 0, drafts: 0 };
    out.set(key, {
      key,
      total: now.total + 1,
      live: now.live + (type.state === 'live' || type.state === 'changes' ? 1 : 0),
      drafts: now.drafts + (type.state === 'draft' ? 1 : 0),
    });
  }
  return out;
}
