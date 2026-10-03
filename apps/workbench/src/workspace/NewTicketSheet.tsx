'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey } from '@itsm/pwa';
import type { CreateTicketInput, FieldRow, Me } from '@itsm/sdk';
import {
  Banner,
  Button,
  Checkbox,
  Disclosure,
  DraftNotice,
  DraftStatus,
  FormField,
  Input,
  PriorityChip,
  SegmentedControl,
  Select,
  Textarea,
  describeProblem,
  notify,
  useDraft,
  useItsm,
} from '@itsm/ui';
import { PersonPicker, Sheet, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../client/api.js';
import { categoriesQuery, teamsQuery } from '../client/desk-ticket.js';
import { searchPeople } from '../client/desk-list.js';
import { LEVELS, type Level } from '../client/mutations.js';
import { deskKeys } from '../client/query-client.js';
import { priorityLabel, problemOf } from '../inbox/presentation.js';
import { CustomFieldControl, applicableFields } from './inspector/CustomFields.js';
import { LEVEL_LABEL, isLevel, previewLine, previewPriority, previewSpoken } from './inspector/priority.js';
import { fieldsQuery, matrixQuery } from './inspector/queries.js';

/**
 * The new-ticket sheet (SPEC §6.2), opened by `c`, the compose button, the
 * palette and the manifest's shortcut — lazily, by the frame, which is why
 * the default export stays.
 *
 * One calm column: the type, a title and what happened; who it is for and
 * who takes it (the requester is you unless you pick someone, and from My
 * work it is assigned to you); impact and urgency with the priority they
 * make shown as they are chosen ("→ P2 · High", X-45); then the team and
 * category where the service can list them, and the desk's own fields
 * behind "More details". Nothing the person may not use is offered.
 *
 * **One idempotency key per attempt.** The key belongs to what is being
 * sent: pressing Create again after a lost answer sends the same ticket with
 * the same key, so it is raised once; changing the ticket first mints a new
 * key, because the service refuses a key reused for a different body. After
 * it is created the next ticket starts afresh.
 *
 * **The draft is kept on this device until the ticket exists**: closing the
 * sheet loses nothing, and opening it again says "Draft restored · Discard".
 * On success the new ticket opens in the pane when the inbox is showing, and
 * a toast offers it everywhere else.
 */

export interface NewTicketSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called with the new ticket's number once it exists. */
  readonly onCreated?: (number: string) => void;
}

type TicketType = 'incident' | 'request' | 'question';

const TYPES: readonly { value: TicketType; label: string }[] = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'question', label: 'Question' },
];

const TITLE_MAX = 500;

/** What the sheet holds; also what the draft keeps. */
export interface NewTicketDraft {
  readonly type: TicketType;
  readonly title: string;
  readonly description: string;
  /** `null`: the person raising it. */
  readonly requester: PersonOption | null;
  readonly assignee: PersonOption | null;
  readonly impact: Level | '';
  readonly urgency: Level | '';
  readonly groupId: string;
  readonly categoryId: string;
  readonly custom: Readonly<Record<string, unknown>>;
}

export const EMPTY_DRAFT: NewTicketDraft = {
  type: 'incident',
  title: '',
  description: '',
  requester: null,
  assignee: null,
  impact: '',
  urgency: '',
  groupId: '',
  categoryId: '',
  custom: {},
};

export function isEmptyDraft(draft: NewTicketDraft): boolean {
  return (
    draft.title.trim() === '' &&
    draft.description.trim() === '' &&
    draft.requester === null &&
    draft.impact === '' &&
    draft.urgency === '' &&
    draft.groupId === '' &&
    draft.categoryId === '' &&
    Object.values(draft.custom).every((value) => value === null || value === undefined || value === '')
  );
}

/** The request body for a draft. `me` names the person raising it, whose own id is never sent as the requester. */
export function toCreateInput(draft: NewTicketDraft, me: string | null): CreateTicketInput {
  const description = draft.description.trim();
  const custom = Object.fromEntries(Object.entries(draft.custom).filter(([, value]) => value !== null && value !== undefined && value !== ''));
  return {
    type: draft.type,
    title: draft.title.trim(),
    ...(description ? { description } : {}),
    ...(draft.impact ? { impact: draft.impact } : {}),
    ...(draft.urgency ? { urgency: draft.urgency } : {}),
    ...(draft.requester && draft.requester.id !== me ? { requesterId: draft.requester.id } : {}),
    ...(draft.assignee ? { assigneeId: draft.assignee.id } : {}),
    ...(draft.groupId ? { groupId: draft.groupId } : {}),
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(Object.keys(custom).length > 0 ? { custom } : {}),
    sourceChannel: 'api',
  };
}

export interface Intent {
  readonly signature: string;
  readonly key: string;
}

/**
 * The idempotency key for sending `input`: the last one when the body is the
 * same (a retry after no answer), a new one when anything changed (the
 * service refuses a key reused with a different body).
 */
export function intentFor(previous: Intent | null, input: CreateTicketInput, mint: () => string = newIdempotencyKey): Intent {
  const signature = JSON.stringify(input);
  return previous && previous.signature === signature ? previous : { signature, key: mint() };
}

function hasPermission(me: Me | undefined, key: string, scope?: string): boolean {
  return Boolean(me?.permissions.some((entry) => entry.key === key && (scope === undefined || entry.scope === scope)));
}

/** `/me` on the client; the ticket workspace reads the demo's persona ids under the same key. */
const meKey = ['desk', 'me'] as const;

export function NewTicketSheet({ open, onOpenChange, onCreated }: NewTicketSheetProps): ReactNode {
  const client = useQueryClient();
  const { router, usePathname, storageScope } = useItsm();
  const pathname = usePathname();
  const formId = useId();
  const previewId = useId();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  const [draft, setDraft] = useState<NewTicketDraft>(EMPTY_DRAFT);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [requesterError, setRequesterError] = useState<string | undefined>();
  const [customErrors, setCustomErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const intent = useRef<Intent | null>(null);
  const restored = useRef(false);

  /* Who is raising it, and what they may do. */
  const me = useQuery({ queryKey: meKey, queryFn: () => api.me(), staleTime: 10 * 60_000, enabled: open }).data;
  const myId = me?.actor.id?.toLowerCase() ?? null;
  const myName = me?.actor.displayName ?? 'You';
  const readPeople = hasPermission(me, 'identity.user.read');
  const forOthers = hasPermission(me, 'ticket.create', 'any') && readPeople;
  const canAssign = hasPermission(me, 'ticket.assign');
  const matrix = useQuery(matrixQuery(open && hasPermission(me, 'sla.policy.read'))).data;
  const teams = useQuery({ ...teamsQuery(), enabled: open }).data;
  const categories = useQuery({ ...categoriesQuery(), enabled: open }).data;
  const definitions = useQuery({ ...fieldsQuery(), enabled: open }).data;
  const fields = useMemo<FieldRow[]>(() => applicableFields(definitions, { type: draft.type, custom: {} }), [definitions, draft.type]);
  const meOption = useMemo<PersonOption | undefined>(() => (myId ? { id: myId, name: myName } : undefined), [myId, myName]);

  /* The draft, kept on this device until the ticket exists. */
  const draftKeeper = useDraft<NewTicketDraft>({
    key: `itsm-wb-new-ticket${storageScope ? `:${storageScope}` : ''}`,
    value: draft,
    intervalMs: 1000,
    isEmpty: isEmptyDraft,
    onRestore: (value) => {
      restored.current = true;
      setDraft({ ...EMPTY_DRAFT, ...value, custom: { ...(value.custom ?? {}) } });
    },
  });

  /* From My work, a new ticket is the person's own (SPEC §6.2), unless a draft says otherwise. */
  const defaulted = useRef(false);
  useEffect(() => {
    if (!open) {
      defaulted.current = false;
      return;
    }
    if (defaulted.current || !meOption || !canAssign) return;
    defaulted.current = true;
    if (restored.current || !pathname.startsWith('/inbox/mine')) return;
    setDraft((current) => (current.assignee || !isEmptyDraft(current) ? current : { ...current, assignee: meOption }));
  }, [open, meOption, canAssign, pathname]);

  const update = useCallback((patch: Partial<NewTicketDraft>) => setDraft((current) => ({ ...current, ...patch })), []);

  const reset = (): void => {
    setDraft(EMPTY_DRAFT);
    setTitleError(undefined);
    setRequesterError(undefined);
    setCustomErrors({});
    setFailure(null);
    intent.current = null;
    restored.current = false;
  };

  const preview = previewPriority(matrix, isLevel(draft.impact) ? draft.impact : null, isLevel(draft.urgency) ? draft.urgency : null);

  const create = async (): Promise<void> => {
    if (saving) return;
    const input = toCreateInput(draft, myId);
    if (!input.title) {
      setTitleError('Give the ticket a title, so it can be found in a list.');
      titleRef.current?.focus();
      return;
    }
    const attempt = intentFor(intent.current, input);
    intent.current = attempt;
    setSaving(true);
    setFailure(null);
    setTitleError(undefined);
    setRequesterError(undefined);
    setCustomErrors({});
    try {
      const ticket = await api.createTicket(input, { idempotencyKey: attempt.key });
      draftKeeper.clear();
      reset();
      onOpenChange(false);
      void client.invalidateQueries({ queryKey: deskKeys.counts() });
      void client.invalidateQueries({ queryKey: deskKeys.views() });
      onCreated?.(ticket.number);
      const href = `/tickets/${encodeURIComponent(ticket.number)}`;
      // Beside the inbox, the new ticket is selected in the pane; anywhere else the toast opens it.
      const inInbox = typeof window !== 'undefined' && window.location.pathname.startsWith('/inbox/');
      if (inInbox) {
        const url = new URL(window.location.href);
        url.searchParams.set('t', ticket.number);
        window.history.pushState(null, '', `${url.pathname}${url.search}`);
      }
      notify(`${ticket.number} created`, {
        tone: 'success',
        description: `${priorityLabel(ticket.priority)}${ticket.assigneeId && ticket.assigneeId.toLowerCase() === myId ? ' · assigned to you' : ''}`,
        ...(inInbox ? {} : { action: { label: 'Open', onClick: () => router.push(href) } }),
      });
    } catch (error) {
      const problem = problemOf(error);
      const fieldErrors = problem.fieldErrors ?? {};
      const custom: Record<string, string> = {};
      for (const [field, message] of Object.entries(fieldErrors)) if (field.startsWith('custom.')) custom[field.slice(7)] = message;
      if (fieldErrors.title) setTitleError(fieldErrors.title);
      if (Object.keys(custom).length > 0) {
        setCustomErrors(custom);
        if (moreRef.current) moreRef.current.open = true;
      }
      if (problem.status === 403 && input.requesterId) {
        setRequesterError('You can only raise tickets for yourself. Leave the requester as you, or ask a team lead.');
      } else if (problem.status === 0) {
        setFailure({ title: 'The ticket wasn’t sent', body: 'You’re offline, or the service didn’t answer. Everything is still here: try again when you’re connected, and it will be raised once.' });
      } else if (!fieldErrors.title && Object.keys(custom).length === 0) {
        const described = describeProblem(problem);
        // The demo's cap (25 new tickets a visit) and lock speak the contract's sentence, never the service's raw detail.
        const demo = problem.code === 'demo_limit' || problem.code === 'demo_disabled';
        const body = demo ? described.body : (problem.detail ?? described.body);
        setFailure({ title: problem.status === 422 ? 'The ticket was refused' : described.title, ...(body ? { body } : {}) });
      }
      requestAnimationFrame(() => {
        if (fieldErrors.title) titleRef.current?.focus();
        else bannerRef.current?.focus?.();
      });
    } finally {
      setSaving(false);
    }
  };

  const hasContent = !isEmptyDraft(draft);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      side="auto"
      size="md"
      title="New ticket"
      initialFocusRef={titleRef}
      footer={
        <div className="app-NewTicket__footer">
          <div className="app-NewTicket__draft">
            <DraftStatus savedAt={hasContent ? draftKeeper.savedAt : null} />
            {hasContent ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  draftKeeper.discard();
                  reset();
                  titleRef.current?.focus();
                }}
              >
                Discard draft
              </Button>
            ) : null}
          </div>
          <div className="app-NewTicket__actions">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={formId} loading={saving} loadingLabel="Creating ticket" aria-keyshortcuts="Control+Enter Meta+Enter">
              Create ticket
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="app-NewTicket"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void create();
          }
        }}
      >
        <DraftNotice
          notice={draftKeeper.notice}
          onDiscard={() => {
            draftKeeper.discard();
            reset();
          }}
          onDismiss={draftKeeper.dismissNotice}
        />
        {failure ? (
          <Banner ref={bannerRef} tone="danger" title={failure.title} live="assertive" tabIndex={-1} className="app-NewTicket__failure">
            {failure.body}
          </Banner>
        ) : null}

        <SegmentedControl
          label="Type"
          mode="value"
          fullWidth
          value={draft.type}
          options={TYPES.map((option) => ({ value: option.value, label: option.label }))}
          onValueChange={(value) => update({ type: value as TicketType })}
        />
        <FormField label="Title" required {...(titleError ? { error: titleError } : {})}>
          <Input
            ref={titleRef}
            value={draft.title}
            maxLength={TITLE_MAX}
            autoComplete="off"
            onChange={(event) => {
              update({ title: event.target.value });
              setTitleError(undefined);
            }}
          />
        </FormField>
        <FormField label="Description" optional hint="What happened, and what was expected. The requester sees this.">
          <Textarea value={draft.description} rows={5} autoGrow onChange={(event) => update({ description: event.target.value })} />
        </FormField>

        <fieldset className="app-NewTicket__group">
          <legend className="app-NewTicket__legend">People</legend>
          {forOthers ? (
            <FormField
              label="Requester"
              hint={draft.requester ? undefined : 'You, unless you choose someone else.'}
              {...(requesterError ? { error: requesterError } : {})}
            >
              {(control) => (
                <PersonPicker
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  {...(control['aria-invalid'] ? { 'aria-invalid': true as const } : {})}
                  placeholder="You"
                  value={draft.requester}
                  onChange={(next) => {
                    update({ requester: Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null) });
                    setRequesterError(undefined);
                  }}
                  loadPeople={async (query) => searchPeople(query)}
                />
              )}
            </FormField>
          ) : (
            <p className="app-NewTicket__static">
              <span className="app-NewTicket__staticLabel">Requester</span> You
            </p>
          )}
          {canAssign ? (
            readPeople ? (
              <FormField label="Assignee" optional>
                {(control) => (
                  <PersonPicker
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    placeholder="Unassigned"
                    value={draft.assignee}
                    onChange={(next) => update({ assignee: Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null) })}
                    loadPeople={async (query) => searchPeople(query)}
                    extras={{ assignToMe: Boolean(meOption), unassign: true }}
                    {...(meOption ? { me: meOption } : {})}
                  />
                )}
              </FormField>
            ) : meOption ? (
              <Checkbox label="Assign to me" checked={draft.assignee?.id === meOption.id} onChange={(event) => update({ assignee: event.target.checked ? meOption : null })} />
            ) : null
          ) : null}
        </fieldset>

        <fieldset className="app-NewTicket__group" aria-describedby={previewId}>
          <legend className="app-NewTicket__legend">Priority</legend>
          <div className="app-NewTicket__pair">
            <FormField label="Impact" optional>
              <Select
                value={draft.impact}
                placeholder="Not set"
                options={LEVELS.map((level) => ({ value: level, label: LEVEL_LABEL[level] }))}
                onChange={(event) => update({ impact: isLevel(event.target.value) ? event.target.value : '' })}
              />
            </FormField>
            <FormField label="Urgency" optional>
              <Select
                value={draft.urgency}
                placeholder="Not set"
                options={LEVELS.map((level) => ({ value: level, label: LEVEL_LABEL[level] }))}
                onChange={(event) => update({ urgency: isLevel(event.target.value) ? event.target.value : '' })}
              />
            </FormField>
          </div>
          <p id={previewId} className="app-NewTicket__preview" data-state={preview ? preview.from : 'none'} aria-live="polite">
            {preview ? (
              // The priority as the desk sees it everywhere else (A6 §5.7): the chip with
              // its bars, spoken "Priority 2, high", after what the choices make it.
              <>
                {preview.from === 'usual' ? <span className="itsm-visually-hidden">Usually: </span> : null}
                <span aria-hidden="true">{preview.from === 'usual' ? 'Usually → ' : '→ '}</span>
                <PriorityChip priority={preview.priority} words className="app-NewTicket__chip" />
              </>
            ) : (
              <>
                <span aria-hidden="true">{previewLine(preview)}</span>
                <span className="itsm-visually-hidden">{previewSpoken(preview)}</span>
              </>
            )}
          </p>
          {preview?.from === 'usual' ? <p className="app-NewTicket__note">From the recommended grid; your desk’s own may differ.</p> : null}
          {!preview ? <p className="app-NewTicket__note">Without both, the desk’s default priority applies.</p> : null}
        </fieldset>

        {(teams && teams.length > 0) || (categories && categories.length > 0) ? (
          <fieldset className="app-NewTicket__group">
            <legend className="app-NewTicket__legend">Routing</legend>
            {teams && teams.length > 0 ? (
              <FormField label="Team" optional hint={draft.groupId ? undefined : 'Left empty, the desk’s rules route it.'}>
                <Select
                  value={draft.groupId}
                  placeholder="Decided by routing"
                  options={teams.map((team) => ({ value: team.id, label: team.name }))}
                  onChange={(event) => update({ groupId: event.target.value })}
                />
              </FormField>
            ) : null}
            {categories && categories.length > 0 ? (
              <FormField label="Category" optional>
                <Select
                  value={draft.categoryId}
                  placeholder="Not set"
                  options={categories.map((category) => ({ value: category.id, label: category.path }))}
                  onChange={(event) => update({ categoryId: event.target.value })}
                />
              </FormField>
            ) : null}
          </fieldset>
        ) : null}

        {fields.length > 0 ? (
          <Disclosure ref={moreRef} summary={`More details (${fields.length})`} className="app-NewTicket__more">
            <div className="app-NewTicket__fields">
              {fields.map((field) => (
                <CustomFieldControl
                  key={field.key}
                  field={field}
                  value={draft.custom[field.key]}
                  onChange={(value) => {
                    update({ custom: { ...draft.custom, [field.key]: value } });
                    setCustomErrors((current) => {
                      if (!current[field.key]) return current;
                      const next = { ...current };
                      delete next[field.key];
                      return next;
                    });
                  }}
                  {...(customErrors[field.key] ? { error: customErrors[field.key] } : {})}
                />
              ))}
            </div>
          </Disclosure>
        ) : null}
      </form>
    </Sheet>
  );
}

export default NewTicketSheet;
