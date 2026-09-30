'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  FormErrorSummary,
  FormField,
  FormSection,
  InlineAlert,
  Input,
  notify,
  SegmentedControl,
  Select,
  StatusPill,
  Textarea,
  useItsm,
  type ConfirmSpec,
} from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import type { FormDefinition } from '@itsm/ui/forms';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { JsonView } from '../JsonView.js';
import { KeyField } from '../KeyField.js';
import { FormPreview } from './FormPreview.js';
import {
  PRIORITIES,
  PRIORITY_LOOK,
  REQUEST_STATE_LOOK,
  usedBy,
  type FormView,
  type RequestTypeView,
  type ServiceView,
} from './presentation.js';
import { QuestionsEditor } from './QuestionsEditor.js';
import { checkQuestions, countQuestions, EMPTY_DRAFT, fromDocument, previewDefinition, sameDocument, toDocument, type QuestionsDraft } from './questions.js';
import { runSteps } from './runSteps.js';
import { planSave, publishesQuestions, type QuestionsMode, type Step, type TypeFields } from './save.js';

/**
 * The one request-type sheet (SPEC §6.1, §6.4): everything it takes for a
 * request to be on the portal, with the portal's own view of it beside the
 * fields — where there used to be a service form, a request-type form, a
 * separate form document and a publish form.
 *
 * - **About**: name (its key made from it, permanent once saved), service,
 *   a one-line summary for the portal tile, a description.
 * - **Questions**: none; its own questions, edited right here; or an
 *   existing published form, shared with other request types.
 * - **Priority** a ticket raised from it starts at; **Advanced**: the team
 *   it goes to and who may ask for it.
 *
 * A draft saves as a draft and **Publish** puts the request type *and its
 * questions* live after one confirmation. A live item says so and saves in
 * place; changed questions on a live item are published with it, after a
 * confirmation, because that is what "changes appear immediately" means.
 */

export type SheetTarget =
  | { readonly kind: 'new'; readonly serviceKey?: string; readonly from?: RequestTypeView }
  | { readonly kind: 'edit'; readonly type: RequestTypeView };

export interface RequestTypeSheetProps {
  readonly target: SheetTarget | null;
  /** A drawer link that named a request type that does not exist. */
  readonly missing?: boolean;
  readonly onClose: () => void;
  readonly services: readonly ServiceView[];
  readonly types: readonly RequestTypeView[];
  /** Every form, or null when this person cannot read forms. */
  readonly forms: readonly FormView[] | null;
  readonly teams: readonly { readonly id: string; readonly name: string }[] | null;
  /** May write forms (`catalogue.form.manage`): own questions are editable. */
  readonly canEditQuestions: boolean;
  readonly portalOrigin?: string;
}

export function RequestTypeSheet(props: RequestTypeSheetProps): ReactNode {
  const { target, missing, onClose } = props;
  const [dirty, setDirty] = useState(false);
  const title =
    target?.kind === 'edit' ? target.type.name : target?.kind === 'new' && target.from ? `Duplicate ${target.from.name}` : target ? 'New request type' : 'Request type';
  const status = target?.kind === 'edit' ? REQUEST_STATE_LOOK[target.type.state] : null;
  const close = (): void => {
    setDirty(false);
    onClose();
  };

  return (
    <Sheet
      open={target !== null || missing === true}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="full"
      title={title}
      {...(target?.kind === 'new' ? { description: 'What people can ask for in the portal, and what they’re asked.' } : {})}
      {...(status ? { headerMeta: <StatusPill size="sm" tone={status.tone} icon={status.icon} label={status.label} /> } : {})}
      dirty={dirty}
    >
      {target ? (
        <RequestTypeForm
          key={target.kind === 'edit' ? `edit:${target.type.key}` : `new:${target.from?.key ?? ''}:${target.serviceKey ?? ''}`}
          {...props}
          target={target}
          onDirtyChange={setDirty}
          onDone={close}
        />
      ) : (
        <div className="app-TypeSheet__missing">
          <InlineAlert tone="warning">That request type no longer exists. It may have been renamed or removed since the link was shared.</InlineAlert>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </div>
      )}
    </Sheet>
  );
}

const FIELD_IDS: Readonly<Record<string, string>> = {
  name: 'type-sheet-name',
  key: 'type-sheet-key',
  serviceKey: 'type-sheet-service',
  shortSummary: 'type-sheet-summary',
  description: 'type-sheet-description',
  questions: 'type-sheet-questions',
  formKey: 'type-sheet-questions',
};

function initialMode(type: RequestTypeView | undefined, forms: readonly FormView[] | null): { mode: QuestionsMode; formKey: string } {
  if (!type) return { mode: forms ? 'own' : 'none', formKey: '' };
  const source = type.questions;
  if (source.kind === 'own') return { mode: 'own', formKey: '' };
  if (source.kind === 'form') return { mode: 'form', formKey: source.formKey };
  return { mode: 'none', formKey: '' };
}

function RequestTypeForm({
  target,
  services,
  types,
  forms,
  teams,
  canEditQuestions,
  portalOrigin,
  onDirtyChange,
  onDone,
}: RequestTypeSheetProps & { readonly target: SheetTarget; readonly onDirtyChange: (dirty: boolean) => void; readonly onDone: () => void }): ReactNode {
  const existing = target.kind === 'edit' ? target.type : null;
  const source = target.kind === 'edit' ? target.type : (target.from ?? undefined);
  const formsByKey = useMemo(() => new Map((forms ?? []).map((form) => [form.key, form])), [forms]);
  const ownForm = existing ? (formsByKey.get(existing.key) ?? null) : null;
  const sourceOwn = source ? (formsByKey.get(source.key) ?? null) : null;
  const online = useOnline();
  const formId = useId();
  const { Link } = useItsm();

  const start = initialMode(source, forms);
  const [fields, setFields] = useState<TypeFields>(() => ({
    name: target.kind === 'new' && target.from ? `${target.from.name} (copy)` : (source?.name ?? ''),
    key: existing?.key ?? '',
    serviceKey: source?.serviceKey ?? (target.kind === 'new' ? (target.serviceKey ?? services[0]?.key ?? '') : ''),
    summary: source?.summary ?? '',
    description: source?.description ?? '',
    priority: source?.priority ?? 'P3',
    groupId: source?.groupId ?? '',
    questionsMode: canEditQuestions || start.mode !== 'own' || ownForm ? start.mode : 'none',
    formKey: start.formKey,
  }));
  // The stored questions at the moment the sheet opened: the yardstick for "changed".
  const [baseline] = useState<QuestionsDraft>(() => (ownForm ? fromDocument(ownForm.document, { published: ownForm.status === 'published' }) : EMPTY_DRAFT));
  const [questions, setQuestions] = useState<QuestionsDraft>(() =>
    ownForm ? baseline : target.kind === 'new' && sourceOwn ? fromDocument(sourceOwn.document) : EMPTY_DRAFT,
  );
  const [keyState, setKeyState] = useState<KeyState>(existing ? 'ok' : 'empty');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [confirm, setConfirm] = useState<{ readonly spec: ConfirmSpec; readonly steps: Step[]; readonly intent: 'save' | 'publish' } | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  const touch = (patch: Partial<TypeFields>): void => {
    setFields((current) => ({ ...current, ...patch }));
    onDirtyChange(true);
  };

  const key = existing?.key ?? fields.key;
  const live = existing?.status === 'published';
  const issues = fields.questionsMode === 'own' ? checkQuestions(questions) : [];
  const questionsChanged = fields.questionsMode === 'own' && (!ownForm || !sameDocument(questions, baseline, key));
  const sharedWith = ownForm ? usedBy(ownForm.key, types).filter((type) => type.key !== key) : [];
  const publishedForms = (forms ?? []).filter((form) => form.status === 'published' && form.key !== key);
  const chosenForm = fields.formKey ? formsByKey.get(fields.formKey) : undefined;
  const takenKeys = useMemo(() => {
    const keys = types.map((type) => type.key);
    // A request type's own questions are the form that shares its key, so a new key must be free among forms too.
    if (fields.questionsMode === 'own') keys.push(...(forms ?? []).map((form) => form.key));
    return keys;
  }, [types, forms, fields.questionsMode]);

  const mutation = useMutation((steps: readonly Step[]) => runSteps(steps), { failure: live ? 'Couldn’t save the changes' : 'Couldn’t save the request type' });

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!fields.name.trim()) found.name = 'Enter a name for the request type.';
    else if (!existing && keyState !== 'ok') {
      found.key =
        keyState === 'taken'
          ? 'Another request type or form already uses this key. Edit the key or change the name.'
          : keyState === 'reserved'
            ? 'That key is reserved. Edit the key.'
            : 'Edit the key by hand: this name can’t make one.';
    }
    if (!fields.serviceKey) found.serviceKey = 'Choose the service this belongs to.';
    if (fields.summary.length > 200) found.shortSummary = 'Keep the summary to 200 characters.';
    if (fields.description.length > 2000) found.description = 'Keep the description to 2,000 characters.';
    if (fields.questionsMode === 'form' && !fields.formKey) found.questions = 'Choose the form whose questions to ask, or pick another option.';
    if (fields.questionsMode === 'own' && issues.length > 0) found.questions = issues.length === 1 ? issues[0]!.message : `${issues.length} questions need attention.`;
    return found;
  };

  const plan = (intent: 'save' | 'publish'): Step[] =>
    planSave({
      fields,
      existing: existing
        ? {
            key: existing.key,
            name: existing.name,
            serviceKey: existing.serviceKey,
            summary: existing.summary,
            description: existing.description,
            priority: existing.priority,
            groupId: existing.groupId,
            formKey: existing.formKey,
            status: existing.status,
          }
        : null,
      ownForm: ownForm ? { key: ownForm.key, name: ownForm.name, status: ownForm.status, unpublished: ownForm.state !== 'live' } : null,
      document: fields.questionsMode === 'own' ? toDocument(questions, key) : null,
      questionsChanged,
      intent,
    });

  const execute = async (steps: readonly Step[], intent: 'save' | 'publish'): Promise<boolean> => {
    const result = await mutation.run(steps);
    if (result.ok) {
      const name = fields.name.trim();
      if (intent === 'publish') {
        notify(`${name} is live`, {
          tone: 'success',
          ...(portalOrigin ? { action: { label: 'Open portal', onClick: () => window.location.assign(`${portalOrigin}/catalogue/${encodeURIComponent(key)}`) } } : {}),
        });
      } else notify(live ? `${name} saved` : existing ? `${name} saved as a draft` : `${name} added as a draft`, { tone: 'success' });
      onDirtyChange(false);
      onDone();
      return true;
    }
    const problem = result.problem;
    if (problem.status === 409) setErrors({ key: 'Another request type or form already uses this key. Edit the key or change the name.' });
    else if (problem.status === 422) {
      const mapped: Record<string, string> = {};
      for (const [path, message] of Object.entries(problem.fieldErrors ?? {})) {
        const head = path.split('.')[0]!;
        const field = head in FIELD_IDS ? head : 'questions';
        if (!mapped[field]) mapped[field] = message;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
    }
    setAttempt((value) => value + 1);
    return false;
  };

  const submit = (intent: 'save' | 'publish'): void => {
    const found = validate();
    setErrors(found);
    setShowIssues(true);
    if (Object.keys(found).length > 0) {
      setAttempt((value) => value + 1);
      return;
    }
    const steps = plan(intent);
    if (steps.length === 0) {
      notify('Nothing to save: no changes', { tone: 'info' });
      onDirtyChange(false);
      onDone();
      return;
    }
    const questionsGoLive = publishesQuestions(steps);
    const count = countQuestions(questions);
    const consequences = [
      ...(questionsGoLive ? [{ label: `Its ${count === 1 ? 'question goes' : `${count} questions go`} live${ownForm && ownForm.status === 'published' ? ` as version ${ownForm.version + 1}` : ''}` }] : []),
      ...(questionsGoLive ? sharedWith.map((type) => ({ label: `Also changes the questions of ${type.name}`, href: `/catalogue?open=request-type:${encodeURIComponent(type.key)}` })) : []),
    ];
    if (intent === 'publish') {
      setConfirm({
        intent,
        steps,
        spec: {
          title: `Publish ${fields.name.trim()}?`,
          body: 'Requesters will see this in the portal immediately.',
          confirmLabel: 'Publish',
          ...(consequences.length > 0 ? { consequences } : {}),
        },
      });
      return;
    }
    if (live && questionsGoLive) {
      setConfirm({
        intent,
        steps,
        spec: {
          title: 'Publish the new questions?',
          body: 'This request type is live, so requesters see the new questions immediately. People who already started keep the version they opened.',
          confirmLabel: 'Save and publish',
          ...(consequences.length > 0 ? { consequences } : {}),
        },
      });
      return;
    }
    void execute(steps, intent);
  };

  const needsFormPermission = !canEditQuestions && fields.questionsMode === 'own' && (questionsChanged || (ownForm?.state ?? 'draft') !== 'live');
  const offline = online ? undefined : 'You’re offline — changes can’t be saved.';
  const gate = offline ?? (needsFormPermission ? 'Publishing its questions needs Manage forms.' : undefined);

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: FIELD_IDS[field] ?? '', message }));
  const serviceName = services.find((service) => service.key === fields.serviceKey)?.name ?? null;
  const definition: FormDefinition =
    fields.questionsMode === 'own'
      ? previewDefinition(questions, key || 'preview', fields.name)
      : fields.questionsMode === 'form' && chosenForm
        ? chosenForm.document
        : ({ key: 'none', version: 0, schema: { type: 'object', properties: {} }, ui: { elements: [] } } as FormDefinition);
  const entitlement = existing?.entitlement ?? null;

  return (
    <div className="app-TypeSheet" data-view={view}>
      <div className="app-TypeSheet__switch">
        <SegmentedControl
          label="Show"
          mode="value"
          size="sm"
          value={view}
          onValueChange={(value) => setView(value === 'preview' ? 'preview' : 'edit')}
          options={[
            { value: 'edit', label: 'Edit', icon: 'pencil' },
            { value: 'preview', label: 'Preview', icon: 'eye' },
          ]}
        />
      </div>
      <form
        id={formId}
        className="app-TypeSheet__form"
        noValidate
        aria-label={existing ? `Edit ${existing.name}` : 'New request type'}
        onSubmit={(event) => {
          event.preventDefault();
          submit('save');
        }}
      >
        {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}

        <FormSection title="About" headingLevel={3}>
          <FormField label="Name" required hint="What a requester clicks, like “Order a laptop”." id={FIELD_IDS.name!} counter={{ max: 120 }} {...(errors.name ? { error: errors.name } : {})}>
            <Input name="name" value={fields.name} maxLength={120} autoComplete="off" onChange={(event) => touch({ name: event.currentTarget.value })} />
          </FormField>
          <div id={FIELD_IDS.key} tabIndex={-1}>
            <KeyField
              source={fields.name}
              rule="slug"
              value={key}
              onChange={(next) => setFields((current) => ({ ...current, key: next }))}
              onStateChange={setKeyState}
              taken={takenKeys}
              noun="request type or form"
              locked={existing !== null}
            />
            {errors.key ? <p className="app-FieldError">{errors.key}</p> : null}
          </div>
          <FormField label="Service" required id={FIELD_IDS.serviceKey!} {...(errors.serviceKey ? { error: errors.serviceKey } : {})}>
            <Select
              value={fields.serviceKey}
              placeholder="Choose a service"
              options={services.map((service) => ({ value: service.key, label: service.name }))}
              onChange={(event) => touch({ serviceKey: event.currentTarget.value })}
            />
          </FormField>
          <FormField
            label="Summary"
            optional
            hint="One line under the name on the portal."
            id={FIELD_IDS.shortSummary!}
            counter={{ max: 200 }}
            {...(errors.shortSummary ? { error: errors.shortSummary } : {})}
          >
            <Input value={fields.summary} maxLength={200} onChange={(event) => touch({ summary: event.currentTarget.value })} />
          </FormField>
          <FormField label="Description" optional id={FIELD_IDS.description!} counter={{ max: 2000 }} {...(errors.description ? { error: errors.description } : {})}>
            <Textarea rows={3} value={fields.description} maxLength={2000} onChange={(event) => touch({ description: event.currentTarget.value })} />
          </FormField>
        </FormSection>

        <FormSection title="Questions" headingLevel={3} description="What the requester is asked when they choose this.">
          <div id={FIELD_IDS.questions} tabIndex={-1} className="app-TypeSheet__questions">
            {forms === null ? (
              <p className="app-TypeSheet__note">
                {existing?.questionsLabel ?? 'No questions'}. Changing the questions needs <strong>Read forms</strong>.
              </p>
            ) : (
              <>
                <SegmentedControl
                  label="Questions"
                  mode="value"
                  size="sm"
                  value={fields.questionsMode}
                  onValueChange={(value) => touch({ questionsMode: value as QuestionsMode })}
                  options={[
                    { value: 'none', label: 'None' },
                    ...(canEditQuestions || ownForm ? [{ value: 'own', label: 'Its own' }] : []),
                    ...(publishedForms.length > 0 || fields.questionsMode === 'form' ? [{ value: 'form', label: 'A shared form' }] : []),
                  ]}
                />
                {fields.questionsMode === 'none' ? <p className="app-TypeSheet__note">The requester gives a title and a description, nothing more.</p> : null}
                {fields.questionsMode === 'own' ? (
                  <>
                    {sharedWith.length > 0 ? (
                      <InlineAlert tone="warning">
                        These questions are also asked by {sharedWith.map((type) => type.name).join(', ')}. Changes apply there too.
                      </InlineAlert>
                    ) : null}
                    {!canEditQuestions ? <p className="app-TypeSheet__note">Changing these questions needs <strong>Manage forms</strong>.</p> : null}
                    <QuestionsEditor
                      draft={questions}
                      onChange={(next) => {
                        setQuestions(next);
                        onDirtyChange(true);
                      }}
                      layout="inline"
                      readOnly={!canEditQuestions}
                      issues={showIssues ? issues : []}
                      headingLevel={4}
                    />
                  </>
                ) : null}
                {fields.questionsMode === 'form' ? (
                  <>
                    <FormField label="Form" required hint="Only published forms can be used. Their questions are shared with every request type that uses them.">
                      <Select
                        value={fields.formKey}
                        placeholder="Choose a form"
                        options={publishedForms.map((form) => ({ value: form.key, label: `${form.name} · v${form.version}` }))}
                        onChange={(event) => touch({ formKey: event.currentTarget.value })}
                      />
                    </FormField>
                    {chosenForm ? (
                      <p className="app-TypeSheet__note">
                        {chosenForm.questionCount === 1 ? '1 question' : `${chosenForm.questionCount} questions`}.{' '}
                        <Link href={`/catalogue/forms/${encodeURIComponent(chosenForm.key)}`}>Edit {chosenForm.name}</Link> to change them for everyone who uses it.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
            {errors.questions ? <p className="app-FieldError">{errors.questions}</p> : null}
          </div>
        </FormSection>

        <FormSection title="Priority" headingLevel={3} description="Where a ticket raised from this starts. Rules and the desk can change it later.">
          <SegmentedControl
            label="Default priority"
            mode="value"
            value={fields.priority}
            onValueChange={(value) => touch({ priority: value })}
            options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
          />
          <p className="app-TypeSheet__note">{PRIORITY_LOOK[fields.priority]?.label}</p>
        </FormSection>

        <FormSection title="Advanced" headingLevel={3} collapsible defaultOpen={Boolean(source?.groupId) || entitlement !== null}>
          {teams ? (
            <FormField label="Assignment team" optional hint="Where tickets from this go. Without one, they go to the service’s team.">
              <Select
                value={fields.groupId}
                options={[{ value: '', label: 'The service’s team' }, ...teams.map((team) => ({ value: team.id, label: team.name }))]}
                onChange={(event) => touch({ groupId: event.currentTarget.value })}
              />
            </FormField>
          ) : null}
          <div className="app-TypeSheet__who">
            <p className="app-TypeSheet__whoLabel">Who can request it</p>
            {entitlement ? (
              <>
                <p className="app-TypeSheet__note">
                  <strong>Custom rule.</strong> Set outside this console; it’s kept as it is when you save.
                </p>
                <JsonView value={entitlement} label="Who can request it" />
              </>
            ) : (
              <p className="app-TypeSheet__note">
                <strong>Everyone</strong> who can use the portal.
              </p>
            )}
          </div>
        </FormSection>
      </form>

      <aside className="app-TypeSheet__preview" aria-label="Preview in the portal">
        <h3 className="app-TypeSheet__previewTitle">In the portal</h3>
        <FormPreview
          definition={definition}
          title={fields.name.trim()}
          tile={{ name: fields.name.trim(), summary: fields.summary.trim() || null, service: serviceName }}
          headingLevel={3}
        />
      </aside>

      <div className="app-TypeSheet__footer">
        {live ? <p className="app-TypeSheet__liveNote">Live item — changes appear immediately.</p> : <span />}
        <div className="app-TypeSheet__actions">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          {live ? (
            <Button variant="primary" type="submit" form={formId} loading={mutation.pending} {...(gate ? { disabledReason: gate } : {})}>
              Save changes
            </Button>
          ) : (
            <>
              <Button variant="secondary" type="submit" form={formId} loading={mutation.pending && confirm === null} {...(offline ? { disabledReason: offline } : {})}>
                Save draft
              </Button>
              <Button variant="primary" onClick={() => submit('publish')} {...(gate ? { disabledReason: gate } : {})}>
                Publish
              </Button>
            </>
          )}
        </div>
      </div>

      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
          spec={confirm.spec}
          onConfirm={async () => {
            const ok = await execute(confirm.steps, confirm.intent);
            setConfirm(null);
            if (!ok) return;
          }}
        />
      ) : null}
    </div>
  );
}
