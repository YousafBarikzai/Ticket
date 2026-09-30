'use client';

import { useState, type ReactNode } from 'react';
import { Avatar, Button, EmptyState, FormField, IconButton, InlineAlert, Input, StatusPill, Surface, useItsm } from '@itsm/ui';
import { Dialog, PersonPicker, type PersonOption } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { cadenceSentence, readLocalDateTime, spanText, toLocalInput } from './presentation.js';
import { formatDateTime } from '@itsm/ui/format';
import { RotaSheet, type TeamOption } from './RotaSheet.js';
import type { PersonName, RotaView, WorkforceHeader } from './types.js';

const named = (person: PersonName | null | undefined): string => (person ? (person.name ?? 'Unknown person') : 'Nobody');

/**
 * Workforce › On call (SPEC §6.1): one card per rota — how it hands over,
 * who has it now (and whether they are covering), who is next, and the
 * order of the rota.
 *
 * *Cover a shift…* (`workload.oncall.override`) asks who covers, from when
 * to when and why, and adds an override; the rota's existing overrides are
 * listed on its card with *Remove*. This is where the Command centre's
 * *Cover…* lands.
 */
export function OnCallView({
  header,
  rotas,
  canCover,
  teams,
}: {
  readonly header: WorkforceHeader;
  readonly rotas: readonly RotaView[];
  readonly canCover: boolean;
  /** Teams a rota can belong to (A6), for people who may manage rotas; absent otherwise, and there is no New or Edit. */
  readonly teams?: readonly TeamOption[];
}): ReactNode {
  const [covering, setCovering] = useState<RotaView | null>(null);
  const [editing, setEditing] = useState<RotaView | 'new' | null>(null);
  const canManage = teams !== undefined && teams.length > 0;

  return (
    <div className="app-Page app-Workforce">
      <PageHeader
        title="Workforce"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-rota', label: 'New rota', icon: 'plus', variant: 'primary', shortcut: 'c' } } : {})}
        onAction={(id) => {
          if (id === 'new-rota') setEditing('new');
        }}
      />
      {rotas.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No on-call rotas"
          description="Nothing escalates to an on-call person yet. A rota says who takes the out-of-hours page, in turn."
          {...(canManage ? { action: { id: 'new-rota', label: 'New rota', icon: 'plus', variant: 'primary' } } : {})}
          onAction={() => setEditing('new')}
        />
      ) : (
        <ul className="app-Rotas" aria-label="On-call rotas">
          {rotas.map((rota) => (
            <li key={rota.key}>
              <RotaCard rota={rota} canCover={canCover} canManage={canManage} onCover={() => setCovering(rota)} onEdit={() => setEditing(rota)} />
            </li>
          ))}
        </ul>
      )}
      {covering ? <CoverDialog rota={covering} onClose={() => setCovering(null)} /> : null}
      {canManage ? (
        <RotaSheet
          open={editing !== null}
          onClose={() => setEditing(null)}
          {...(editing && editing !== 'new' ? { rota: editing } : {})}
          teams={teams}
          taken={rotas.map((rota) => rota.key)}
        />
      ) : null}
    </div>
  );
}

function RotaCard({
  rota,
  canCover,
  canManage,
  onCover,
  onEdit,
}: {
  readonly rota: RotaView;
  readonly canCover: boolean;
  readonly canManage: boolean;
  readonly onCover: () => void;
  readonly onEdit: () => void;
}): ReactNode {
  const { locale, timeZone } = useItsm();
  const titleId = `rota-${rota.key}`;
  const now = rota.now;
  const remove = useMutation((id: string) => api.observe.queues.removeOverride(id), {
    success: 'Cover removed',
    failure: 'Couldn’t remove the cover',
  });

  return (
    <Surface as="article" tone="raised" elevation="sm" padding="lg" className="app-RotaCard" aria-labelledby={titleId}>
      <header className="app-RotaCard__head">
        <div>
          <h2 className="app-RotaCard__title" id={titleId}>
            {rota.name}
          </h2>
          <p className="app-RotaCard__meta">
            {rota.teamName ? `${rota.teamName} · ` : ''}
            {cadenceSentence(rota, now?.next?.at, locale)}
          </p>
        </div>
        {canCover || canManage ? (
          <div className="app-RotaCard__actions">
            {canManage ? (
              <Button variant="ghost" size="sm" iconStart="pencil" onClick={onEdit}>
                Edit rota
              </Button>
            ) : null}
            {canCover ? (
              <Button variant="secondary" size="sm" iconStart="user-plus" onClick={onCover}>
                Cover a shift…
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {now === null ? (
        <InlineAlert tone="warning">Couldn’t work out who is on call for this rota. Refresh to try again.</InlineAlert>
      ) : (
        <div className="app-RotaCard__now">
          <Avatar name={named(now.person)} size="lg" decorative {...(now.person ? {} : { kind: 'system' as const })} />
          <div className="app-RotaCard__who">
            <p className="app-RotaCard__label">Now</p>
            <p className="app-RotaCard__name">
              {now.person ? named(now.person) : 'Nobody on call'} {now.covering ? <StatusPill size="sm" tone="info" label="Covering" /> : null}
            </p>
            {now.next ? (
              <p className="app-RotaCard__next">
                Next: {named(now.next.person)} from {formatDateTime(now.next.at, { locale, timeZone: rota.timeZone, style: 'weekdayTime' })}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {rota.members.length > 0 ? (
        <div className="app-RotaCard__members">
          <h3 className="app-RotaCard__subhead">In turn</h3>
          <ol className="app-RotaCard__order">
            {rota.members.map((member) => (
              <li key={member.id}>
                <Avatar name={named(member)} size="xs" decorative />
                <span>{named(member)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {now && now.overrides.length > 0 ? (
        <div className="app-RotaCard__overrides">
          <h3 className="app-RotaCard__subhead">Cover</h3>
          <ul className="app-RotaCard__coverList">
            {now.overrides.map((override) => (
              <li key={override.id} className="app-RotaCard__cover">
                <span>
                  <strong>{named(override.person)}</strong> · {spanText(override.startsAt, override.endsAt, locale, timeZone)}
                  {override.reason ? <span className="app-RotaCard__reason"> · {override.reason}</span> : null}
                </span>
                {canCover ? (
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Remove ${named(override.person)}’s cover, ${spanText(override.startsAt, override.endsAt, locale, timeZone)}`}
                    onClick={() => void remove.run(override.id)}
                    {...(remove.pending ? { disabled: true } : {})}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Surface>
  );
}

/**
 * Who covers, when, and why → an override on the rota. Times are in the
 * browser's zone (said under the fields); the API stores instants.
 */
function CoverDialog({ rota, onClose }: { readonly rota: RotaView; readonly onClose: () => void }): ReactNode {
  const [now] = useState(() => new Date());
  const tonight = new Date(now);
  tonight.setHours(18, 0, 0, 0);
  if (tonight.getTime() < now.getTime()) tonight.setTime(now.getTime() + 60 * 60 * 1000);
  const morning = new Date(tonight);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);

  const [person, setPerson] = useState<PersonOption | null>(null);
  const [from, setFrom] = useState(toLocalInput(tonight));
  const [to, setTo] = useState(toLocalInput(morning));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const online = useOnline();
  const zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'your time zone';
    }
  })();

  const add = useMutation(
    (input: { userId: string; startsAt: string; endsAt: string; reason?: string }) => api.observe.queues.addOverride(rota.key, input),
    { success: () => `${person?.name ?? 'Cover'} covers ${rota.name}`, failure: 'Couldn’t add the cover' },
  );

  const submit = async (): Promise<void> => {
    const found: Record<string, string> = {};
    const start = readLocalDateTime(from, new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const end = readLocalDateTime(to, new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (!person) found.person = 'Choose who covers.';
    if (!start) found.from = 'Enter when the cover starts.';
    if (!end) found.to = 'Enter when the cover ends.';
    else if (start && end.getTime() <= start.getTime()) found.to = 'The cover must end after it starts.';
    else if (end.getTime() <= Date.now()) found.to = 'The cover must end in the future.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !person || !start || !end) return;
    const result = await add.run({ userId: person.id, startsAt: start.toISOString(), endsAt: end.toISOString(), ...(reason.trim() ? { reason: reason.trim() } : {}) });
    if (result.ok) onClose();
    else if (result.problem.fieldErrors) setErrors({ ...result.problem.fieldErrors });
  };

  return (
    <Dialog open onClose={onClose} title={`Cover ${rota.name}`} description="Someone takes the rota for a while; the rota itself doesn’t change." size="sm">
      <form
        className="app-Cover"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField label="Who covers" required {...(errors.person ?? errors.userId ? { error: errors.person ?? errors.userId } : {})}>
          {(control) => (
            <PersonPicker
              {...control}
              value={person}
              onChange={(next) => setPerson(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null))}
              loadPeople={async (query) => {
                const rows = await api.tenant.users({ q: query, limit: 20, status: 'active' });
                return rows.map((row) => ({ id: row.id, name: row.displayName || row.email, detail: row.email }));
              }}
              placeholder="Search people"
            />
          )}
        </FormField>
        <div className="app-Cover__span">
          <FormField label="From" required {...(errors.from ?? errors.startsAt ? { error: errors.from ?? errors.startsAt } : {})}>
            <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          </FormField>
          <FormField label="To" required {...(errors.to ?? errors.endsAt ? { error: errors.to ?? errors.endsAt } : {})}>
            <Input type="datetime-local" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          </FormField>
        </div>
        <p className="app-Cover__zone">Times are in {zone.replace(/_/g, ' ')}.</p>
        <FormField label="Reason" optional>
          <Input value={reason} maxLength={200} placeholder="Like “Swap with Priya”" onChange={(event) => setReason(event.currentTarget.value)} />
        </FormField>
        <div className="app-WorkforceActions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={add.pending} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
            Add cover
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
