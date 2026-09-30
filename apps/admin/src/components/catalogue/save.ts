import type { FormDocument } from './questions.js';

/**
 * What saving the request-type sheet sends, and in which order (SPEC §6.4
 * "Catalogue item live": one sheet, one confirm, where there were three
 * forms and a separate form document).
 *
 * The API makes the order matter. A request type can only point at a form
 * somebody has published (`createRequestType`/`updateRequestType` refuse
 * anything else), so a request type with questions of its own is saved in
 * three moves: its form first (created or changed as a draft), the form
 * published when the questions are to go live, and only then the request
 * type, pointing at it — and published last.
 *
 * Kept pure so the plan is a tested function rather than a sequence of
 * awaits in a component; the sheet runs the steps one after another and
 * stops at the first that fails, and running the same plan again after a
 * failure is safe — every step is idempotent or is skipped once done.
 */

export type QuestionsMode = 'none' | 'own' | 'form';

export interface TypeFields {
  readonly name: string;
  readonly key: string;
  readonly serviceKey: string;
  readonly summary: string;
  readonly description: string;
  readonly priority: string;
  /** A team id, or '' for the service's own team. */
  readonly groupId: string;
  readonly questionsMode: QuestionsMode;
  /** The shared form chosen, when `questionsMode` is `form`. */
  readonly formKey: string;
}

export interface ExistingType {
  readonly key: string;
  readonly name: string;
  readonly serviceKey: string | null;
  readonly summary: string | null;
  readonly description: string | null;
  readonly priority: string;
  readonly groupId: string | null;
  readonly formKey: string | null;
  readonly status: string;
}

export interface OwnForm {
  readonly key: string;
  readonly name: string;
  readonly status: string;
  /** Published with changes since, or never published. */
  readonly unpublished: boolean;
}

export type Step =
  | { readonly kind: 'createForm'; readonly input: { key: string; name: string; document: FormDocument } }
  | { readonly kind: 'updateForm'; readonly key: string; readonly patch: { name?: string; document?: FormDocument } }
  | { readonly kind: 'publishForm'; readonly key: string }
  | { readonly kind: 'createType'; readonly input: Record<string, unknown> }
  | { readonly kind: 'updateType'; readonly key: string; readonly patch: Record<string, unknown> }
  | { readonly kind: 'publishType'; readonly key: string };

export interface PlanInput {
  readonly fields: TypeFields;
  readonly existing: ExistingType | null;
  /** The form that shares the request type's key, when it exists. */
  readonly ownForm: OwnForm | null;
  /** The own questions as a document, when `questionsMode` is `own`. */
  readonly document: FormDocument | null;
  /** The own questions differ from what is stored. */
  readonly questionsChanged: boolean;
  /** `save`: a draft stays a draft, a live item stays live. `publish`: a draft goes live. */
  readonly intent: 'save' | 'publish';
}

const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export function planSave({ fields, existing, ownForm, document, questionsChanged, intent }: PlanInput): Step[] {
  const steps: Step[] = [];
  const key = existing?.key ?? fields.key;
  const live = existing?.status === 'published';
  const goingLive = intent === 'publish' || live;

  let formKey: string | null = null;
  if (fields.questionsMode === 'form') formKey = fields.formKey || null;
  // "Its own questions" with none written yet is no questions: no empty form is made for it.
  const nothingYet = fields.questionsMode === 'own' && ownForm === null && (document?.ui.elements.length ?? 0) === 0;
  if (fields.questionsMode === 'own' && document && !nothingYet) {
    const name = fields.name.trim();
    if (!ownForm) steps.push({ kind: 'createForm', input: { key, name, document } });
    // The form keeps its own name once it exists: renaming the request type
    // is not a reason to rename a form someone may have named on purpose.
    else if (questionsChanged) steps.push({ kind: 'updateForm', key, patch: { document } });
    const hasLiveVersion = ownForm !== null && ownForm.status === 'published';
    const pending = ownForm === null || ownForm.unpublished || questionsChanged;
    // Questions go live with the request type: when it is published, and
    // straight away on an item that is already live.
    if (goingLive && pending) steps.push({ kind: 'publishForm', key });
    // Point at the form once it has a published version to point at.
    formKey = (goingLive && pending) || hasLiveVersion ? key : null;
  }

  if (!existing) {
    steps.push({
      kind: 'createType',
      input: {
        key,
        serviceKey: fields.serviceKey,
        name: fields.name.trim(),
        priority: fields.priority,
        ...(text(fields.summary) ? { shortSummary: text(fields.summary) } : {}),
        ...(text(fields.description) ? { description: text(fields.description) } : {}),
        ...(fields.groupId ? { groupId: fields.groupId } : {}),
        ...(formKey ? { formKey } : {}),
      },
    });
  } else {
    const patch: Record<string, unknown> = {};
    if (fields.name.trim() !== existing.name) patch.name = fields.name.trim();
    if (fields.serviceKey && fields.serviceKey !== existing.serviceKey) patch.serviceKey = fields.serviceKey;
    if (text(fields.summary) !== (existing.summary ?? null)) patch.shortSummary = text(fields.summary);
    if (text(fields.description) !== (existing.description ?? null)) patch.description = text(fields.description);
    if (fields.priority !== existing.priority) patch.priority = fields.priority;
    if ((fields.groupId || null) !== (existing.groupId ?? null)) patch.groupId = fields.groupId || null;
    if (formKey !== (existing.formKey ?? null)) patch.formKey = formKey;
    if (Object.keys(patch).length > 0) steps.push({ kind: 'updateType', key, patch });
  }

  if (intent === 'publish' && !live) steps.push({ kind: 'publishType', key });
  return steps;
}

/** Whether a plan publishes a new version of the questions: the confirmation says so. */
export function publishesQuestions(steps: readonly Step[]): boolean {
  return steps.some((step) => step.kind === 'publishForm');
}
