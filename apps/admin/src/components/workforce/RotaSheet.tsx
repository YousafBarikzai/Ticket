'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Button, FormErrorSummary, FormField, FormSection, IconButton, Input, SegmentedControl, Select, TimeField } from '@itsm/ui';
import { Combobox, DatePicker, PersonPicker, Sheet, type ComboboxOption, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { KeyField } from '../KeyField.js';
import { timeZones } from '../sla/presentation.js';
import { membersProblem, moved, zonedInstant } from './presentation.js';
import type { PersonName, RotaView } from './types.js';

/** A team to put a rota under, by name (A6). */
export interface TeamOption {
  readonly value: string;
  readonly label: string;
}

const fieldIds: Readonly<Record<string, string>> = {
  name: 'rota-name',
  key: 'rota-key',
  teamId: 'rota-team',
  timeZone: 'rota-zone',
  handoverAt: 'rota-handover',
  startsAt: 'rota-start',
  members: 'rota-members',
};

/**
 * New rota and Edit rota (SPEC §6.1 Workforce › On call): the name, the team
 * it belongs to, its zone, how often it hands over and at what local time,
 * when the first turn starts (new rotas), and who takes it, in order.
 *
 * Members are reordered with Move up and Move down — buttons, not dragging
 * (SPEC D5) — and the sheet says what reordering does: every future turn
 * moves, so a one-off swap belongs in *Cover a shift…* instead.
 */
export function RotaSheet({
  open,
  onClose,
  rota,
  teams,
  taken,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The rota being edited; absent for a new one. */
  readonly rota?: RotaView;
  readonly teams: readonly TeamOption[];
  /** Keys already used by rotas. */
  readonly taken: readonly string[];
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
      size="md"
      title={rota ? `Edit ${rota.name}` : 'New rota'}
      description={rota ? 'Changes apply to every turn from now on.' : 'Who takes the out-of-hours page, in turn.'}
      dirty={dirty}
      footer={
        <div className="app-WorkforceActions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
            {rota ? 'Save rota' : 'Create rota'}
          </Button>
        </div>
      }
    >
      {open ? (
        <RotaForm
          key={rota?.key ?? 'new'}
          formId={formId}
          {...(rota ? { rota } : {})}
          teams={teams}
          taken={taken}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={() => {
            setDirty(false);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function RotaForm({
  formId,
  rota,
  teams,
  taken,
  onDirtyChange,
  onBusyChange,
  onDone,
}: {
  readonly formId: string;
  readonly rota?: RotaView;
  readonly teams: readonly TeamOption[];
  readonly taken: readonly string[];
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onDone: () => void;
}): ReactNode {
  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);
  const zones = useMemo<ComboboxOption[]>(() => timeZones(browserZone).map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') })), [browserZone]);
  const initialZone = rota?.timeZone ?? browserZone ?? 'Europe/London';

  const [name, setName] = useState(rota?.name ?? '');
  const [key, setKey] = useState(rota?.key ?? '');
  const [keyState, setKeyState] = useState<KeyState>(rota ? 'ok' : 'empty');
  const [teamId, setTeamId] = useState(rota?.teamId ?? (teams.length === 1 ? teams[0]!.value : ''));
  const [zone, setZone] = useState<ComboboxOption | null>(zones.find((option) => option.value === initialZone) ?? { value: initialZone, label: initialZone });
  const [cadence, setCadence] = useState<'weekly' | 'daily'>(rota?.cadence === 'daily' ? 'daily' : 'weekly');
  const [handoverAt, setHandoverAt] = useState<string | null>(rota?.handoverAt ?? '09:00');
  const [startsOn, setStartsOn] = useState<string | null>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const [members, setMembers] = useState<PersonName[]>(() => [...(rota?.members ?? [])]);
  const [adding, setAdding] = useState<PersonOption | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const touch = (patch: () => void): void => {
    patch();
    onDirtyChange(true);
  };

  const save = useMutation(
    (input: { kind: 'create'; body: Parameters<typeof api.observe.queues.createRotation>[0] } | { kind: 'update'; key: string; patch: Parameters<typeof api.observe.queues.updateRotation>[1] }) =>
      input.kind === 'create'
        ? api.observe.queues.createRotation(input.body).then((created): { key: string } => created)
        : api.observe.queues.updateRotation(input.key, input.patch).then((updated): { key: string } => updated),
    { success: () => (rota ? `${name.trim()} saved` : `${name.trim()} created`), failure: rota ? 'Couldn’t save the rota' : 'Couldn’t create the rota' },
  );

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = 'Enter a name for the rota.';
    else if (!rota && keyState !== 'ok') found.key = keyState === 'taken' ? 'Another rota already uses this key. Edit the key or change the name.' : 'Edit the key by hand: this name can’t make one.';
    if (!teamId) found.teamId = 'Choose the team the rota belongs to.';
    if (!zone) found.timeZone = 'Choose the time zone its handovers happen in.';
    if (!handoverAt || !/^\d{2}:\d{2}$/.test(handoverAt)) found.handoverAt = 'Enter the time of day it hands over.';
    if (!rota && !startsOn) found.startsAt = 'Choose the day the first turn starts.';
    const problem = membersProblem(members.map((member) => member.id));
    if (problem) found.members = problem;
    return found;
  };

  const submit = async (): Promise<void> => {
    const found = validate();
    setErrors(found);
    setAttempt((value) => value + 1);
    if (Object.keys(found).length > 0) return;
    onBusyChange(true);
    let result;
    if (rota) {
      const patch: Parameters<typeof api.observe.queues.updateRotation>[1] = {};
      if (name.trim() !== rota.name) patch.name = name.trim();
      if (teamId !== rota.teamId) patch.teamId = teamId;
      if (zone!.value !== rota.timeZone) patch.timeZone = zone!.value;
      if (cadence !== rota.cadence) patch.cadence = cadence;
      if (handoverAt !== rota.handoverAt) patch.handoverAt = handoverAt!;
      if (members.map((member) => member.id).join() !== rota.members.map((member) => member.id).join()) patch.members = members.map((member) => member.id);
      if (Object.keys(patch).length === 0) {
        onBusyChange(false);
        onDone();
        return;
      }
      result = await save.run({ kind: 'update', key: rota.key, patch });
    } else {
      const startsAt = zonedInstant(startsOn!, handoverAt!, zone!.value);
      result = await save.run({
        kind: 'create',
        body: { key, name: name.trim(), teamId, timeZone: zone!.value, cadence, handoverAt: handoverAt!, startsAt: startsAt ?? new Date().toISOString(), members: members.map((member) => member.id) },
      });
    }
    onBusyChange(false);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.problem.status === 409) setErrors({ key: 'Another rota already uses this key. Edit the key or change the name.' });
    else if (result.problem.fieldErrors && Object.keys(result.problem.fieldErrors).length > 0) {
      const mapped: Record<string, string> = {};
      for (const [path, message] of Object.entries(result.problem.fieldErrors)) {
        const head = path.split('.')[0]!;
        mapped[head in fieldIds ? head : 'members'] ??= message;
      }
      setErrors(mapped);
    }
    setAttempt((value) => value + 1);
  };

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: fieldIds[field] ?? '', message }));

  return (
    <form
      id={formId}
      className="app-RotaForm"
      noValidate
      aria-label={rota ? `Edit ${rota.name}` : 'New rota'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}

      <FormSection title="The rota" headingLevel={3}>
        <FormField label="Rota name" hint="Like “Infrastructure out of hours”." required id={fieldIds.name!} {...(errors.name ? { error: errors.name } : {})}>
          <Input name="name" value={name} autoComplete="off" onChange={(event) => touch(() => setName(event.currentTarget.value))} />
        </FormField>
        <div id={fieldIds.key} tabIndex={-1}>
          <KeyField source={name} rule="slug" value={key} onChange={setKey} onStateChange={setKeyState} taken={taken} noun="rota" locked={rota !== undefined} />
          {errors.key ? <p className="app-WorkforceFieldError">{errors.key}</p> : null}
        </div>
        <FormField label="Team" required id={fieldIds.teamId!} {...(errors.teamId ? { error: errors.teamId } : {})}>
          <Select name="teamId" value={teamId} placeholder="Choose a team" options={teams} onChange={(event) => touch(() => setTeamId(event.currentTarget.value))} />
        </FormField>
      </FormSection>

      <FormSection title="Handover" headingLevel={3} description="When the pager passes to the next person, in the rota’s own time zone.">
        <SegmentedControl
          label="How often"
          mode="value"
          value={cadence}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'daily', label: 'Daily' },
          ]}
          onValueChange={(value) => touch(() => setCadence(value as 'weekly' | 'daily'))}
        />
        <FormField label="Time zone" required id={fieldIds.timeZone!} {...(errors.timeZone ? { error: errors.timeZone } : {})}>
          {(control) => (
            <Combobox {...control} options={zones} value={zone} clearable={false} placeholder="Search time zones" emptyMessage="No time zone matches" onChange={(option) => touch(() => setZone(option))} />
          )}
        </FormField>
        <div className="app-RotaForm__pair">
          <FormField label="Hands over at" required id={fieldIds.handoverAt!} {...(errors.handoverAt ? { error: errors.handoverAt } : {})}>
            <TimeField value={handoverAt} step={15} onChange={(value) => touch(() => setHandoverAt(value))} />
          </FormField>
          {rota ? null : (
            <FormField
              label="First turn starts"
              required
              hint={cadence === 'weekly' ? 'Its weekday is the handover day.' : undefined}
              id={fieldIds.startsAt!}
              {...(errors.startsAt ? { error: errors.startsAt } : {})}
            >
              {(control) => <DatePicker {...control} value={startsOn} onChange={(value) => touch(() => setStartsOn(value))} />}
            </FormField>
          )}
        </div>
      </FormSection>

      <FormSection title="People, in turn" headingLevel={3} description="Reordering moves every future turn. For a one-off swap, cover a shift instead.">
        <div id={fieldIds.members} tabIndex={-1} className="app-RotaForm__members">
          {members.length === 0 ? <p className="app-RotaCard__meta">Nobody yet.</p> : null}
          <ol className="app-RotaForm__list">
            {members.map((member, index) => {
              const label = member.name ?? 'Unknown person';
              return (
                <li key={member.id} className="app-RotaForm__member">
                  <span className="app-RotaForm__position" aria-hidden="true">
                    {index + 1}
                  </span>
                  <Avatar name={label} size="sm" decorative />
                  <span className="app-RotaForm__name">{label}</span>
                  <span className="app-RotaForm__moves">
                    <IconButton
                      icon="arrow-up"
                      size="sm"
                      label={`Move ${label} up`}
                      onClick={() => touch(() => setMembers((list) => moved(list, index, 'up')))}
                      {...(index === 0 ? { disabled: true } : {})}
                    />
                    <IconButton
                      icon="arrow-down"
                      size="sm"
                      label={`Move ${label} down`}
                      onClick={() => touch(() => setMembers((list) => moved(list, index, 'down')))}
                      {...(index === members.length - 1 ? { disabled: true } : {})}
                    />
                    <IconButton icon="x" size="sm" label={`Remove ${label} from the rota`} onClick={() => touch(() => setMembers((list) => list.filter((entry) => entry.id !== member.id)))} />
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="app-RotaForm__add">
            <FormField label="Add someone" labelHidden>
              {(control) => (
                <PersonPicker
                  {...control}
                  value={adding}
                  placeholder="Add someone to the rota"
                  onChange={(next) => {
                    const person = Array.isArray(next) ? next[0] : (next as PersonOption | null);
                    if (!person) return;
                    setAdding(null);
                    if (members.some((member) => member.id === person.id)) return;
                    touch(() => setMembers((list) => [...list, { id: person.id, name: person.name }]));
                  }}
                  loadPeople={async (query) => {
                    const rows = await api.tenant.users({ q: query || undefined, limit: 20, status: 'active' });
                    return rows.map((row) => ({ id: row.id, name: row.displayName || row.email, detail: row.email }));
                  }}
                />
              )}
            </FormField>
          </div>
          {errors.members ? <p className="app-WorkforceFieldError">{errors.members}</p> : null}
        </div>
      </FormSection>
    </form>
  );
}
