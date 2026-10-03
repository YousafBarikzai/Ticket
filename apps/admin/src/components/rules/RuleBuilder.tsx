'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AreaModel } from '@itsm/contracts/areas';
import type { RuleRow } from '@itsm/sdk';
import {
  Banner,
  Button,
  FormErrorSummary,
  FormField,
  InlineAlert,
  Input,
  RadioGroup,
  SegmentedControl,
  StatusPill,
  Surface,
  Tabs,
  Textarea,
  announce,
  notify,
  useHotkey,
  type ActionSpec,
  type Crumb,
  type Problem,
} from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { reportSessionEnded, useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { problemFrom } from '../../problem.js';
import { eventInfo, eventsFrom, factAppliesTo } from '../../rules/events.js';
import { ConditionBuilder } from '../ConditionBuilder.js';
import { KeyField } from '../KeyField.js';
import { ActionsEditor } from './ActionsEditor.js';
import {
  checkDraft,
  createPayload,
  definitionOf,
  draftFrom,
  emptyDraft,
  patchPayload,
  signature,
  testSignature,
  type ActionItem,
  type DraftIssue,
  type RuleDraft,
} from './draft.js';
import {
  RULE_STATES,
  errorTarget,
  lastOrder,
  placement,
  placementSentence,
  ruleState,
  testSummary,
  toRuleView,
} from './presentation.js';
import { RuleHistory } from './RuleHistory.js';
import { TryItPanel, type TestState } from './TryItPanel.js';
import type { Choice, RuleNames, RuleState, RuleVersionView, RuleView } from './types.js';
import { useUnsavedGuard } from './useUnsavedGuard.js';

/**
 * The rule builder (SPEC §6.1 `/rules/new`, `/rules/[key]`): **write → try
 * it → publish**, on one page.
 *
 * The canvas reads as a sentence — *When* something happens, *If* these are
 * true, *Then* do these — with the name and the running order after it.
 * Beside it, *Try it* replays the canvas as it is, saved or not, against
 * recent tickets (A8), so a change is tested before anyone commits to it.
 *
 * Publishing is honest about R1: the API returns an edited live rule to
 * draft, which takes it offline. So for someone who may publish, the button
 * is **Publish changes** — it saves and publishes in one go, and says so if
 * the second half fails; for someone who may only manage, it is **Save as
 * draft**, under a warning that saving takes the rule offline until someone
 * with publish permission publishes it. There is no autosave, and leaving
 * with unsaved changes asks first.
 */
export interface RuleBuilderProps {
  /** The stored rule; null on `/rules/new`. */
  readonly rule: RuleView | null;
  /** A rule to start from (`/rules/new?from=`), copied under a new name. */
  readonly seed?: RuleView | null;
  readonly versions: readonly RuleVersionView[];
  /** Every rule, for the key check and the running order. */
  readonly siblings: readonly RuleView[];
  /** The engine's fact paths and events (`GET /rules/facts`); empty uses the console's catalogue. */
  readonly facts: readonly string[];
  readonly events: readonly string[];
  readonly names: RuleNames;
  readonly workflows: readonly Choice[] | null;
  readonly teams: readonly Choice[] | null;
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly sampleSize: number | null;
  /** The person's areas (`currentAreas()`): ticket numbers open in the Service Desk when it is listed (A2 §3.7). */
  readonly areas?: AreaModel;
  readonly breadcrumbs: readonly Crumb[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  readonly initialTab?: 'rule' | 'history';
  /** Run the test once on arrival (the list's *Test*). */
  readonly autoTest?: boolean;
}

type Confirm = 'publish' | 'offline-save' | 'archive' | 'restore' | null;

const OFFLINE = 'You’re offline — changes can’t be saved.';
const FIELD_IDS = { name: 'rule-name', key: 'rule-key', description: 'rule-description', event: 'rule-when', conditions: 'rule-if', actions: 'rule-then' } as const;

const NARROW = '(max-width: 63.99rem)';
function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/** Below 1024 px the *Try it* panel is a bottom sheet behind a button (SPEC §6.1), rather than a column far down the page. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

function withParam(name: string, value: string | null): string {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function RuleBuilder(props: RuleBuilderProps): ReactNode {
  const { versions, siblings, facts, events, names, workflows, teams, canManage, canPublish, sampleSize, areas, breadcrumbs, viewOnly } = props;
  const router = useRouter();
  const online = useOnline();
  const narrow = useNarrow();
  const teamsKnown = teams !== null;

  const [current, setCurrent] = useState<RuleView | null>(props.rule);
  const isNew = current === null;
  const state: RuleState | null = current ? ruleState(current) : null;
  const readOnly = !canManage || state === 'archived';

  const initialDraft = useMemo<RuleDraft>(() => {
    if (props.rule) return draftFrom(props.rule, { teams: teamsKnown });
    if (props.seed) {
      const copy = draftFrom(props.seed, { teams: teamsKnown });
      return { ...copy, name: `Copy of ${props.seed.name}`, key: '', order: lastOrder(siblings, copy.event) };
    }
    return emptyDraft(lastOrder(siblings, 'ticket.created'));
    // The first render's rule only; later changes arrive through `setCurrent`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraft] = useState<RuleDraft>(initialDraft);
  const [baseline, setBaseline] = useState<string>(() => (props.rule ? signature(initialDraft) : signature(emptyDraft(initialDraft.order))));
  const [orderTouched, setOrderTouched] = useState(Boolean(props.rule));
  const [keyState, setKeyState] = useState<KeyState>(props.rule ? 'ok' : 'empty');
  const [showIssues, setShowIssues] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [serverErrors, setServerErrors] = useState<readonly { readonly path: string; readonly message: string }[]>([]);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [dryRunAvailable, setDryRunAvailable] = useState(true);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [tab, setTab] = useState<'rule' | 'history'>(props.initialTab === 'history' && props.rule ? 'history' : 'rule');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = signature(draft) !== baseline;
  const guard = useUnsavedGuard(dirty && !readOnly);

  // A refreshed server row (after someone else's change, or ours) is taken in when nothing here is unsaved.
  const incoming = props.rule;
  const seenRow = useRef(incoming ? `${incoming.updatedAt}:${incoming.status}:${incoming.version}` : '');
  useEffect(() => {
    if (!incoming) return;
    const stamp = `${incoming.updatedAt}:${incoming.status}:${incoming.version}`;
    if (stamp === seenRow.current) return;
    seenRow.current = stamp;
    setCurrent(incoming);
    if (!dirty) {
      const next = draftFrom(incoming, { teams: teamsKnown });
      setDraft(next);
      setBaseline(signature(next));
    }
  }, [incoming, dirty, teamsKnown]);

  const change = useCallback((patch: Partial<RuleDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setServerErrors([]);
  }, []);

  /* ------------------------------------------------------------- problems */

  const issues = useMemo(() => checkDraft(draft, { keyState, isNew }), [draft, keyState, isNew]);
  const shown: readonly DraftIssue[] = showIssues ? issues : [];
  const errorFor = (target: 'name' | 'key' | 'description' | 'event' | 'conditions' | 'actions'): string | undefined => {
    const own = shown.find((issue) => issue.target === target)?.message;
    if (own) return own;
    const server = serverErrors.find((error) => {
      const where = errorTarget(error.path);
      return where.kind === 'field' ? where.field === target : where.kind === target;
    });
    return server?.message;
  };
  const actionErrors: Record<string, string> = {};
  for (const issue of shown) if (typeof issue.target === 'object') actionErrors[issue.target.action] = issue.message;
  for (const error of serverErrors) {
    const where = errorTarget(error.path);
    const item = where.kind === 'action' ? draft.actions[where.index] : undefined;
    if (item && !actionErrors[item.id]) actionErrors[item.id] = error.message;
  }
  const testFlagsConditions = test.kind === 'done' && test.result.errors.length > 0 && test.signature === testSignature(draft);

  const summary = [
    ...shown.map((issue) => ({
      fieldId: typeof issue.target === 'object' ? `${issue.target.action}-value` : FIELD_IDS[issue.target],
      message: issue.message,
    })),
    ...serverErrors.map((error) => {
      const where = errorTarget(error.path);
      const fieldId =
        where.kind === 'action'
          ? `${draft.actions[where.index]?.id ?? ''}-value`
          : where.kind === 'field'
            ? where.field === 'order' || where.field === 'mode'
              ? 'rule-advanced'
              : FIELD_IDS[where.field]
            : where.kind === 'other'
              ? ''
              : FIELD_IDS[where.kind];
      return { fieldId, message: error.message };
    }),
  ];

  const absorb = (problem: Problem): void => {
    const fields = Object.entries(problem.fieldErrors ?? {}).map(([path, message]) => ({ path, message }));
    if (fields.length > 0) {
      setServerErrors(fields);
      setAttempt((value) => value + 1);
    }
  };

  /** True when the rule may be sent; otherwise the problems are shown and focused. */
  const ready = (): boolean => {
    if (issues.length === 0) return true;
    setShowIssues(true);
    setAttempt((value) => value + 1);
    return false;
  };

  /* ------------------------------------------------------------- writing */

  const create = useMutation((body: Record<string, unknown>) => api.configure.rules.create(body), { failure: 'Couldn’t save the rule', refresh: false });
  const update = useMutation((body: Record<string, unknown>) => api.configure.rules.update(current?.key ?? '', body), { failure: 'Couldn’t save the rule', refresh: false });
  const publisher = useMutation((key: string) => api.configure.rules.publish(key), { failure: 'Couldn’t publish the rule', refresh: false });
  const archiver = useMutation((key: string) => api.configure.rules.archive(key), { failure: 'Couldn’t archive the rule', refresh: false });

  const settle = (row: RuleRow, saved: RuleDraft): void => {
    setCurrent(toRuleView(row));
    seenRow.current = `${row.updatedAt}:${row.status}:${row.version}`;
    setBaseline(signature(saved));
    setShowIssues(false);
    setServerErrors([]);
  };

  /** Writes the canvas: creates the rule, or saves the edit. Null when it failed (the problem is already on screen). */
  const write = async (): Promise<RuleRow | null> => {
    const saved = draft;
    const result = isNew ? await create.run(createPayload(saved)) : await update.run(patchPayload(saved));
    if (!result.ok) {
      absorb(result.problem);
      return null;
    }
    settle(result.value, saved);
    return result.value;
  };

  const leaveTo = (key: string): void => {
    guard.release();
    router.replace(`/rules/${encodeURIComponent(key)}`);
  };

  const saveDraft = async (): Promise<void> => {
    if (!ready()) return;
    const wasLive = state === 'live';
    setBusy(true);
    try {
      const row = await write();
      if (!row) return;
      if (wasLive) notify(`“${row.name}” saved as a draft`, { tone: 'warning', description: 'It’s offline until it’s published.' });
      else notify('Draft saved', { tone: 'success' });
      if (isNew) leaveTo(row.key);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const publishNow = async (): Promise<void> => {
    if (!ready()) return;
    const wasLive = state === 'live';
    const created = isNew;
    setBusy(true);
    try {
      let key = current?.key ?? draft.key;
      if (isNew || dirty) {
        const row = await write();
        if (!row) return;
        key = row.key;
      }
      const published = await publisher.run(key);
      if (!published.ok) {
        notify('Saved, but not published', {
          tone: 'warning',
          description: wasLive ? 'The rule is offline until it’s published.' : 'It’s a draft until it’s published.',
          action: { label: 'Publish', onClick: () => void publisher.run(key).then((retry) => (retry.ok ? router.refresh() : undefined)) },
        });
        if (created) leaveTo(key);
        else router.refresh();
        return;
      }
      setCurrent(toRuleView(published.value));
      seenRow.current = `${published.value.updatedAt}:${published.value.status}:${published.value.version}`;
      notify(`“${published.value.name}” is live`, { tone: 'success', description: `Version ${published.value.version} acts on new events from now.` });
      if (created) leaveTo(key);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const archiveNow = async (): Promise<void> => {
    if (!current) return;
    const result = await archiver.run(current.key);
    if (!result.ok) return;
    setCurrent(toRuleView(result.value));
    seenRow.current = `${result.value.updatedAt}:${result.value.status}:${result.value.version}`;
    const reset = draftFrom(result.value, { teams: teamsKnown });
    setDraft(reset);
    setBaseline(signature(reset));
    notify(`“${result.value.name}” archived`, { tone: 'success', description: 'It no longer acts on tickets.' });
    router.refresh();
  };

  const discard = (): void => {
    const reset = current ? draftFrom(current, { teams: teamsKnown }) : initialDraft;
    setDraft(reset);
    setBaseline(signature(reset));
    setShowIssues(false);
    setServerErrors([]);
  };

  /* ---------------------------------------------------------------- test */

  const runTest = async (): Promise<void> => {
    const blocking = issues.filter((issue) => typeof issue.target === 'object' || issue.target === 'conditions' || issue.target === 'actions');
    if (blocking.length > 0) {
      setShowIssues(true);
      setTest({ kind: 'invalid', messages: blocking.map((issue) => issue.message) });
      return;
    }
    const tested = draft;
    setTest({ kind: 'running' });
    try {
      let result;
      if (dryRunAvailable) {
        result = await api.configure.rules.dryRun(definitionOf(tested), sampleSize ?? undefined);
      } else {
        // Without the dry run (A8) the stored rule is what can be tested, so it is saved first.
        const row = isNew || dirty ? await write() : null;
        if ((isNew || dirty) && !row) {
          setTest({ kind: 'idle' });
          return;
        }
        result = await api.configure.rules.test(row?.key ?? current!.key, sampleSize ?? undefined);
        if (isNew && row) leaveTo(row.key);
      }
      setTest({ kind: 'done', result, signature: testSignature(tested) });
      announce(testSummary(result));
    } catch (error) {
      const problem = problemFrom(error);
      if (problem.status === 401) {
        reportSessionEnded();
        setTest({ kind: 'idle' });
      } else if (dryRunAvailable && (problem.status === 404 || problem.status === 405)) {
        setDryRunAvailable(false);
        setTest({ kind: 'invalid', messages: ['This API can’t test an unsaved rule. Save it as a draft first, then test it.'] });
      } else if (problem.status === 422 && problem.fieldErrors) {
        setServerErrors(Object.entries(problem.fieldErrors).map(([path, message]) => ({ path, message })));
        setTest({ kind: 'invalid', messages: Object.values(problem.fieldErrors) });
      } else {
        setTest({ kind: 'failed', problem });
      }
    }
  };

  // The list's *Test* lands here with `?test=1`: run once, then drop the parameter.
  const autoTested = useRef(false);
  useEffect(() => {
    if (!props.autoTest || autoTested.current || !canManage) return;
    autoTested.current = true;
    window.history.replaceState(null, '', withParam('test', null));
    void runTest();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = test.kind === 'done' && test.signature !== testSignature(draft);
  const liveWithoutDryRun = !dryRunAvailable && state === 'live';
  const testDisabledReason = !online
    ? OFFLINE
    : liveWithoutDryRun
      ? 'Saving to test would take this live rule offline. Publish changes instead, or ask for the dry run to be enabled.'
      : undefined;

  /* -------------------------------------------------------------- header */

  const liveManageOnly = state === 'live' && canManage && !canPublish;
  const actions = headerActions({ isNew, state, dirty, canManage, canPublish, online, key: current?.key ?? null });

  const onHeaderAction = (id: string): void => {
    switch (id) {
      case 'publish':
        if (ready()) setConfirm('publish');
        return;
      case 'save':
        if (state === 'live') {
          if (ready()) setConfirm('offline-save');
        } else void saveDraft();
        return;
      case 'restore':
        setConfirm('restore');
        return;
      case 'archive':
        setConfirm('archive');
        return;
      case 'discard':
        discard();
        return;
    }
  };

  useHotkey({
    keys: 'mod+s',
    allowInFields: true,
    enabled: canManage && !readOnly,
    description: 'Save the rule as a draft',
    group: 'Rule builder',
    handler: (event) => {
      event.preventDefault();
      if (online) onHeaderAction('save');
    },
  });

  const title = current?.name ?? 'New rule';
  const crumbs = [...breadcrumbs, { label: title }];

  /* -------------------------------------------------------------- canvas */

  const eventChoices = useMemo(() => eventsFrom(events), [events]);
  const eventFacts = useMemo(() => (facts.length > 0 ? facts.filter((path) => factAppliesTo(path, draft.event)) : undefined), [facts, draft.event]);
  const place = placement(siblings, draft.event, current?.key ?? null, draft.order, draft.name.trim() || 'This rule');
  const chosenEvent = eventInfo(draft.event);

  const canvas = (
    <div className="app-RuleBuilder__canvas">
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={2} focusKey={attempt} title="The rule can’t be saved yet" /> : null}

      <fieldset className="app-RuleBuilder__fieldset" disabled={readOnly}>
        <legend className="app-RuleBuilder__legend">The rule</legend>

        <BuilderCard id={FIELD_IDS.event} title="When" description="What sets the rule off." invalid={Boolean(errorFor('event'))}>
          <RadioGroup<string>
            label="When this happens"
            labelHidden
            variant="cards"
            columns={3}
            value={draft.event}
            onChange={(event) => {
              if (readOnly) return;
              // A new rule keeps its place at the end of whichever event it is for.
              change({ event, ...(orderTouched ? {} : { order: lastOrder(siblings, event) }) });
            }}
            options={eventChoices.map((event) => ({
              value: event.value,
              label: event.label,
              description: event.description,
              icon: event.icon,
              ...(readOnly && event.value !== draft.event ? { disabled: true } : {}),
            }))}
          />
          {!chosenEvent.runs ? <InlineAlert tone="warning">Rules for this event are accepted but don’t run yet, so this rule wouldn’t do anything.</InlineAlert> : null}
          {errorFor('event') ? <p className="app-FieldProblem">{errorFor('event')}</p> : null}
        </BuilderCard>

        <BuilderCard id={FIELD_IDS.conditions} title="If" description="Which tickets it acts on. With no conditions it acts on every one." invalid={Boolean(errorFor('conditions')) || testFlagsConditions}>
          <ConditionBuilder
            label="Conditions"
            value={draft.conditions}
            {...(eventFacts ? { facts: eventFacts } : {})}
            emptyText="Runs every time"
            readOnly={readOnly}
            onChange={(conditions) => change({ conditions })}
          />
          {errorFor('conditions') ? <p className="app-FieldProblem">{errorFor('conditions')}</p> : null}
          {testFlagsConditions ? <p className="app-FieldProblem">The last test couldn’t check this condition on some tickets. See the test for why.</p> : null}
        </BuilderCard>

        <BuilderCard id={FIELD_IDS.actions} title="Then" description="What it does, in this order." invalid={Boolean(errorFor('actions'))}>
          <ActionsEditor
            items={draft.actions}
            onChange={(items: ActionItem[]) => change({ actions: items })}
            workflows={workflows}
            teams={teams}
            errors={actionErrors}
            readOnly={readOnly}
          />
          {errorFor('actions') ? <p className="app-FieldProblem">{errorFor('actions')}</p> : null}
        </BuilderCard>

        <BuilderCard id="rule-details" title="Name and details">
          <FormField label="Name" required id={FIELD_IDS.name} counter={{ max: 120 }} {...(errorFor('name') ? { error: errorFor('name')! } : {})}>
            <Input value={draft.name} autoComplete="off" onChange={(event) => change({ name: event.currentTarget.value })} />
          </FormField>
          <div id={FIELD_IDS.key} tabIndex={-1} className="app-RuleBuilder__key">
            <KeyField
              source={draft.name}
              rule="slug"
              value={draft.key}
              onChange={(key) => change({ key })}
              onStateChange={setKeyState}
              taken={siblings.map((rule) => rule.key)}
              noun="rule"
              locked={!isNew}
            />
            {errorFor('key') ? <p className="app-FieldProblem">{errorFor('key')}</p> : null}
          </div>
          <FormField label="Description" optional id={FIELD_IDS.description} hint="What it’s for, for the next person who opens it." {...(errorFor('description') ? { error: errorFor('description')! } : {})}>
            <Textarea value={draft.description} rows={2} autoGrow maxRows={6} counter={{ max: 500 }} onChange={(event) => change({ description: event.currentTarget.value })} />
          </FormField>
        </BuilderCard>

        <BuilderCard id="rule-advanced" title="Advanced">
          <div className="app-RuleOrder">
            <p className="app-RuleOrder__sentence">{placementSentence(place)}</p>
            {place.tie ? (
              <InlineAlert tone="warning">
                “{place.tie.name}” has the same place number, so which of the two runs first isn’t fixed. Move this one earlier or later to decide.
              </InlineAlert>
            ) : null}
            {readOnly ? null : (
              <div className="app-RuleOrder__buttons">
                <Button
                  size="sm"
                  variant="secondary"
                  iconStart="arrow-up"
                  disabled={place.earlier === null}
                  onClick={() => {
                    if (place.earlier === null) return;
                    setOrderTouched(true);
                    change({ order: place.earlier });
                    announce(`Now runs ${place.position - 1 === 1 ? 'first' : `before “${place.before?.name ?? ''}”`}`);
                  }}
                >
                  Run earlier
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  iconStart="arrow-down"
                  disabled={place.later === null}
                  onClick={() => {
                    if (place.later === null) return;
                    setOrderTouched(true);
                    change({ order: place.later });
                    announce(`Now runs after “${place.after?.name ?? ''}”`);
                  }}
                >
                  Run later
                </Button>
              </div>
            )}
          </div>
          <div className="app-RuleMode">
            <SegmentedControl
              label="After this rule"
              mode="value"
              size="sm"
              value={draft.mode}
              onValueChange={(mode) => {
                if (!readOnly) change({ mode: mode === 'stop' ? 'stop' : 'continue' });
              }}
              options={[
                { value: 'continue', label: 'Continue', ...(readOnly ? { disabled: true } : {}) },
                { value: 'stop', label: 'Stop other rules', ...(readOnly ? { disabled: true } : {}) },
              ]}
            />
            <p className="app-RuleMode__hint">
              {draft.mode === 'stop'
                ? 'When this rule matches, rules after it don’t run for the same event.'
                : 'Rules after this one still run for the same event.'}
            </p>
          </div>
        </BuilderCard>
      </fieldset>

      {narrow && canManage && !readOnly ? (
        <div className="app-RuleBuilder__tryBar">
          <Button variant="secondary" iconStart="play" fullWidth onClick={() => setSheetOpen(true)}>
            Try it on recent tickets
          </Button>
        </div>
      ) : null}
    </div>
  );

  const panel = (headingLevel: 2 | 3): ReactNode => (
    <TryItPanel
      state={test}
      stale={stale}
      sampleSize={sampleSize}
      onRun={() => void runTest()}
      runLabel={dryRunAvailable ? 'Run test' : 'Save draft & test'}
      {...(testDisabledReason ? { disabledReason: testDisabledReason } : {})}
      names={names}
      {...(areas ? { areas } : {})}
      headingLevel={headingLevel}
    />
  );

  const withPanel = !narrow && canManage && !readOnly;
  const ruleTab = (
    <div className="app-RuleBuilder__grid" data-panel={withPanel ? '' : undefined}>
      {canvas}
      {withPanel ? (
        <aside className="app-RuleBuilder__panel" aria-label="Try it">
          <Surface tone="raised" elevation="xs" padding="md" className="app-RuleBuilder__panelCard">
            {panel(2)}
          </Surface>
        </aside>
      ) : null}
    </div>
  );

  /* ---------------------------------------------------------- confirmations */

  const lastTest = test.kind === 'done' ? (stale ? 'The rule has changed since the last test.' : `Last test: ${testSummary(test.result).replace(/\.$/, '')}.`) : 'It hasn’t been tried on recent tickets.';
  const publishSpec = {
    title: isNew ? `Publish “${draft.name.trim()}”?` : state === 'live' || state === 'changes' ? `Publish the changes to “${current?.name ?? ''}”?` : `Publish “${current?.name ?? ''}”?`,
    body: `${lastTest} It starts acting on new events straight away${current ? ` as version ${current.version + 1}` : ''}.${
      chosenEvent.runs ? '' : ' Rules for this event don’t run yet, so it won’t do anything until they do.'
    }`,
    confirmLabel: state === 'live' || state === 'changes' ? 'Publish changes' : 'Publish',
  };

  return (
    <div className="app-Page app-RuleBuilder">
      <PageHeader
        title={title}
        breadcrumbs={crumbs}
        {...(state ? { status: <StatusPill label={RULE_STATES[state].label} tone={RULE_STATES[state].tone} icon={RULE_STATES[state].icon} /> } : {})}
        {...(viewOnly ? { viewOnly } : {})}
        {...(actions.primary ? { primaryAction: { ...actions.primary, ...(busy ? { disabled: true } : {}) } } : {})}
        {...(actions.secondary.length > 0 ? { secondaryActions: actions.secondary } : {})}
        {...(actions.overflow.length > 0
          ? {
              overflow: actions.overflow.map((action) => ({
                id: action.id,
                label: action.label,
                ...(action.icon ? { icon: action.icon } : {}),
                ...(action.tone ? { tone: action.tone } : {}),
                ...(action.href ? { href: action.href } : { onSelect: () => onHeaderAction(action.id) }),
                ...(action.disabledReason ? { disabled: true, disabledReason: action.disabledReason } : {}),
              })),
            }
          : {})}
        onAction={onHeaderAction}
      />

      {liveManageOnly ? (
        <Banner tone="warning" title="Saving takes this rule offline">
          Saving takes this rule offline until someone with publish permission publishes it. Try your changes first — testing doesn’t save anything.
        </Banner>
      ) : null}
      {state === 'changes' ? (
        <Banner tone="warning" title="This rule is offline">
          Its changes were saved but not published, so it isn’t acting on any ticket.{' '}
          {canPublish ? 'Publish the changes to put it back to work.' : 'Someone with publish permission needs to publish them.'}
        </Banner>
      ) : null}
      {state === 'archived' ? (
        <Banner tone="info" title="This rule is archived">
          It doesn’t act on tickets. {canPublish ? 'Restore it to publish it again.' : 'Someone with publish permission can restore it.'}
        </Banner>
      ) : null}

      {current ? (
        <Tabs
          label={`${current.name} sections`}
          value={tab}
          activation="manual"
          onChange={(id) => {
            const next = id === 'history' ? 'history' : 'rule';
            setTab(next);
            window.history.replaceState(null, '', withParam('tab', next === 'history' ? 'history' : null));
          }}
          items={[
            { id: 'rule', label: 'Rule', content: ruleTab },
            {
              id: 'history',
              label: 'History',
              ...(versions.length > 0 ? { badge: String(versions.length) } : {}),
              content: (
                <RuleHistory
                  rule={current}
                  versions={versions}
                  canPublish={canPublish}
                  onRestored={(row) => {
                    setCurrent(toRuleView(row));
                    seenRow.current = `${row.updatedAt}:${row.status}:${row.version}`;
                    const reset = draftFrom(row, { teams: teamsKnown });
                    setDraft(reset);
                    setBaseline(signature(reset));
                    setTest({ kind: 'idle' });
                  }}
                />
              ),
            },
          ]}
        />
      ) : (
        ruleTab
      )}

      {narrow ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="bottom" size="md" title="Try it on recent tickets">
          {panel(3)}
        </Sheet>
      ) : null}

      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={publishSpec}
        onConfirm={async () => {
          await publishNow();
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'offline-save'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={{
          title: 'Take this rule offline?',
          body: canPublish
            ? 'Saving a draft takes this live rule offline until it’s published. To keep it running, use Publish changes instead.'
            : 'Saving takes this rule offline until someone with publish permission publishes it. Until then it won’t act on any ticket.',
          confirmLabel: 'Save as draft',
          tone: 'danger',
        }}
        onConfirm={async () => {
          await saveDraft();
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={{
          title: `Archive “${current?.name ?? ''}”?`,
          body:
            state === 'live'
              ? 'It stops acting on tickets. Restoring it later publishes it again, which needs publish permission.'
              : 'It won’t be listed with the drafts. Restoring it later publishes it.',
          confirmLabel: 'Archive rule',
          tone: 'danger',
        }}
        onConfirm={async () => {
          await archiveNow();
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'restore'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={{
          title: `Restore “${current?.name ?? ''}”?`,
          body: `It goes live again as version ${(current?.version ?? 0) + 1} and acts on new events straight away.`,
          confirmLabel: 'Restore and publish',
        }}
        onConfirm={async () => {
          await publishNow();
          setConfirm(null);
        }}
      />
      {guard.dialog}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BuilderCard({ id, title, description, invalid = false, children }: { readonly id: string; readonly title: string; readonly description?: string; readonly invalid?: boolean; readonly children: ReactNode }): ReactNode {
  return (
    <Surface as="section" tone="raised" elevation="xs" padding="lg" className="app-BuilderCard" aria-labelledby={`${id}-title`} data-invalid={invalid ? '' : undefined}>
      <div id={id} tabIndex={-1} className="app-BuilderCard__anchor" />
      <header className="app-BuilderCard__head">
        <h2 id={`${id}-title`} className="app-BuilderCard__title">
          {title}
        </h2>
        {description ? <p className="app-BuilderCard__description">{description}</p> : null}
      </header>
      {children}
    </Surface>
  );
}

/**
 * The header's buttons for this person and this rule (SPEC §6.1, R1).
 * Exported for the tests: which button a manage-only author sees on a live
 * rule is the whole point.
 */
export function headerActions({
  isNew,
  state,
  dirty,
  canManage,
  canPublish,
  online,
  key,
}: {
  readonly isNew: boolean;
  readonly state: RuleState | null;
  readonly dirty: boolean;
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly online: boolean;
  /** The stored rule's key, for *Duplicate*. */
  readonly key: string | null;
}): { readonly primary: ActionSpec | null; readonly secondary: ActionSpec[]; readonly overflow: ActionSpec[] } {
  const gate = online ? {} : { disabledReason: OFFLINE };
  const publish = (label: string): ActionSpec => ({ id: 'publish', label, icon: 'send', variant: 'primary', ...gate });
  const save = (label: string, primary: boolean): ActionSpec => ({ id: 'save', label, icon: 'check', ...(primary ? { variant: 'primary' as const } : {}), ...gate });
  const secondary: ActionSpec[] = [];
  let primary: ActionSpec | null = null;

  if (isNew) {
    if (canPublish && canManage) {
      primary = publish('Publish');
      secondary.push(save('Save draft', false));
    } else if (canManage) primary = save('Save draft', true);
    return { primary, secondary, overflow: [] };
  }

  switch (state) {
    case 'draft':
      if (canPublish) primary = publish('Publish');
      if (canManage && dirty) {
        if (primary) secondary.push(save('Save draft', false));
        else primary = save('Save draft', true);
      }
      break;
    case 'changes':
      if (canPublish) primary = publish('Publish changes');
      if (canManage && dirty) {
        if (primary) secondary.push(save('Save draft', false));
        else primary = save('Save draft', true);
      }
      break;
    case 'live':
      if (canManage && canPublish) {
        if (dirty) {
          primary = publish('Publish changes');
          secondary.push(save('Save as draft', false));
        }
      } else if (canManage && dirty) {
        primary = save('Save as draft', true);
      }
      break;
    case 'archived':
      if (canPublish) primary = { id: 'restore', label: 'Restore', icon: 'undo-2', variant: 'primary', ...gate };
      break;
    default:
      break;
  }

  if (dirty && canManage && state !== 'archived') secondary.push({ id: 'discard', label: 'Discard changes', icon: 'undo-2' });
  // Duplicate and Archive are occasional, so they wait in the ⋯ menu rather than competing with Publish.
  const overflow: ActionSpec[] = [];
  if (canManage && key) overflow.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', href: `/rules/new?from=${encodeURIComponent(key)}` });
  if (canManage && state !== 'archived' && state !== null) overflow.push({ id: 'archive', label: 'Archive…', icon: 'archive', tone: 'danger', ...gate });
  return { primary, secondary, overflow };
}
