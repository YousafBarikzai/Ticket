'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, FormErrorSummary, FormField, FormSection, Input, NumberField, RadioGroup, Select, Switch } from '@itsm/ui';
import { formatList } from '@itsm/ui/format';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { ConditionBuilder } from '../ConditionBuilder.js';
import { KeyField } from '../KeyField.js';
import type { KeyState } from '../../keys.js';
import {
  PRIMARY_TARGET_TYPES,
  autoSpecificity,
  describeConditions,
  rankAgainst,
  targetsFrom,
  type TargetsModel,
} from './presentation.js';
import { TargetsGrid } from './TargetsGrid.js';
import type { CalendarOption, PolicyView } from './types.js';

/**
 * The facts a policy can match on: the ticket as it is raised. The clock
 * evaluates a policy against the ticket alone (`timer-service` builds the
 * context from it), so requester and comment facts — which the rules builder
 * offers — would never match here and are not offered.
 */
export const SLA_FACTS: readonly string[] = ['ticket.type', 'ticket.priority', 'ticket.impact', 'ticket.urgency', 'ticket.sourceChannel', 'ticket.title'];

type Applies = 'every' | 'some';
type Clock = 'group' | 'fixed';

const EMPTY_TARGETS: TargetsModel = { cells: {}, types: [...PRIMARY_TARGET_TYPES], thresholds: {} };

/**
 * "New policy" (SPEC §6.1): one scroll in sections — Name, Applies to,
 * Clock, Targets, Advanced — ending in **Create and publish**.
 *
 * The API makes a policy live the moment it is created, and it starts
 * timing new tickets at once, so the button says so and a confirmation
 * repeats what it will match before anything is sent (F26: "policies go live
 * silently").
 *
 * Fixed-calendar mode now has its calendar picker (F26) and sends
 * `calendarId`; the team's-calendar mode offers the same picker as its
 * fallback for tickets whose team has no hours, which is what the clock does
 * with it. "Requester's calendar" is not offered: the API accepts it, but the
 * clock does not look up a requester's hours, so it would promise something
 * that never happens.
 */
export function NewPolicySheet({
  open,
  onClose,
  policies,
  calendars,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly policies: readonly PolicyView[];
  readonly calendars: readonly CalendarOption[];
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const online = useOnline();

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDirty(false);
          onClose();
        }
      }}
      size="lg"
      title="New policy"
      description="A promise about how long tickets may take. It applies to new tickets as soon as it is created."
      dirty={dirty}
      footer={
        <div className="app-SlaSheetFooter">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={busy}
            {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}
          >
            Create and publish
          </Button>
        </div>
      }
    >
      {open ? (
        <NewPolicyForm
          formId={formId}
          policies={policies}
          calendars={calendars}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onCreated={() => {
            setDirty(false);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function NewPolicyForm({
  formId,
  policies,
  calendars,
  onDirtyChange,
  onBusyChange,
  onCreated,
}: {
  readonly formId: string;
  readonly policies: readonly PolicyView[];
  readonly calendars: readonly CalendarOption[];
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCreated: () => void;
}): ReactNode {
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyState, setKeyState] = useState<KeyState>('empty');
  const [applies, setApplies] = useState<Applies>('every');
  const [match, setMatch] = useState<unknown>({ always: true });
  const [clock, setClock] = useState<Clock>('group');
  const [fallback, setFallback] = useState<string>('');
  const [fixedCalendar, setFixedCalendar] = useState<string>(defaultCalendar?.id ?? '');
  const [targets, setTargets] = useState<TargetsModel>(EMPTY_TARGETS);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [thresholdErrors, setThresholdErrors] = useState<Readonly<Record<string, string>>>({});
  const [ownSpecificity, setOwnSpecificity] = useState(false);
  const [specificity, setSpecificity] = useState<number | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const effectiveMatch = applies === 'every' ? { always: true } : match;
  const auto = autoSpecificity(effectiveMatch);
  const rank = ownSpecificity && specificity !== null ? specificity : auto;
  const position = rankAgainst(rank, policies);
  const calendarId = clock === 'fixed' ? fixedCalendar : fallback;

  const touch = (patch: () => void): void => {
    patch();
    onDirtyChange(true);
  };

  const create = useMutation((input: Record<string, unknown>) => api.configure.sla.createPolicy(input), {
    success: () => `${name.trim()} is live`,
    failure: 'Couldn’t create the policy',
  });

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = 'Enter a name for the policy.';
    else if (keyState !== 'ok') {
      found.key =
        keyState === 'taken'
          ? 'Another policy already uses this key. Edit the key or change the name.'
          : keyState === 'reserved'
            ? 'That key is reserved. Edit the key.'
            : 'This name can’t make a key. Edit the key by hand.';
    }
    if (applies === 'some' && describeConditions(match) === 'Every ticket') {
      found.match = 'Add at least one condition, or choose Every ticket.';
    }
    if (clock === 'fixed' && !fixedCalendar) found.calendarId = 'Choose the calendar the clock runs on.';
    if (invalid.size > 0) found.targets = 'Some targets aren’t durations. Use hours and minutes, like 4h or 30m.';
    else if (Object.keys(thresholdErrors).length > 0) found.targets = 'Fix the warning thresholds under Advanced.';
    else if (targetsFrom(targets).length === 0) found.targets = 'Set at least one target — a policy with none promises nothing.';
    if (ownSpecificity && specificity === null) found.specificity = 'Enter a specificity from 0 to 1000.';
    return found;
  };

  const payload = (): Record<string, unknown> => ({
    key,
    name: name.trim(),
    match: effectiveMatch,
    specificity: rank,
    calendarMode: clock,
    calendarId: calendarId || null,
    targets: targetsFrom(targets),
  });

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: fieldIds[field] ?? '', message }));
  const matches = describeConditions(effectiveMatch);

  return (
    <form
      id={formId}
      className="app-NewPolicy"
      noValidate
      aria-label="New policy"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((value) => value + 1);
          return;
        }
        setConfirming(true);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}

      <FormSection title="Name" headingLevel={3}>
        <FormField label="Policy name" hint="What this promises, like “Standard incident response”." required id={fieldIds.name!} {...(errors.name ? { error: errors.name } : {})}>
          <Input name="name" value={name} autoComplete="off" onChange={(event) => touch(() => setName(event.currentTarget.value))} />
        </FormField>
        <div id={fieldIds.key} tabIndex={-1}>
          <KeyField source={name} rule="slug" value={key} onChange={setKey} onStateChange={setKeyState} taken={policies.map((policy) => policy.key)} noun="policy" />
          {errors.key ? <p className="app-SlaFieldError">{errors.key}</p> : null}
        </div>
      </FormSection>

      <FormSection title="Applies to" headingLevel={3}>
        <RadioGroup<Applies>
          label="Which tickets"
          labelHidden
          variant="cards"
          columns={2}
          value={applies}
          onChange={(value) => touch(() => setApplies(value))}
          options={[
            { value: 'every', label: 'Every ticket', description: 'The fallback: it applies whenever nothing more specific does.', icon: 'ticket' },
            { value: 'some', label: 'Only some tickets…', description: 'Narrow it by type, priority, impact, urgency, channel or title.', icon: 'list-filter' },
          ]}
        />
        {applies === 'some' ? (
          <div id={fieldIds.match} tabIndex={-1}>
            <ConditionBuilder label="Conditions" value={match} facts={SLA_FACTS} emptyText="Add a condition to narrow it" onChange={(next) => touch(() => setMatch(next))} />
            {errors.match ? <p className="app-SlaFieldError">{errors.match}</p> : null}
          </div>
        ) : null}
      </FormSection>

      <FormSection title="Clock" headingLevel={3} description="Whose business hours the timers count.">
        <RadioGroup<Clock>
          label="Clock"
          labelHidden
          variant="cards"
          columns={2}
          value={clock}
          onChange={(value) => touch(() => setClock(value))}
          options={[
            { value: 'group', label: 'Team’s calendar', description: 'The assigned team’s business hours, so each team keeps its own.', icon: 'people' },
            {
              value: 'fixed',
              label: 'One fixed calendar',
              description: calendars.length > 0 ? 'The same business hours for every ticket it applies to.' : 'Add a calendar first, on the Calendars tab.',
              icon: 'calendar',
              disabled: calendars.length === 0,
            },
          ]}
        />
        {clock === 'fixed' ? (
          <FormField label="Calendar" required id={fieldIds.calendarId!} {...(errors.calendarId ? { error: errors.calendarId } : {})}>
            <Select
              name="calendarId"
              value={fixedCalendar}
              onChange={(event) => touch(() => setFixedCalendar(event.currentTarget.value))}
              placeholder="Choose a calendar"
              options={calendars.map((calendar) => ({ value: calendar.id, label: `${calendar.name} · ${calendar.timeZone}${calendar.isDefault ? ' · default' : ''}` }))}
            />
          </FormField>
        ) : (
          <FormField label="When the team has no business hours" hint="Tickets with no team, or a team without a calendar, use this.">
            <Select
              name="fallback"
              value={fallback}
              onChange={(event) => touch(() => setFallback(event.currentTarget.value))}
              options={[
                { value: '', label: 'Around the clock' },
                ...calendars.map((calendar) => ({ value: calendar.id, label: `${calendar.name} · ${calendar.timeZone}` })),
              ]}
            />
          </FormField>
        )}
      </FormSection>

      <FormSection title="Targets" headingLevel={3} description="How long each priority may take. An empty cell sets no target.">
        <div id={fieldIds.targets} tabIndex={-1}>
          <TargetsGrid
            label="Targets"
            value={targets}
            onChange={(next) => touch(() => setTargets(next))}
            invalid={invalid}
            onInvalidChange={setInvalid}
            thresholdErrors={thresholdErrors}
            onThresholdErrorsChange={setThresholdErrors}
          />
          {errors.targets ? <p className="app-SlaFieldError">{errors.targets}</p> : null}
        </div>
      </FormSection>

      <FormSection title="Advanced" headingLevel={3} collapsible>
        <p className="app-NewPolicy__note">
          Policies are checked from the most specific down, and the first that matches applies. By default a policy counts ten for each condition,
          so this one counts {auto}.
        </p>
        <Switch
          label="Set the specificity myself"
          checked={ownSpecificity}
          onChange={(checked) =>
            touch(() => {
              setOwnSpecificity(checked);
              if (checked && specificity === null) setSpecificity(auto);
            })
          }
        />
        {ownSpecificity ? (
          <FormField label="Specificity" hint="0 to 1000; higher is checked first." id={fieldIds.specificity!} {...(errors.specificity ? { error: errors.specificity } : {})}>
            <NumberField value={specificity} min={0} max={1000} step={10} onChange={(value) => touch(() => setSpecificity(value))} />
          </FormField>
        ) : null}
        <p className="app-NewPolicy__rank" aria-live="polite">
          {rankSentence(position)}
        </p>
      </FormSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        spec={{
          title: `Create and publish ${name.trim() || 'this policy'}?`,
          body: `This policy starts applying to new tickets immediately. It matches ${matches === 'Every ticket' ? 'every ticket' : `tickets where ${matches}`}${
            position.above.length > 0 ? ` that no policy above it (${formatList(position.above.slice(0, 3), { locale: 'en-GB' })}${position.above.length > 3 ? ' and others' : ''}) matches first` : ''
          }.`,
          confirmLabel: 'Create and publish',
        }}
        onConfirm={async () => {
          onBusyChange(true);
          const result = await create.run(payload());
          onBusyChange(false);
          setConfirming(false);
          if (result.ok) {
            onCreated();
            return;
          }
          const problem = result.problem;
          if (problem.status === 409) {
            setErrors({ key: 'Another policy already uses this key. Edit the key or change the name.' });
            setAttempt((value) => value + 1);
          } else if (problem.fieldErrors && Object.keys(problem.fieldErrors).length > 0) {
            setErrors(mapServerErrors(problem.fieldErrors));
            setAttempt((value) => value + 1);
          }
        }}
      />
    </form>
  );
}

/** Where each field's error links to, for the summary. */
const fieldIds: Readonly<Record<string, string>> = {
  name: 'new-policy-name',
  key: 'new-policy-key',
  match: 'new-policy-match',
  calendarId: 'new-policy-calendar',
  targets: 'new-policy-targets',
  specificity: 'new-policy-specificity',
};

/** The API's field paths (`targets.0.minutes`) folded onto the sections that own them. */
export function mapServerErrors(fieldErrors: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const head = path.split('.')[0]!;
    const field = head === 'calendarMode' ? 'calendarId' : head === 'escalations' ? 'targets' : head;
    if (!out[field]) out[field] = message;
  }
  return out;
}

/** "Checked after VIP tickets and before Default." */
export function rankSentence(position: { readonly above: readonly string[]; readonly below: readonly string[]; readonly tied: readonly string[] }): string {
  const list = (names: readonly string[]): string => (names.length > 3 ? `${formatList(names.slice(0, 3), { locale: 'en-GB' })} and ${names.length - 3} more` : formatList(names, { locale: 'en-GB' }));
  const parts: string[] = [];
  if (position.above.length > 0) parts.push(`after ${list(position.above)}`);
  if (position.below.length > 0) parts.push(`before ${list(position.below)}`);
  const sentence = parts.length > 0 ? `Checked ${parts.join(' and ')}.` : 'The only policy, so it applies to every ticket it matches.';
  return position.tied.length > 0 ? `${sentence} Ties with ${list(position.tied)}: raise or lower it so the order is certain.` : sentence;
}
