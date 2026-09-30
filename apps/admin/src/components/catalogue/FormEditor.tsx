'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DescriptionList, InlineEdit, notify, SegmentedControl, StatusPill, useHotkey, useItsm, type ActionSpec, type Crumb } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { FormPreview } from './FormPreview.js';
import { FORM_STATE_LOOK, formStateLabel, type FormState, type FormView } from './presentation.js';
import { QuestionsEditor } from './QuestionsEditor.js';
import { checkQuestions, countQuestions, describeChanges, diffQuestions, fromDocument, lockKeys, previewDefinition, sameDocument, toDocument, type QuestionsDraft } from './questions.js';

/**
 * The form editor (SPEC §6.1, Appendix C "an administrator edits a form,
 * previews, publishes"): the questions down the middle, the selected
 * question's inspector beside them, and *Preview* for the requester's view
 * in a phone or desktop frame.
 *
 * - **Saving** writes the draft: a person filling the form in keeps seeing
 *   the published version until *Publish*. It saves by itself five seconds
 *   after the last change ("Saved · 12:04"), on ⌘S / Ctrl+S, and on *Save
 *   draft* — and never while a question has a problem, which is shown on
 *   the question instead.
 * - **Publish** asks first and says what changes: "3 questions added, 1
 *   removed · People who already started keep the version they opened", and
 *   which request types ask these questions.
 * - Going back to an earlier version needs the API's form history (A9),
 *   which is not there yet, so there is no History tab (D20: hidden, not
 *   disabled).
 */
export interface FormEditorProps {
  readonly form: FormView;
  readonly usedBy: readonly { readonly key: string; readonly name: string }[];
  readonly canManage: boolean;
  readonly canSeeRequestTypes: boolean;
  readonly breadcrumbs: readonly Crumb[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

const AUTOSAVE_MS = 5000;

type SaveStatus = { readonly kind: 'idle' } | { readonly kind: 'saving' } | { readonly kind: 'saved'; readonly at: Date } | { readonly kind: 'failed' };

export function FormEditor({ form, usedBy, canManage, canSeeRequestTypes, breadcrumbs, viewOnly }: FormEditorProps): ReactNode {
  const { locale, timeZone, Link } = useItsm();
  const online = useOnline();
  const published = form.status === 'published';
  const [initial] = useState(() => fromDocument(form.document, { published }));
  const [draft, setDraft] = useState<QuestionsDraft>(initial);
  const [saved, setSaved] = useState<QuestionsDraft>(initial);
  // The published questions, when they are known: what "3 questions added" counts from.
  const [livePublished, setLivePublished] = useState<QuestionsDraft | null>(form.state === 'live' ? initial : null);
  // `published`: has a live version. A new form's record starts at version 1 before its first publish, so the number alone can't say.
  const [state, setState] = useState<{ readonly state: FormState; readonly version: number; readonly published: boolean }>({
    state: form.state,
    version: form.version,
    published,
  });
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const issues = useMemo(() => checkQuestions(draft), [draft]);
  const dirty = !sameDocument(draft, saved, form.key);
  const latest = useRef(draft);
  latest.current = draft;

  const save = useMutation((document: ReturnType<typeof toDocument>) => api.configure.catalogue.updateForm(form.key, { document }), {
    failure: 'Couldn’t save the draft',
    refresh: false,
  });
  const publish = useMutation(
    async (document: ReturnType<typeof toDocument> | null) => {
      if (document) await api.configure.catalogue.updateForm(form.key, { document });
      return api.configure.catalogue.publishForm(form.key);
    },
    { failure: 'Couldn’t publish the form' },
  );
  const rename = useMutation((patch: Record<string, unknown>) => api.configure.catalogue.updateForm(form.key, patch), { failure: 'Couldn’t save the form’s details', refresh: false });

  const saveNow = useCallback(
    async (manual: boolean): Promise<boolean> => {
      const snapshot = latest.current;
      if (sameDocument(snapshot, saved, form.key)) {
        if (manual) notify('No changes to save', { tone: 'info' });
        return true;
      }
      if (checkQuestions(snapshot).length > 0) {
        setShowIssues(true);
        if (manual) notify('Fix the questions marked with problems first', { tone: 'warning' });
        return false;
      }
      setStatus({ kind: 'saving' });
      const result = await save.run(toDocument(snapshot, form.key));
      if (!result.ok) {
        setStatus({ kind: 'failed' });
        return false;
      }
      setSaved(snapshot);
      setState((current) => ({ ...current, state: current.published ? 'changes' : 'draft' }));
      setStatus({ kind: 'saved', at: new Date() });
      return true;
    },
    [form.key, published, save, saved],
  );

  // Autosave, five seconds after the last change — only when the draft would save.
  useEffect(() => {
    if (!canManage || !dirty || !online || issues.length > 0) return;
    const timer = window.setTimeout(() => void saveNow(false), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [canManage, dirty, draft, issues.length, online, saveNow]);

  // Leaving with changes that never reached the server asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useHotkey({
    keys: 'mod+s',
    allowInFields: true,
    enabled: canManage,
    description: 'Save the draft',
    group: 'Form editor',
    handler: (event) => {
      event.preventDefault();
      void saveNow(true);
    },
  });

  const statusText =
    status.kind === 'saving'
      ? 'Saving…'
      : dirty && issues.length > 0
        ? `Not saved: ${issues.length === 1 ? '1 problem' : `${issues.length} problems`} to fix`
        : status.kind === 'failed'
          ? 'Couldn’t save'
          : dirty
            ? 'Unsaved changes'
            : status.kind === 'saved'
              ? `Saved · ${formatDateTime(status.at, { locale, timeZone, style: 'time' })}`
              : state.state === 'live'
                ? 'No unpublished changes'
                : 'Draft saved';

  const changes = describeChanges(diffQuestions(livePublished ? toDocument(livePublished, form.key) : null, toDocument(draft, form.key)));
  const count = countQuestions(draft);
  const publishSpec = {
    title: `Publish ${name}?`,
    body: [
      !state.published
        ? `Publishes ${count === 1 ? 'its question' : `its ${count} questions`}.`
        : livePublished
          ? `${changes ?? 'No questions changed'}. Publishes version ${state.version + 1}.`
          : `Publishes the saved draft as version ${state.version + 1}.`,
      state.published ? 'People who already started keep the version they opened.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    confirmLabel: 'Publish',
    ...(usedBy.length > 0
      ? {
          consequences: usedBy.map((type) => ({
            label: `Requesters of ${type.name} see it immediately`,
            ...(canSeeRequestTypes ? { href: `/catalogue?open=request-type:${encodeURIComponent(type.key)}` } : {}),
          })),
        }
      : {}),
  };

  const offline = online ? undefined : 'You’re offline — changes can’t be saved.';
  const publishGate = offline ?? (issues.length > 0 ? `Fix ${issues.length === 1 ? 'the problem' : `the ${issues.length} problems`} marked on the questions first.` : state.state === 'live' && !dirty ? 'Nothing to publish: the live version is up to date.' : undefined);
  const look = FORM_STATE_LOOK[state.state];

  const details = (
    <div className="app-FormDetails">
      <h3 className="app-Inspector__title">Form details</h3>
      {canManage ? (
        <DescriptionList
          layout="stacked"
          items={[
            {
              id: 'name',
              label: 'Name',
              value: (
                <InlineEdit
                  label="Name"
                  value={name}
                  validate={(value) => (value.trim() ? (value.length > 120 ? 'Keep the name to 120 characters.' : null) : 'The form needs a name.')}
                  onSave={async (next) => {
                    const result = await rename.run({ name: next.trim() });
                    if (!result.ok) return { error: 'Couldn’t save the name. Try again.' };
                    setName(next.trim());
                  }}
                />
              ),
            },
            {
              id: 'description',
              label: 'Description',
              value: (
                <InlineEdit
                  label="Description"
                  editor="textarea"
                  value={description}
                  placeholder="What this form is for"
                  validate={(value) => (value.length > 500 ? 'Keep the description to 500 characters.' : null)}
                  onSave={async (next) => {
                    const result = await rename.run({ description: next.trim() || null });
                    if (!result.ok) return { error: 'Couldn’t save the description. Try again.' };
                    setDescription(next.trim());
                  }}
                />
              ),
            },
          ]}
        />
      ) : null}
      <DescriptionList
        layout="stacked"
        items={[
          ...(canManage ? [] : [{ id: 'name', label: 'Name', value: name }, ...(description ? [{ id: 'description', label: 'Description', value: description }] : [])]),
          { id: 'questions', label: 'Questions', value: count === 1 ? '1 question' : `${count} questions` },
          {
            id: 'used',
            label: 'Asked by',
            value:
              usedBy.length === 0 ? (
                'No request type yet'
              ) : (
                <span className="app-UsedBy">
                  {usedBy.map((type, index) => (
                    <span key={type.key}>
                      {index > 0 ? ', ' : ''}
                      {canSeeRequestTypes ? <Link href={`/catalogue?open=request-type:${encodeURIComponent(type.key)}`}>{type.name}</Link> : type.name}
                    </span>
                  ))}
                </span>
              ),
          },
          { id: 'version', label: 'Live version', value: state.published ? `Version ${state.version}` : 'Not published yet' },
        ]}
      />
      <p className="app-Inspector__note">Select a question to change it, or add one below the list.</p>
    </div>
  );

  return (
    <div className="app-Page app-FormEditor">
      <PageHeader
        title={name}
        breadcrumbs={[...breadcrumbs, { label: name }]}
        status={<StatusPill tone={look.tone} icon={look.icon} label={formStateLabel(state.state, state.version)} />}
        {...(viewOnly ? { viewOnly } : {})}
        {...(canManage
          ? {
              primaryAction: { id: 'publish', label: 'Publish', icon: 'upload', variant: 'primary', ...(publishGate ? { disabled: true, disabledReason: publishGate } : {}) } as ActionSpec,
              secondaryActions: [{ id: 'save', label: 'Save draft', ...(offline ? { disabled: true, disabledReason: offline } : {}) }],
            }
          : {})}
        onAction={(id) => {
          if (id === 'save') void saveNow(true);
          if (id === 'publish') {
            setShowIssues(true);
            if (issues.length === 0) setConfirming(true);
          }
        }}
      />

      <div className="app-FormEditor__bar">
        <SegmentedControl
          label="Mode"
          mode="value"
          size="sm"
          value={view}
          onValueChange={(value) => setView(value === 'preview' ? 'preview' : 'edit')}
          options={[
            { value: 'edit', label: 'Edit', icon: 'pencil' },
            { value: 'preview', label: 'Preview', icon: 'eye' },
          ]}
        />
        {canManage ? (
          <p className="app-FormEditor__status" role="status" data-state={status.kind === 'failed' || (dirty && issues.length > 0) ? 'problem' : status.kind}>
            {statusText}
          </p>
        ) : null}
      </div>

      <h2 className="itsm-visually-hidden">{view === 'edit' ? 'Questions' : 'Preview'}</h2>
      {view === 'edit' ? (
        <QuestionsEditor
          draft={draft}
          onChange={setDraft}
          layout="split"
          readOnly={!canManage}
          // Every problem shows, except an empty label on the question being written right now.
          issues={showIssues ? issues : issues.filter((issue) => issue.blockId !== selectedId || (issue.field !== 'label' && issue.field !== 'title' && issue.field !== 'text'))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          idle={details}
          label={`Questions in ${name}`}
        />
      ) : (
        <section className="app-FormEditor__preview" aria-label="Preview">
          <FormPreview definition={previewDefinition(draft, form.key, name)} title={name} devices headingLevel={3} />
        </section>
      )}

      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          spec={publishSpec}
          onConfirm={async () => {
            const snapshot = latest.current;
            const pending = !sameDocument(snapshot, saved, form.key);
            const result = await publish.run(pending ? toDocument(snapshot, form.key) : null);
            if (!result.ok) throw new Error('Couldn’t publish. Your changes are still here.');
            const locked = lockKeys(snapshot);
            setDraft((current) => (current === snapshot ? locked : lockKeys(current)));
            setSaved(locked);
            setLivePublished(locked);
            setState({ state: 'live', version: result.value.version, published: true });
            setStatus({ kind: 'saved', at: new Date() });
            setConfirming(false);
            notify(`${name} is live as version ${result.value.version}`, { tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}
