'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Ticket } from '@itsm/sdk';
import { Button, notify } from '@itsm/ui';
import { BulkActionBar, type BulkAction } from '@itsm/ui/data';
import { ConfirmDialog, Dialog, PersonPicker, Sheet, type MenuItemSpec, type PersonOption } from '@itsm/ui/overlays';
import { searchPeople, writeFor } from '../client/desk-list.js';
import { deskKeys } from '../client/query-client.js';
import { personName, stateLabel, type PeopleMap } from './presentation.js';
import {
  PRIORITIES,
  TICKET_NOUN,
  bulkSummary,
  bulkVerb,
  describeChange,
  failureReason,
  planBulk,
  runBulk,
  statusChoices,
  tally,
  type BulkChange,
  type BulkSkip,
  type ListRow,
} from './queries.js';

/**
 * Changing tickets from the list: the bulk bar at the foot of the list pane
 * (SPEC §6.2), and the one engine behind it and the row menus.
 *
 * A change fans out in the browser, four writes at a time, each carrying the
 * version its row was read at. Cancel stops sending (what is in flight
 * finishes and is counted). The result is always said: "Updated 11 of 12 · 1
 * skipped", with Details — a sheet listing what did not happen and why, and
 * Retry for what failed. Afterwards the lists, the counts and any open
 * ticket are refreshed, because a change here moves tickets between views.
 */

export interface WriteJob {
  readonly label: string;
  readonly done: number;
  readonly total: number;
  cancel(): void;
}

export interface WriteFailure {
  readonly row: ListRow;
  readonly reason: string;
}

export interface WriteReport {
  readonly title: string;
  readonly change: BulkChange;
  readonly failures: readonly WriteFailure[];
  readonly skipped: readonly BulkSkip[];
}

export interface WriteResult {
  /** Ids whose write went through. */
  readonly done: readonly string[];
  /** The tickets as the API answered them, for the unread record. */
  readonly tickets: readonly Ticket[];
}

export interface TicketWrites {
  run(change: BulkChange, rows: readonly ListRow[]): Promise<WriteResult>;
  readonly job: WriteJob | null;
  readonly report: WriteReport | null;
  openReport(report: WriteReport | null): void;
}

export interface UseTicketWritesOptions {
  readonly me: string | null;
  readonly people: PeopleMap;
  /** Called before the lists refresh: the person acted, so the list shows the result as it is. */
  readonly onApplied?: () => void;
}

/** One ticket's result, said about that ticket: "INC-000123 moved to Resolved". */
function singleTitle(change: BulkChange, row: ListRow, me: string | null, people: PeopleMap): string {
  switch (change.kind) {
    case 'assign':
      if (change.assigneeId === null) return `${row.number} unassigned`;
      return `${row.number} assigned to ${change.assigneeId === me ? 'you' : (change.name ?? personName(change.assigneeId, people, me))}`;
    case 'status':
      return `${row.number} moved to ${stateLabel(change.to)}`;
    case 'priority':
      return `${row.number} set to ${change.priority}`;
  }
}

export function useTicketWrites({ me, people, onApplied }: UseTicketWritesOptions): TicketWrites {
  const client = useQueryClient();
  const [job, setJob] = useState<WriteJob | null>(null);
  const [report, setReport] = useState<WriteReport | null>(null);
  const latest = useRef({ me, people, onApplied });
  latest.current = { me, people, onApplied };

  const run = useCallback(
    async (change: BulkChange, rows: readonly ListRow[]): Promise<WriteResult> => {
      const { me: self, people: names } = latest.current;
      const plan = planBulk(change, rows, self);
      if (plan.send.length === 0) {
        const only = plan.skipped[0];
        notify(plan.skipped.length === 1 && only ? only.reason : bulkSummary(tally([], plan.skipped.length)).title, { tone: 'info' });
        return { done: [], tickets: [] };
      }

      const controller = new AbortController();
      const label = bulkVerb(change);
      setJob({ label, done: 0, total: plan.send.length, cancel: () => controller.abort() });
      const outcomes = await runBulk(plan.send, writeFor(change), {
        signal: controller.signal,
        onSettled: (_outcome, settled) => setJob((current) => (current ? { ...current, done: settled } : current)),
      });
      setJob(null);

      const done = outcomes.filter((outcome) => outcome.status === 'done');
      const failures: WriteFailure[] = outcomes
        .filter((outcome) => outcome.status === 'failed')
        .map((outcome) => ({ row: outcome.item, reason: failureReason(outcome.error) }));

      // The person acted: every list may have gained or lost rows, the
      // sidebar's counts moved, and a ticket open beside the list changed.
      latest.current.onApplied?.();
      void client.invalidateQueries({ queryKey: deskKeys.views() });
      void client.invalidateQueries({ queryKey: deskKeys.counts() });
      for (const outcome of done) void client.invalidateQueries({ queryKey: deskKeys.ticket(outcome.item.number) });

      const result = tally(outcomes, plan.skipped.length);
      const summary = bulkSummary(result);
      const next: WriteReport = { title: summary.title, change, failures, skipped: plan.skipped };
      const single = rows.length === 1 ? rows[0] : undefined;
      if (single && done.length === 1) {
        notify(singleTitle(change, single, self, names), { tone: 'success', id: 'inbox-write' });
      } else if (single && failures.length === 1) {
        notify(`Couldn’t update ${single.number}`, { tone: 'danger', description: failures[0]!.reason, id: 'inbox-write' });
      } else {
        notify(summary.title, {
          tone: summary.tone,
          id: 'inbox-write',
          ...(failures.length > 0 || plan.skipped.length > 0 ? { action: { label: 'Details', onClick: () => setReport(next) } } : {}),
          ...(summary.tone === 'danger' ? { duration: 'persistent' as const } : {}),
        });
      }
      return { done: done.map((outcome) => outcome.item.id), tickets: done.map((outcome) => outcome.value!).filter(Boolean) };
    },
    [client],
  );

  return useMemo(() => ({ run, job, report, openReport: setReport }), [run, job, report]);
}

/* ------------------------------------------------------------- The bar */

export interface InboxBulkBarProps {
  /** The selected rows. */
  readonly rows: readonly ListRow[];
  readonly writes: TicketWrites;
  readonly me: string | null;
  readonly meName: string;
  readonly can: { readonly assign: boolean; readonly transition: boolean; readonly update: boolean; readonly readPeople: boolean };
  readonly onClear: () => void;
  /** After a change, with the ids that went through (they leave the selection). */
  readonly onDone: (result: WriteResult) => void;
}

const TERMINAL = new Set(['cancelled', 'closed']);

/** Whether a list can offer any bulk change at all: without one, rows have no checkboxes. */
export function canChangeFromList(can: InboxBulkBarProps['can']): boolean {
  return can.assign || can.transition || can.update;
}

export function InboxBulkBar({ rows, writes, me, meName, can, onClear, onDone }: InboxBulkBarProps): ReactNode {
  const [assigning, setAssigning] = useState(false);
  const [confirming, setConfirming] = useState<BulkChange | null>(null);

  const apply = useCallback(
    (change: BulkChange) => {
      if (change.kind === 'status' && TERMINAL.has(change.to)) {
        setConfirming(change);
        return;
      }
      void writes.run(change, rows).then(onDone);
    },
    [writes, rows, onDone],
  );

  const choices = useMemo(() => statusChoices(rows), [rows]);
  const count = rows.length;
  const plural = count === 1 ? TICKET_NOUN.one : TICKET_NOUN.other;

  const actions = useMemo<BulkAction[]>(() => {
    const list: BulkAction[] = [];
    if (can.assign) {
      const menu: MenuItemSpec[] = [
        ...(me ? [{ id: 'assign-me', label: 'Assign to me', shortcut: 'i', onSelect: () => apply({ kind: 'assign', assigneeId: me, name: meName }) }] : []),
        ...(can.readPeople ? [{ id: 'assign-someone', label: 'Assign to…', onSelect: () => setAssigning(true) }] : []),
        { id: 'unassign', label: 'Unassign', onSelect: () => apply({ kind: 'assign', assigneeId: null }) },
      ];
      list.push({ id: 'assign', label: 'Assign', menu });
    }
    if (can.transition) {
      list.push(
        choices.length > 0
          ? {
              id: 'status',
              label: 'Status',
              menu: choices.map((to) => ({
                id: `status-${to}`,
                label: stateLabel(to),
                ...(TERMINAL.has(to) ? { tone: 'danger' as const } : {}),
                onSelect: () => apply({ kind: 'status', to }),
              })),
            }
          : { id: 'status', label: 'Status', disabled: true, disabledReason: `No status change suits all ${count} selected ${plural}` },
      );
    }
    if (can.update) {
      list.push({
        id: 'priority',
        label: 'Priority',
        menu: PRIORITIES.map((priority) => ({ id: `priority-${priority}`, label: priority, onSelect: () => apply({ kind: 'priority', priority }) })),
      });
    }
    return list;
  }, [can, me, meName, choices, count, plural, apply]);

  const job = writes.job;
  return (
    <>
      <BulkActionBar
        placement="dock"
        count={count}
        noun={TICKET_NOUN}
        actions={actions}
        onAction={() => undefined}
        onClear={onClear}
        {...(job ? { busy: { label: job.label, done: job.done, total: job.total, onCancel: job.cancel } } : {})}
      />
      {assigning ? (
        <AssignDialog
          count={count}
          me={me ? { id: me, name: meName } : null}
          onClose={() => setAssigning(false)}
          onAssign={(person) => {
            setAssigning(false);
            apply(person ? { kind: 'assign', assigneeId: person.id, name: person.id === me ? 'you' : person.name } : { kind: 'assign', assigneeId: null });
          }}
        />
      ) : null}
      {confirming?.kind === 'status' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          spec={{
            title: `${confirming.to === 'cancelled' ? 'Cancel' : 'Close'} ${count === 1 ? 'this ticket' : `${count} tickets`}?`,
            body:
              confirming.to === 'cancelled'
                ? 'Cancelled tickets stop their clocks and can’t be reopened.'
                : 'Closed tickets are final: a change after this needs a new ticket.',
            confirmLabel: `${confirming.to === 'cancelled' ? 'Cancel' : 'Close'} ${plural}`,
            cancelLabel: 'Keep them',
            tone: 'danger',
          }}
          onConfirm={async () => {
            const change = confirming;
            setConfirming(null);
            onDone(await writes.run(change, rows));
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------ Assign to… */

function AssignDialog({
  count,
  me,
  onClose,
  onAssign,
}: {
  readonly count: number;
  readonly me: PersonOption | null;
  onClose(): void;
  onAssign(person: PersonOption | null): void;
}): ReactNode {
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [cleared, setCleared] = useState(false);
  const pickerId = 'inbox-assign-person';
  const loadPeople = useCallback(async (query: string) => (await searchPeople(query)).map((hit) => ({ id: hit.id, name: hit.name, ...(hit.detail ? { detail: hit.detail } : {}) })), []);
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={count === 1 ? 'Assign this ticket' : `Assign ${count} tickets`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!person && !cleared} onClick={() => onAssign(person)}>
            {person ? `Assign to ${person.name}` : cleared ? 'Unassign' : 'Assign'}
          </Button>
        </>
      }
    >
      <label className="app-InboxAssign__label" htmlFor={pickerId}>
        Person
      </label>
      <PersonPicker
        id={pickerId}
        value={person}
        onChange={(value) => {
          const next = Array.isArray(value) ? (value[0] ?? null) : (value as PersonOption | null);
          setPerson(next);
          setCleared(next === null);
        }}
        loadPeople={loadPeople}
        extras={{ assignToMe: me !== null, unassign: true }}
        {...(me ? { me } : {})}
        placeholder="Search people"
      />
    </Dialog>
  );
}

/* ------------------------------------------------------ The report */

export interface BulkReportSheetProps {
  readonly report: WriteReport | null;
  readonly me: string | null;
  readonly people: PeopleMap;
  onClose(): void;
  /** Retry what failed, with the rows' latest versions. */
  onRetry(report: WriteReport): void;
}

/**
 * What did not go through, and why: one line per ticket, the failures first
 * (with Retry), then what was skipped because it already had the change.
 */
export function BulkReportSheet({ report, me, people, onClose, onRetry }: BulkReportSheetProps): ReactNode {
  // Kept while the sheet animates closed.
  const [shown, setShown] = useState<WriteReport | null>(report);
  useEffect(() => {
    if (report) setShown(report);
  }, [report]);
  if (!shown) return null;
  const failed = shown.failures.length;
  return (
    <Sheet
      open={report !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="sm"
      title={describeChange(shown.change, people, me)}
      description={shown.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {failed > 0 ? (
            <Button variant="primary" iconStart="refresh-cw" onClick={() => onRetry(shown)}>
              {failed === 1 ? 'Retry the failed ticket' : `Retry ${failed} failed`}
            </Button>
          ) : null}
        </>
      }
    >
      {failed > 0 ? (
        <section className="app-InboxReport__section" aria-labelledby="inbox-report-failed">
          <h3 id="inbox-report-failed" className="app-InboxReport__heading">
            Didn’t go through
          </h3>
          <ul className="app-InboxReport__list">
            {shown.failures.map(({ row, reason }) => (
              <li key={row.id} className="app-InboxReport__item" data-tone="danger">
                <span className="app-InboxReport__number">{row.number}</span>
                <span className="app-InboxReport__title">{row.title}</span>
                <span className="app-InboxReport__reason">{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shown.skipped.length > 0 ? (
        <section className="app-InboxReport__section" aria-labelledby="inbox-report-skipped">
          <h3 id="inbox-report-skipped" className="app-InboxReport__heading">
            Skipped
          </h3>
          <ul className="app-InboxReport__list">
            {shown.skipped.map(({ row, reason }) => (
              <li key={row.id} className="app-InboxReport__item">
                <span className="app-InboxReport__number">{row.number}</span>
                <span className="app-InboxReport__title">{row.title}</span>
                <span className="app-InboxReport__reason">{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}
