'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button, FormErrorSummary, FormField, FormSection, IconButton, Input, Switch } from '@itsm/ui';
import { Combobox, DatePicker, Sheet, type ComboboxOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { KeyField } from '../KeyField.js';
import { WeekHours, WEEKDAYS, dayProblem, type WeekHoursValue } from '../WeekHours.js';
import type { KeyState } from '../../keys.js';
import { holidaysFrom, timeZones, type HolidayDraft } from './presentation.js';
import type { CalendarView } from './types.js';

/** Monday to Friday, 09:00–17:30: where most desks start. */
const OFFICE_WEEK: WeekHoursValue = {
  mon: [{ start: '09:00', end: '17:30' }],
  tue: [{ start: '09:00', end: '17:30' }],
  wed: [{ start: '09:00', end: '17:30' }],
  thu: [{ start: '09:00', end: '17:30' }],
  fri: [{ start: '09:00', end: '17:30' }],
};

let holidayId = 0;
const newHoliday = (): HolidayDraft => ({ id: `holiday-${++holidayId}`, date: null, name: '' });

/**
 * "New calendar" (SPEC §6.1): name and key, time zone (the browser's own
 * first), the week's business hours on any day with several ranges a day,
 * holidays, and whether it is the desk's default.
 *
 * Calendars cannot be edited once saved (there is no update in the API), so
 * *Duplicate…* on a calendar opens this sheet filled in from it: change what
 * needs changing, save it as a new calendar, point policies at it.
 *
 * Checked before sending with the same rules the API applies
 * (`validateCalendar`: ranges in order, no overlaps, some open time), and
 * the API's own problems land on the hours if one slips through. The day
 * keys are the clock's (`mon`…`sun`) — the old form wrote `monday`, which the
 * clock never read.
 */
export function NewCalendarSheet({
  open,
  onClose,
  calendars,
  from,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly calendars: readonly CalendarView[];
  /** The calendar being duplicated, when there is one. */
  readonly from?: CalendarView;
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
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
      title={from ? `Duplicate ${from.name}` : 'New calendar'}
      description="Business hours the SLA clock counts. Outside them, timers pause."
      dirty={dirty}
      footer={
        <div className="app-SlaSheetFooter">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
            Save calendar
          </Button>
        </div>
      }
    >
      {open ? (
        <NewCalendarForm
          key={from?.key ?? 'new'}
          formId={formId}
          calendars={calendars}
          {...(from ? { from } : {})}
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

const fieldIds: Readonly<Record<string, string>> = {
  name: 'new-calendar-name',
  key: 'new-calendar-key',
  timeZone: 'new-calendar-zone',
  hours: 'new-calendar-hours',
  exceptions: 'new-calendar-holidays',
};

function NewCalendarForm({
  formId,
  calendars,
  from,
  onDirtyChange,
  onBusyChange,
  onCreated,
}: {
  readonly formId: string;
  readonly calendars: readonly CalendarView[];
  readonly from?: CalendarView;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCreated: () => void;
}): ReactNode {
  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);
  const zones = useMemo<ComboboxOption[]>(() => timeZones(browserZone).map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') })), [browserZone]);
  const zoneOption = (zone: string | undefined): ComboboxOption | null => (zone ? (zones.find((option) => option.value === zone) ?? { value: zone, label: zone }) : null);

  const [name, setName] = useState(from ? `${from.name} (copy)` : '');
  const [key, setKey] = useState('');
  const [keyState, setKeyState] = useState<KeyState>('empty');
  const [zone, setZone] = useState<ComboboxOption | null>(() => zoneOption(from?.timeZone ?? browserZone ?? 'Europe/London'));
  const [hours, setHours] = useState<WeekHoursValue>(() => (from ? (from.hours as WeekHoursValue) : OFFICE_WEEK));
  const [holidays, setHolidays] = useState<HolidayDraft[]>([]);
  const [isDefault, setIsDefault] = useState(from?.isDefault ?? calendars.length === 0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const touch = (patch: () => void): void => {
    patch();
    onDirtyChange(true);
  };

  const create = useMutation((input: Record<string, unknown>) => api.configure.sla.createCalendar(input), {
    success: () => `${name.trim()} saved`,
    failure: 'Couldn’t save the calendar',
  });

  const validate = (): { found: Record<string, string>; exceptions: { date: string; type: 'holiday'; name?: string }[] } => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = 'Enter a name for the calendar.';
    else if (keyState !== 'ok') found.key = keyState === 'taken' ? 'Another calendar already uses this key. Edit the key or change the name.' : 'Edit the key by hand: this name can’t make one.';
    if (!zone) found.timeZone = 'Choose the time zone the hours are in.';
    const openDays = WEEKDAYS.filter((day) => (hours[day.id]?.length ?? 0) > 0);
    if (openDays.length === 0) found.hours = 'Open at least one day: a calendar with no hours never counts any time.';
    else {
      const bad = openDays.map((day) => ({ day, problem: dayProblem(hours[day.id] ?? []) })).find((entry) => entry.problem !== null);
      if (bad) found.hours = `${bad.day.label}: ${bad.problem}`;
    }
    const read = holidaysFrom(holidays);
    if ('error' in read) found.exceptions = read.error;
    return { found, exceptions: 'value' in read ? read.value : [] };
  };

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: fieldIds[field] ?? '', message }));

  return (
    <form
      id={formId}
      className="app-NewCalendar"
      noValidate
      aria-label={from ? `Duplicate ${from.name}` : 'New calendar'}
      onSubmit={async (event) => {
        event.preventDefault();
        const { found, exceptions } = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((value) => value + 1);
          return;
        }
        onBusyChange(true);
        const result = await create.run({
          key,
          name: name.trim(),
          timeZone: zone!.value,
          hours,
          isDefault,
          exceptions,
        });
        onBusyChange(false);
        if (result.ok) {
          onCreated();
          return;
        }
        const problem = result.problem;
        if (problem.status === 409) setErrors({ key: 'Another calendar already uses this key. Edit the key or change the name.' });
        else if (problem.status === 422) {
          const fields = problem.fieldErrors ?? {};
          const mapped: Record<string, string> = {};
          for (const [path, message] of Object.entries(fields)) {
            const head = path.split('.')[0]!;
            const field = head in fieldIds ? head : 'hours';
            if (!mapped[field]) mapped[field] = message;
          }
          // Without field errors the toast has already said what went wrong.
          if (Object.keys(mapped).length > 0) setErrors(mapped);
        }
        setAttempt((value) => value + 1);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      {from ? <p className="app-NewCalendar__note">Holidays aren’t copied from {from.name}. Add the ones this calendar needs below.</p> : null}

      <FormSection title="Name" headingLevel={3}>
        <FormField label="Calendar name" hint="Like “UK office hours”." required id={fieldIds.name!} {...(errors.name ? { error: errors.name } : {})}>
          <Input name="name" value={name} autoComplete="off" onChange={(event) => touch(() => setName(event.currentTarget.value))} />
        </FormField>
        <div id={fieldIds.key} tabIndex={-1}>
          <KeyField source={name} rule="slug" value={key} onChange={setKey} onStateChange={setKeyState} taken={calendars.map((calendar) => calendar.key)} noun="calendar" />
          {errors.key ? <p className="app-SlaFieldError">{errors.key}</p> : null}
        </div>
        <FormField label="Time zone" required hint="The hours below are in this zone." id={fieldIds.timeZone!} {...(errors.timeZone ? { error: errors.timeZone } : {})}>
          {(control) => (
            <Combobox
              {...control}
              options={zones}
              value={zone}
              clearable={false}
              placeholder="Search time zones"
              emptyMessage="No time zone matches"
              onChange={(option) => touch(() => setZone(option))}
            />
          )}
        </FormField>
      </FormSection>

      <FormSection title="Business hours" headingLevel={3} description="Any day of the week, with up to four ranges a day.">
        <div id={fieldIds.hours} tabIndex={-1}>
          <WeekHours label="Days and hours" value={hours} onChange={(next) => touch(() => setHours(next))} />
          {errors.hours ? <p className="app-SlaFieldError">{errors.hours}</p> : null}
        </div>
      </FormSection>

      <FormSection title="Holidays" headingLevel={3} description="Days the clock doesn’t count, like bank holidays.">
        <div id={fieldIds.exceptions} tabIndex={-1} className="app-Holidays">
          {holidays.length === 0 ? <p className="app-NewCalendar__note">No holidays yet.</p> : null}
          <ul className="app-Holidays__list">
            {holidays.map((holiday, index) => (
              <li key={holiday.id} className="app-Holidays__row">
                <FormField label={`Holiday ${index + 1} date`}>
                  {(control) => (
                    <DatePicker
                      {...control}
                      value={holiday.date}
                      onChange={(date) => touch(() => setHolidays((rows) => rows.map((row) => (row.id === holiday.id ? { ...row, date } : row))))}
                    />
                  )}
                </FormField>
                <FormField label={`Holiday ${index + 1} name`} optional>
                  <Input
                    value={holiday.name}
                    placeholder="Like “Boxing Day”"
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      touch(() => setHolidays((rows) => rows.map((row) => (row.id === holiday.id ? { ...row, name: text } : row))));
                    }}
                  />
                </FormField>
                <IconButton
                  icon="x"
                  label={`Remove holiday ${index + 1}${holiday.name ? `, ${holiday.name}` : ''}`}
                  onClick={() => touch(() => setHolidays((rows) => rows.filter((row) => row.id !== holiday.id)))}
                />
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" iconStart="plus" onClick={() => touch(() => setHolidays((rows) => [...rows, newHoliday()]))}>
            Add a holiday
          </Button>
          {errors.exceptions ? <p className="app-SlaFieldError">{errors.exceptions}</p> : null}
        </div>
      </FormSection>

      <FormSection title="Default" headingLevel={3}>
        <Switch
          label="Make this the desk’s default calendar"
          description="It is offered first whenever a policy needs a calendar."
          checked={isDefault}
          onChange={(checked) => touch(() => setIsDefault(checked))}
        />
      </FormSection>
    </form>
  );
}
