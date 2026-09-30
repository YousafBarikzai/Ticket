'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AvatarStack, SegmentedControl, StatusPill, Surface, useItsm } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { Menu } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useMutation } from '../../client/useMutation.js';
import { AvailabilityDialog, type AvailabilityChoice } from './AvailabilityDialog.js';
import { STATUS_LOOK, groupOf, statusLabel, statusNote, summarise, summaryLine, type AvailabilityStatus, type Group } from './presentation.js';
import type { AvailabilityView, WorkforceHeader } from './types.js';

type Scope = 'all' | Group;

interface Pending {
  readonly status: string;
  readonly until: string | null;
  readonly reason: string | null;
}

/**
 * Workforce › Now (SPEC §6.1): who can take work, as routing sees it.
 *
 * The summary line counts what routing acts on (`effectiveStatus`); the
 * table's Status is that too, with a note when what somebody set has run out
 * ("Set ‘Away’ until 14:00 — expired"). The list is complete, so search and
 * the All / Available / Away / Offline switch work on it in place.
 *
 * A row the signed-in person may change (their own; anyone's with the
 * `any` scope) has its status as a menu: Available, Busy and Off shift apply
 * at once, *Away…* asks until when and why. Changes show immediately and
 * the toast offers Undo, which puts back what was there.
 */
export function NowView({
  header,
  rows,
  onCall,
  me,
  canSetOwn,
}: {
  readonly header: WorkforceHeader;
  readonly rows: readonly AvailabilityView[];
  /** Who has the pager now, one per rota. */
  readonly onCall: readonly { readonly name: string }[];
  /** The signed-in person's id and name, for "Set my availability". */
  readonly me: { readonly id: string | null; readonly name: string };
  readonly canSetOwn: boolean;
}): ReactNode {
  const { locale, timeZone } = useItsm();
  const [scope, setScope] = useState<Scope>('all');
  const [pending, setPending] = useState<Readonly<Record<string, Pending>>>({});
  const [synced, setSynced] = useState(rows);
  const [dialog, setDialog] = useState<{ readonly userId: string | null; readonly name: string; readonly initial: AvailabilityStatus } | null>(null);

  // Fresh rows from the server replace anything shown optimistically.
  if (synced !== rows) {
    setSynced(rows);
    setPending({});
  }

  const shown = useMemo(
    () =>
      rows.map((row) => {
        const change = pending[row.userId];
        return change ? { ...row, status: change.status, effectiveStatus: change.status, until: change.until, reason: change.reason } : row;
      }),
    [pending, rows],
  );
  const summary = summarise(shown);
  const counts: Record<Scope, number> = { all: shown.length, available: summary.available, away: summary.away, offline: summary.offline };
  const visible = scope === 'all' ? shown : shown.filter((row) => groupOf(row.effectiveStatus) === scope);

  const set = useMutation(
    async (input: { userId: string | null; name: string; choice: AvailabilityChoice; before: Pending | null }) => {
      await api.observe.queues.setAvailability({
        ...(input.userId && input.userId !== me.id ? { userId: input.userId } : {}),
        status: input.choice.status,
        ...(input.choice.until ? { until: input.choice.until } : {}),
        ...(input.choice.reason ? { reason: input.choice.reason } : {}),
      } as never);
      return input;
    },
    {
      success: (input) => `${input.userId === me.id || input.userId === null ? 'You’re' : `${input.name} is`} now ${statusLabel(input.choice.status).toLowerCase()}`,
      failure: 'Couldn’t change the availability',
      undo: async (input) => {
        if (!input.before) return;
        await api.observe.queues.setAvailability({
          ...(input.userId && input.userId !== me.id ? { userId: input.userId } : {}),
          status: input.before.status as AvailabilityStatus,
          // An "until" that has passed cannot be put back (the API refuses it); the status can.
          ...(input.before.until && new Date(input.before.until).getTime() > Date.now() ? { until: input.before.until } : {}),
          ...(input.before.reason ? { reason: input.before.reason } : {}),
        });
      },
    },
  );

  const change = async (row: AvailabilityView | null, userId: string | null, name: string, choice: AvailabilityChoice): Promise<boolean> => {
    const id = userId ?? me.id;
    if (id) setPending((current) => ({ ...current, [id]: { status: choice.status, until: choice.until ?? null, reason: choice.reason ?? null } }));
    const result = await set.run({ userId, name, choice, before: row ? { status: row.status, until: row.until, reason: row.reason } : null });
    if (!result.ok && id) {
      setPending((current) => {
        const { [id]: _dropped, ...rest } = current;
        return rest;
      });
    }
    return result.ok;
  };

  const columns: ColumnSpec[] = [
    { id: 'person', header: 'Person', field: 'person.name', kind: 'title', width: '2fr', minWidth: 200 },
    { id: 'status', header: 'Status', field: 'effectiveStatus', kind: 'status', map: STATUS_LOOK, srPrefix: 'Status', width: '2fr', cardRole: 'badge' },
    { id: 'until', header: 'Until', field: 'until', kind: 'relative', hideBelow: 'md', width: '1fr', empty: '—' },
    { id: 'capacity', header: 'Capacity', field: 'capacity', kind: 'number', align: 'end', width: 112, hideBelow: 'sm', empty: 'Default' },
    { id: 'reason', header: 'Reason', field: 'reason', kind: 'text', hideBelow: 'lg', width: '2fr', truncate: 1 },
    { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', hideBelow: 'lg', width: '1fr', sortable: 'page' },
  ];

  const mine = rows.find((row) => row.userId === me.id);
  // Someone who is available and opens this usually wants to step away; anyone else starts from what they set.
  const mineInitial: AvailabilityStatus = !mine || mine.status === 'available' ? 'away' : (mine.status as AvailabilityStatus);

  return (
    <div className="app-Page app-Workforce">
      <PageHeader
        title="Workforce"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canSetOwn ? { primaryAction: { id: 'set-mine', label: 'Set my availability', variant: 'primary', icon: 'user' } } : {})}
        onAction={(id) => {
          if (id === 'set-mine') setDialog({ userId: null, name: 'yourself', initial: mineInitial });
        }}
      />

      <Surface as="section" tone="raised" elevation="sm" padding="md" className="app-NowSummary" aria-label="Right now">
        <p className="app-NowSummary__line">{summaryLine(summary)}</p>
        {onCall.length > 0 ? (
          <div className="app-NowSummary__onCall">
            <span className="app-NowSummary__label">On call</span>
            <AvatarStack people={onCall} size="sm" label="On call now" locale={locale} max={4} />
          </div>
        ) : null}
      </Surface>

      <h2 className="itsm-visually-hidden">Availability</h2>
      <DataTable<AvailabilityView>
        caption="Availability"
        captionHidden
        columns={columns}
        rows={visible}
        rowKey="userId"
        search={{ placeholder: 'Search people', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'callback' }}
        pagination={{ mode: 'none' }}
        countNoun={{ one: 'person', other: 'people' }}
        toolbarEnd={
          <SegmentedControl
            label="Show"
            mode="value"
            size="sm"
            value={scope}
            onValueChange={(value) => setScope(value as Scope)}
            options={(['all', 'available', 'away', 'offline'] as const).map((value) => ({
              value,
              label: value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1),
              count: counts[value],
            }))}
          />
        }
        cells={{
          status: (row) => {
            const look = STATUS_LOOK[row.effectiveStatus] ?? { label: statusLabel(row.effectiveStatus), tone: 'neutral' as const, icon: 'dot' as const };
            const note = statusNote(row, locale, timeZone);
            const pill = <StatusPill size="sm" srPrefix="Status" label={look.label} tone={look.tone} icon={look.icon} />;
            return (
              <span className="app-NowStatus">
                {row.editable ? (
                  <Menu
                    label={`Change availability for ${row.person.name}`}
                    trigger={
                      <button type="button" className="app-NowStatus__trigger" aria-label={`${look.label}. Change availability for ${row.person.name}`}>
                        {pill}
                        <span className="app-NowStatus__chevron" aria-hidden="true">
                          ▾
                        </span>
                      </button>
                    }
                    items={[
                      ...(['available', 'busy'] as const).map((status) => ({
                        id: status,
                        label: STATUS_LOOK[status]!.label,
                        icon: STATUS_LOOK[status]!.icon,
                        onSelect: () => void change(row, row.userId === me.id ? null : row.userId, row.person.name, { status }),
                      })),
                      {
                        id: 'away',
                        label: 'Away…',
                        icon: STATUS_LOOK.away!.icon,
                        onSelect: () => setDialog({ userId: row.userId === me.id ? null : row.userId, name: row.userId === me.id ? 'yourself' : row.person.name, initial: 'away' }),
                      },
                      {
                        id: 'off_shift',
                        label: 'Off shift',
                        icon: STATUS_LOOK.off_shift!.icon,
                        onSelect: () => void change(row, row.userId === me.id ? null : row.userId, row.person.name, { status: 'off_shift' }),
                      },
                    ]}
                  />
                ) : (
                  pill
                )}
                {note ? <span className="app-NowStatus__note">{note}</span> : null}
              </span>
            );
          },
        }}
        empty={{
          title: 'Nobody has set their availability yet',
          description: 'Routing treats everyone as available.',
          icon: 'workforce',
          ...(canSetOwn ? { action: { id: 'set-mine', label: 'Set mine', variant: 'secondary' as const } } : {}),
        }}
        noResults={{ title: 'Nobody matches', description: 'Try another name, or show everyone.' }}
        onAction={(id) => {
          if (id === 'set-mine') setDialog({ userId: null, name: 'yourself', initial: 'away' });
        }}
      />

      {dialog ? (
        <AvailabilityDialog
          open
          who={dialog.name}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSubmit={(choice) =>
            change(
              rows.find((row) => row.userId === (dialog.userId ?? me.id)) ?? null,
              dialog.userId,
              dialog.name === 'yourself' ? me.name : dialog.name,
              choice,
            )
          }
        />
      ) : null}
    </div>
  );
}
