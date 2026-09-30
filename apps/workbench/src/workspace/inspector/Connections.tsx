'use client';

import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketLinkRow, TicketLinkType, TimelineEntry } from '@itsm/sdk';
import { Avatar, Badge, Button, FormField, Input, Select, notify, useItsm } from '@itsm/ui';
import { Dialog, PersonPicker, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { searchPeople } from '../../client/desk-list.js';
import { deskKeys } from '../../client/query-client.js';
import { personName, problemOf, stateLabel, ticketEventType, type PeopleMap } from '../../inbox/presentation.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { inspectorKeys, linksQuery, tagsQuery, watchersQuery } from './queries.js';

/**
 * What the ticket is connected to (SPEC §6.2 "Connections", X-12): its tags,
 * who is watching, and the tickets it is linked to — one section, because
 * each is a short list and three sections of one line each is clutter.
 *
 * Watchers and links read the ticket's own lists where the API has them
 * (WA5); without them the links come from the history's "linked" events and
 * watching is known only from the person's own action.
 */

export const LINK_TYPES: readonly { readonly value: TicketLinkType; readonly label: string }[] = [
  { value: 'related_to', label: 'Related to' },
  { value: 'duplicate_of', label: 'Duplicate of' },
  { value: 'caused_by', label: 'Caused by' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'affects', label: 'Affects' },
  { value: 'parent_of', label: 'Parent of' },
  { value: 'child_of', label: 'Child of' },
];

export function linkLabel(type: string): string {
  return LINK_TYPES.find((entry) => entry.value === type)?.label ?? type.replaceAll('_', ' ');
}

export interface LinkLine {
  readonly number: string;
  readonly type: string;
  readonly title?: string;
  readonly status?: string;
}

/** The links, from the ticket's own list (WA5) or, without it, from its history's "linked" events (newest first, one per ticket). */
export function linkLines(rows: readonly TicketLinkRow[] | null | undefined, entries: readonly TimelineEntry[]): LinkLine[] {
  if (rows) return rows.map((row) => ({ number: row.ticket.number, type: row.linkType, title: row.ticket.title, status: row.ticket.status }));
  const seen = new Set<string>();
  const lines: LinkLine[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind !== 'event' || ticketEventType(entry.type) !== 'ticket.linked') continue;
    const number = entry.payload?.targetNumber;
    const type = entry.payload?.linkType;
    if (typeof number !== 'string' || seen.has(number)) continue;
    seen.add(number);
    lines.push({ number, type: typeof type === 'string' ? type : 'related_to' });
  }
  return lines;
}

/** A ticket number the person typed, tidied: "inc 123" → "INC-000123"; a bare number is left as typed. */
export function tidyNumber(text: string): string {
  const match = /^\s*([a-z]{2,5})[\s-]*0*(\d{1,9})\s*$/i.exec(text);
  if (!match) return text.trim();
  return `${match[1]!.toUpperCase()}-${match[2]!.padStart(6, '0')}`;
}

function openInPane(number: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('t', number);
  url.searchParams.delete('open');
  window.history.pushState(null, '', `${url.pathname}${url.search}`);
}

export function Connections({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { ticket, entries, viewer, people } = ws.bundle;
  const number = ticket.number;
  const can = viewer.can;
  const client = useQueryClient();
  const { Link } = useItsm();
  const tags = useQuery(tagsQuery(number, true)).data;
  const watchers = useQuery(watchersQuery(number, true)).data;
  const links = useQuery(linksQuery(number, true)).data;
  const lines = useMemo(() => linkLines(links, entries), [links, entries]);
  const [watchingNow, setWatchingNow] = useState(false);
  const [adding, setAdding] = useState<'watcher' | 'link' | null>(null);
  const me = viewer.id;

  /* Names for watchers the bundle does not already name (with `identity.user.read`). */
  const unnamed = useMemo(() => (watchers ?? []).map((row) => row.userId.toLowerCase()).filter((id) => !people[id] && id !== me), [watchers, people, me]);
  const extraNames = useQuery({
    queryKey: ['people', ...unnamed],
    queryFn: async (): Promise<PeopleMap> => {
      const rows = await api.users({ ids: unnamed });
      return Object.fromEntries(rows.map((row) => [row.id.toLowerCase(), { name: row.displayName || row.email, initials: '' }]));
    },
    enabled: unnamed.length > 0 && can.readPeople,
    staleTime: 10 * 60_000,
  }).data;
  const names: PeopleMap = useMemo(() => ({ ...people, ...extraNames }), [people, extraNames]);

  const watching = watchingNow || (watchers ?? []).some((row) => row.userId.toLowerCase() === me);
  const watcherIds = (watchers ?? []).map((row) => row.userId.toLowerCase());

  const watch = async (userId: string, mine: boolean): Promise<void> => {
    try {
      await api.watch(number, userId);
      if (mine) setWatchingNow(true);
      void client.invalidateQueries({ queryKey: inspectorKeys.watchers(number) });
      notify(mine ? `You’re watching ${number}` : `${personName(userId, names, me)} is watching ${number}`, { tone: 'success' });
    } catch (error) {
      notify('Couldn’t add the watcher', { tone: 'danger', ...(problemOf(error).detail ? { description: problemOf(error).detail } : {}) });
    }
  };

  const openTicket = (target: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (ws.mode !== 'pane' || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openInPane(target);
  };

  return (
    <div className="app-Connections">
      {tags !== null ? (
        <div className="app-Connections__group">
          <h3 className="app-Connections__heading">Tags</h3>
          {tags === undefined ? (
            <p className="app-Insp__empty">Loading…</p>
          ) : tags.length === 0 ? (
            <p className="app-Insp__empty">No tags</p>
          ) : (
            <ul className="app-Connections__tags">
              {tags.map((tag) => (
                <li key={tag}>
                  <Badge size="sm" tone="neutral" icon="tag">
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="app-Connections__group">
        <h3 className="app-Connections__heading">Watchers</h3>
        {watchers ? (
          watcherIds.length === 0 ? (
            <p className="app-Insp__empty">Nobody is watching yet.</p>
          ) : (
            <ul className="app-Connections__people">
              {watcherIds.map((id) => (
                <li key={id} className="app-Connections__person">
                  <Avatar name={id === me ? viewer.name : (names[id]?.name ?? 'Unknown person')} size="xs" decorative />
                  <span>{personName(id, names, me)}</span>
                </li>
              ))}
            </ul>
          )
        ) : watching ? (
          <p className="app-Insp__empty">You’re watching this ticket.</p>
        ) : (
          <p className="app-Insp__empty">Watchers hear about every change.</p>
        )}
        {can.watch && me ? (
          <div className="app-Connections__actions">
            {!watching ? (
              <Button size="sm" variant="secondary" iconStart="eye" {...(ws.gate ? { disabledReason: ws.gate } : {})} onClick={() => void watch(me, true)}>
                Watch
              </Button>
            ) : null}
            {can.readPeople ? (
              <Button size="sm" variant="ghost" iconStart="user-plus" {...(ws.gate ? { disabledReason: ws.gate } : {})} onClick={() => setAdding('watcher')}>
                Add watcher
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="app-Connections__group">
        <h3 className="app-Connections__heading">Related</h3>
        {lines.length === 0 ? (
          <p className="app-Insp__empty">Not linked to other tickets.</p>
        ) : (
          <ul className="app-Connections__links">
            {lines.map((line) => (
              <li key={`${line.type}:${line.number}`} className="app-Connections__link">
                <span className="app-Connections__linkType">{linkLabel(line.type)}</span>
                <Link href={`/tickets/${encodeURIComponent(line.number)}`} className="app-Connections__linkNumber" onClick={openTicket(line.number)}>
                  {line.number}
                </Link>
                {line.title ? <span className="app-Connections__linkTitle">{line.title}</span> : null}
                {line.status ? <span className="app-Connections__linkStatus">{stateLabel(line.status)}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {can.link ? (
          <div className="app-Connections__actions">
            <Button size="sm" variant="ghost" iconStart="link" {...(ws.gate ? { disabledReason: ws.gate } : {})} onClick={() => setAdding('link')}>
              Link…
            </Button>
          </div>
        ) : null}
      </div>

      {adding === 'watcher' ? (
        <AddWatcherDialog
          number={number}
          exclude={watcherIds}
          onClose={() => setAdding(null)}
          onPick={(person) => {
            setAdding(null);
            void watch(person.id, person.id === me);
          }}
        />
      ) : null}
      {adding === 'link' ? (
        <LinkDialog
          number={number}
          onClose={() => setAdding(null)}
          onLinked={() => {
            setAdding(null);
            void client.invalidateQueries({ queryKey: inspectorKeys.links(number) });
            void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
          }}
        />
      ) : null}
    </div>
  );
}

function AddWatcherDialog({
  number,
  exclude,
  onClose,
  onPick,
}: {
  readonly number: string;
  readonly exclude: readonly string[];
  readonly onClose: () => void;
  readonly onPick: (person: PersonOption) => void;
}): ReactNode {
  const [value, setValue] = useState<PersonOption | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add a watcher to ${number}`}
      description="They’ll hear about every change to it."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onPick(value)}>
            Add watcher
          </Button>
        </>
      }
    >
      <PersonPicker
        aria-label="Person"
        value={value}
        onChange={(next) => setValue(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null))}
        loadPeople={async (query) => (await searchPeople(query)).filter((person) => !exclude.includes(person.id))}
      />
    </Dialog>
  );
}

function LinkDialog({ number, onClose, onLinked }: { readonly number: string; readonly onClose: () => void; readonly onLinked: () => void }): ReactNode {
  const [target, setTarget] = useState('');
  const [type, setType] = useState<TicketLinkType>('related_to');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const link = async (): Promise<void> => {
    const other = tidyNumber(target);
    if (!other) {
      setError('Enter the other ticket’s number, like INC-000118.');
      return;
    }
    if (other.toUpperCase() === number.toUpperCase()) {
      setError('A ticket can’t be linked to itself.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.link(number, other, type);
      notify(`${number} ${linkLabel(type).toLowerCase()} ${other}`, { tone: 'success' });
      onLinked();
    } catch (failure) {
      const problem = problemOf(failure);
      setError(
        problem.status === 404
          ? `There’s no ticket ${other} you can see.`
          : problem.status === 409
            ? 'Those tickets are already linked that way.'
            : (problem.detail ?? 'That didn’t link. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Link ${number}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Linking…" onClick={() => void link()}>
            Link tickets
          </Button>
        </>
      }
    >
      <form
        className="app-LinkForm"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void link();
        }}
      >
        <FormField label="This ticket is">
          <Select value={type} options={LINK_TYPES} onChange={(event) => setType(event.target.value as TicketLinkType)} />
        </FormField>
        <FormField label="Other ticket" hint="Its number, like INC-000118" {...(error ? { error } : {})}>
          <Input
            value={target}
            autoComplete="off"
            onChange={(event) => {
              setTarget(event.target.value);
              setError(undefined);
            }}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
