'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { Button, FormField, Input, Select } from '@itsm/ui';
import { api } from '../client/api.js';
import { slugFor } from '../keys.js';

const TARGET_TYPES = ['response', 'update', 'restoration', 'resolution', 'fulfilment', 'approval'];
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

interface TargetDraft {
  priority: string;
  targetType: string;
  minutes: string;
}

/**
 * Writing a policy and a calendar.
 *
 * A policy needs at least one target — the schema takes `.min(1)` — because a
 * policy with none promises nothing and would sit in the list looking like a
 * commitment. The form starts with one row for that reason rather than an
 * empty list somebody has to notice.
 *
 * `match` is left as "every ticket" here. The expression language is the same
 * one the rules builder draws, but the thing being matched is different — a
 * policy competes on specificity against other policies, so a half-expressed
 * match is not a rule that does nothing, it is a promise that applies to the
 * wrong tickets. Narrowing a policy stays API-only until that is built
 * properly, and the note under the form says so.
 */
export function SlaEditor({
  existingKeys,
  calendarKeys,
}: {
  existingKeys: readonly string[];
  calendarKeys: readonly string[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [calendarMode, setCalendarMode] = useState('group');
  const [targets, setTargets] = useState<TargetDraft[]>([{ priority: 'P1', targetType: 'response', minutes: '60' }]);

  const [calendarName, setCalendarName] = useState('');
  const [timeZone, setTimeZone] = useState('Europe/London');
  const [openFrom, setOpenFrom] = useState('09:00');
  const [openTo, setOpenTo] = useState('17:30');

  const key = slugFor(name);
  const taken = key !== '' && existingKeys.includes(key);
  const calendarKey = slugFor(calendarName);
  const calendarTaken = calendarKey !== '' && calendarKeys.includes(calendarKey);

  async function run(what: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(what);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function patchTarget(index: number, patch: Partial<TargetDraft>): void {
    setTargets((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <section className="itsm-FieldEditor" aria-label="Add a policy or a calendar">
      <h2>Add a policy or a calendar</h2>

      <form
        aria-label="Add a policy"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`Policy ${key} saved.`, async () => {
            await api.configure.sla.createPolicy({
              key,
              name: name.trim(),
              calendarMode,
              targets: targets.map((target) => ({
                priority: target.priority,
                targetType: target.targetType,
                minutes: Number(target.minutes) || 60,
              })),
            });
            setName('');
            setTargets([{ priority: 'P1', targetType: 'response', minutes: '60' }]);
          });
        }}
      >
        <h3>A policy</h3>
        <FormField label="Name" hint="What this promises, like “Standard incident response”.">
          {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        {name.trim() !== '' ? (
          <p className="itsm-FieldEditor__key">
            {key ? (
              taken ? (
                <>
                  <code>{key}</code> is taken by another policy — try different wording.
                </>
              ) : (
                <>
                  Stored as <code>{key}</code>.
                </>
              )
            ) : (
              <>That name cannot make a key — try different wording.</>
            )}
          </p>
        ) : null}

        <FormField label="Which clock" hint="Whose business hours the timer runs on.">
          {(control) => (
            <Select
              {...control}
              value={calendarMode}
              onChange={(e) => setCalendarMode(e.target.value)}
              options={[
                { value: 'group', label: "The assigned group's calendar" },
                { value: 'requester', label: "The requester's calendar" },
                { value: 'fixed', label: 'One fixed calendar' },
              ]}
            />
          )}
        </FormField>

        <fieldset className="itsm-RuleEditor__group">
          <legend>Targets</legend>
          {targets.map((target, index) => (
            <div className="itsm-RuleEditor__row" key={index}>
              <FormField label={`Priority ${index + 1}`}>
                {(control) => (
                  <Select
                    {...control}
                    value={target.priority}
                    onChange={(e) => patchTarget(index, { priority: e.target.value })}
                    options={PRIORITIES.map((one) => ({ value: one, label: one }))}
                  />
                )}
              </FormField>
              <FormField label={`Promise ${index + 1}`}>
                {(control) => (
                  <Select
                    {...control}
                    value={target.targetType}
                    onChange={(e) => patchTarget(index, { targetType: e.target.value })}
                    options={TARGET_TYPES.map((one) => ({ value: one, label: one }))}
                  />
                )}
              </FormField>
              <FormField label={`Within, in minutes ${index + 1}`} hint="Business minutes, not wall-clock.">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={target.minutes}
                    onChange={(e) => patchTarget(index, { minutes: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTargets((rows) => [...rows, { priority: 'P3', targetType: 'resolution', minutes: '480' }])}
          >
            Add a target
          </Button>
        </fieldset>

        <Button type="submit" disabled={busy || key === '' || taken}>
          Save the policy
        </Button>
      </form>

      <form
        aria-label="Add a business calendar"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`Calendar ${calendarKey} saved.`, async () => {
            const weekday = { start: openFrom, end: openTo };
            await api.configure.sla.createCalendar({
              key: calendarKey,
              name: calendarName.trim(),
              timeZone,
              hours: {
                monday: [weekday],
                tuesday: [weekday],
                wednesday: [weekday],
                thursday: [weekday],
                friday: [weekday],
              },
            });
            setCalendarName('');
          });
        }}
      >
        <h3>A business calendar</h3>
        <p className="itsm-Admin__note">
          Monday to Friday at the hours below. Weekend hours and public holidays are reachable through the API and
          have no controls here.
        </p>
        <FormField label="Name" hint="Like “UK office hours”.">
          {(control) => <Input {...control} value={calendarName} onChange={(e) => setCalendarName(e.target.value)} />}
        </FormField>
        {calendarName.trim() !== '' && !calendarKey ? (
          <p className="itsm-FieldEditor__key">That name cannot make a key — try different wording.</p>
        ) : null}
        {calendarTaken ? (
          <p className="itsm-FieldEditor__key">
            <code>{calendarKey}</code> is taken by another calendar.
          </p>
        ) : null}
        <FormField label="Time zone" hint="An IANA name, like Europe/London.">
          {(control) => <Input {...control} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />}
        </FormField>
        <FormField label="Open from">
          {(control) => <Input {...control} type="time" value={openFrom} onChange={(e) => setOpenFrom(e.target.value)} />}
        </FormField>
        <FormField label="Open until">
          {(control) => <Input {...control} type="time" value={openTo} onChange={(e) => setOpenTo(e.target.value)} />}
        </FormField>
        <Button type="submit" disabled={busy || calendarKey === '' || calendarTaken}>
          Save the calendar
        </Button>
      </form>

      {error ? (
        <p className="itsm-FieldEditor__error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="itsm-FieldEditor__done" role="status">
          {done}
        </p>
      ) : null}

      <p className="itsm-Admin__note">
        A new policy matches every ticket. Narrowing it, changing its targets afterwards, setting its specificity
        against other policies, and escalations are all reachable through the API and have no controls here — a
        half-expressed match is not a policy that does nothing, it is one that promises the wrong thing.
      </p>
    </section>
  );
}
