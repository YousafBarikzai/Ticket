'use client';

import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecordCiRow, TicketLinkRow, TicketLinkType, TimelineEntry } from '@itsm/sdk';
import { Button, FormField, Input, Select, StatusPill, notify, ticketStateLook, useItsm } from '@itsm/ui';
import { Dialog } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { deskKeys } from '../../client/query-client.js';
import { problemOf, stateLabel, ticketEventType } from '../../inbox/presentation.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { cisQuery, inspectorKeys, linksQuery } from './queries.js';
import { RelatedRecords } from './RelatedRecords.js';

/**
 * The inspector's Related card (v3 §7.1.4, A6 §5.6.5 row 6; the "Related"
 * part of v2's Connections). **Phase 1:** the tickets this one is linked to
 * — the link type, the number, the title and its state as a toned
 * `StatusPill` — and the configuration items it is recorded against (R5-W
 * `recordCis`), each with its role and criticality. "Link…" links another
 * ticket (seven link types, v2).
 *
 * **With R17** the problem and its workaround, the major incident and the
 * changes come from `RelatedRecords`, a stub that renders nothing until
 * WP-72 makes it real [V1-M5].
 *
 * Closed until wanted, and loaded on first opening: most tickets are worked
 * without it, so neither its code nor its two reads cost the ticket's first
 * paint.
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
  readonly statusCategory?: string;
}

/** The links, from the ticket's own list (WA5) or, without it, from its history's "linked" events (newest first, one per ticket). */
export function linkLines(rows: readonly TicketLinkRow[] | null | undefined, entries: readonly TimelineEntry[]): LinkLine[] {
  if (rows) {
    return rows.map((row) => ({ number: row.ticket.number, type: row.linkType, title: row.ticket.title, status: row.ticket.status, statusCategory: row.ticket.statusCategory }));
  }
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

/** "Affected", "Cause": how the ticket involved an item, in words. */
export function ciRole(role: string): string {
  const words = role.replaceAll('_', ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Linked';
}

/** "Critical", "High": an item's criticality as a pill's words; neutral, because criticality is not a state (D5). */
export function ciCriticality(criticality: string): string {
  const words = criticality.replaceAll('_', ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} criticality` : 'Criticality not set';
}

function openInPane(number: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('t', number);
  url.searchParams.delete('open');
  window.history.pushState(null, '', `${url.pathname}${url.search}`);
}

function CiRows({ rows }: { readonly rows: readonly RecordCiRow[] }): ReactNode {
  return (
    <ul className="app-Related__list" aria-label="Configuration items">
      {rows.map((row, index) => (
        <li key={row.ci?.id ?? `gone-${index}`} className="app-Related__row" data-kind="ci">
          <span className="app-Related__type">{ciRole(row.role)}</span>
          <span className="app-Related__title">{row.ci ? row.ci.name : 'An item since deleted'}</span>
          {row.ci ? <StatusPill size="sm" tone="neutral" icon="cmdb" label={ciCriticality(row.ci.criticality)} className="app-Related__pill" /> : null}
        </li>
      ))}
    </ul>
  );
}

export function RelatedCard({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { ticket, entries, viewer } = ws.bundle;
  const number = ticket.number;
  const client = useQueryClient();
  const { Link } = useItsm();
  const links = useQuery(linksQuery(number, true)).data;
  const cis = useQuery(cisQuery(number, ticket.id, true)).data;
  const lines = useMemo(() => linkLines(links, entries), [links, entries]);
  const [linking, setLinking] = useState(false);

  const openTicket = (target: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (ws.mode !== 'pane' || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openInPane(target);
  };

  return (
    <div className="app-Related">
      <div className="app-Related__group">
        <h3 className="app-Related__heading">Linked tickets</h3>
        {lines.length === 0 ? (
          <p className="app-Insp__empty">Not linked to other tickets.</p>
        ) : (
          <ul className="app-Related__list" aria-label="Linked tickets">
            {lines.map((line) => {
              const look = line.status ? ticketStateLook(line.status, line.statusCategory) : null;
              return (
                <li key={`${line.type}:${line.number}`} className="app-Related__row" data-kind="ticket">
                  <span className="app-Related__type">{linkLabel(line.type)}</span>
                  <Link href={`/tickets/${encodeURIComponent(line.number)}`} className="app-Related__number" onClick={openTicket(line.number)}>
                    {line.number}
                  </Link>
                  {line.title ? <span className="app-Related__title">{line.title}</span> : null}
                  {look && line.status ? <StatusPill size="sm" tone={look.tone} icon={look.icon} label={stateLabel(line.status)} className="app-Related__pill" /> : null}
                </li>
              );
            })}
          </ul>
        )}
        {viewer.can.link ? (
          <div className="app-Related__actions">
            <Button size="sm" variant="ghost" iconStart="link" {...(ws.gate ? { disabledReason: ws.gate } : {})} onClick={() => setLinking(true)}>
              Link…
            </Button>
          </div>
        ) : null}
      </div>

      {cis !== null ? (
        <div className="app-Related__group">
          <h3 className="app-Related__heading">Configuration items</h3>
          {cis === undefined ? (
            <p className="app-Insp__empty">Loading…</p>
          ) : cis.length === 0 ? (
            <p className="app-Insp__empty">No configuration items recorded.</p>
          ) : (
            <CiRows rows={cis} />
          )}
        </div>
      ) : null}

      <RelatedRecords ticketNumber={number} />

      {linking ? (
        <LinkDialog
          number={number}
          onClose={() => setLinking(false)}
          onLinked={() => {
            setLinking(false);
            void client.invalidateQueries({ queryKey: inspectorKeys.links(number) });
            void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
          }}
        />
      ) : null}
    </div>
  );
}

export default RelatedCard;

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
