'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeSummary } from '@itsm/sdk';
import { Avatar, Badge, Button, notify } from '@itsm/ui';
import { Dialog, PersonPicker, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { searchPeople } from '../../client/desk-list.js';
import { personName, problemOf, type PeopleMap } from '../../inbox/presentation.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { inspectorKeys, tagsQuery, timeQuery, watchersQuery } from './queries.js';

/**
 * Effort and watchers (A6 §5.6.5 row 8; v2's Connections, X-12): the time
 * logged on the ticket and what it cost, its tags, and who is watching —
 * one card, because each is a short list and three cards of one line each
 * is clutter. The tickets it is linked to moved to the Related card.
 *
 * Watchers read the ticket's own list where the API has it (WA5); without
 * it, watching is known only from the person's own action.
 */

/** "1 h 20 min · £42.67": time logged and its cost, as the card's first line. */
export function effortLine(summary: TimeSummary, locale = 'en-GB'): string {
  const hours = Math.floor(summary.loggedMinutes / 60);
  const minutes = summary.loggedMinutes % 60;
  const time = summary.loggedMinutes === 0 ? 'No time logged' : hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`;
  if (summary.loggedMinutes === 0 || !summary.currency || summary.cost <= 0) return time;
  const cost = new Intl.NumberFormat(locale, { style: 'currency', currency: summary.currency }).format(summary.cost);
  return `${time} · ${cost}`;
}

export function Connections({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { ticket, viewer, people } = ws.bundle;
  const number = ticket.number;
  const can = viewer.can;
  const client = useQueryClient();
  const tags = useQuery(tagsQuery(number, true)).data;
  const watchers = useQuery(watchersQuery(number, true)).data;
  const time = useQuery(timeQuery(number, ticket.id, true)).data;
  const [watchingNow, setWatchingNow] = useState(false);
  const [adding, setAdding] = useState<'watcher' | null>(null);
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

  return (
    <div className="app-Connections">
      {time ? (
        <div className="app-Connections__group">
          <h3 className="app-Connections__heading">Time logged</h3>
          <p className="app-Connections__effort">{effortLine(time)}</p>
        </div>
      ) : null}

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
