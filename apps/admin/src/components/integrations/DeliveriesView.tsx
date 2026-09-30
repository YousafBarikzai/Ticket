'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, InlineAlert, StatusPill, notify, useItsm, type ActionSpec, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type DataTableScope } from '@itsm/ui/data';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { reportSessionEnded, useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { DeliveryDrawer } from './DeliveryDrawer.js';
import { attemptsTone, dismissSummary, replaySummary, type DeliveryStatus, type DeliveryView } from './presentation.js';
import type { IntegrationsHeader } from './types.js';

/**
 * Integrations › Failed deliveries (SPEC §6.1; §6.4 "Failed deliveries":
 * read-only before, now Replay and Dismiss for one row or many).
 *
 * The queue in three scopes — Open · Replayed · Dismissed (`?status=`, real
 * links). An open failure can be replayed (the same request with its
 * original idempotency key, so a call that reached the far end the first
 * time is not repeated) or dismissed with a reason. Selecting rows offers
 * *Replay N* and *Dismiss N…*, run one at a time with progress and Cancel,
 * then one sentence of what happened (X-51). A replay that fails again says
 * so and keeps the new error in the drawer — the queue itself does not
 * record it.
 */
export interface DeliveriesViewProps {
  readonly header: IntegrationsHeader;
  readonly status: DeliveryStatus;
  readonly scopes: DataTableScope['options'];
  readonly rows: readonly DeliveryView[];
  /** The API lists at most 200: a full page has more behind it. */
  readonly capped: boolean;
  readonly canReplay: boolean;
  /** The health cards above the list (server-rendered). */
  readonly summary?: ReactNode;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'delivery', other: 'deliveries' };
const OFFLINE = 'You’re offline — changes can’t be saved.';

const EMPTY: Readonly<Record<DeliveryStatus, { title: string; description: string }>> = {
  open: { title: 'No failed deliveries', description: 'Every outbound call has gone through.' },
  replayed: { title: 'Nothing replayed yet', description: 'Failures that went through when they were sent again are listed here.' },
  dismissed: { title: 'Nothing dismissed', description: 'Failures someone decided not to send again are listed here, with why.' },
};

export function DeliveriesView({ header, status, scopes, rows, capped, canReplay, summary, problem }: DeliveriesViewProps): ReactNode {
  const drawer = useDrawer('delivery');
  const router = useRouter();
  const online = useOnline();
  const { Link } = useItsm();
  const cancelled = useRef(false);
  const [lastErrors, setLastErrors] = useState<Readonly<Record<string, string>>>({});
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;
  const acting = canReplay && status === 'open';

  const replay = useMutation((row: DeliveryView) => api.observe.integrations.replay(row.id), { failure: 'Couldn’t replay the delivery' });
  const dismiss = useMutation((row: DeliveryView, reason: string) => api.observe.integrations.dismiss(row.id, reason), {
    success: 'Failure dismissed',
    failure: 'Couldn’t dismiss the failure',
  });

  const replayOne = async (row: DeliveryView): Promise<void> => {
    const result = await replay.run(row);
    if (!result.ok) return;
    if (result.value.ok) {
      notify('Delivered', { tone: 'success', description: `${row.actionName} went through on replay.` });
      setLastErrors(({ [row.id]: _gone, ...rest }) => rest);
      if (drawer.key === row.id) drawer.close();
    } else {
      const error = result.value.error ?? 'It failed again without saying why.';
      setLastErrors((current) => ({ ...current, [row.id]: error }));
      notify('Failed again — see the error', { tone: 'danger', description: error });
    }
  };

  const dismissOne = async (row: DeliveryView, reason: string): Promise<void> => {
    // A refusal is said by the toast `useMutation` raises; the confirmation closes either way.
    const result = await dismiss.run(row, reason);
    if (result.ok && drawer.key === row.id) drawer.close();
  };

  /** Runs `each` over the rows one at a time, with progress and Cancel, and returns the tally. */
  const runMany = async (
    targets: readonly DeliveryView[],
    label: string,
    each: (row: DeliveryView) => Promise<'done' | 'failed'>,
  ): Promise<{ done: number; failed: number; left: number }> => {
    const id = `integrations-bulk-${Date.now()}`;
    cancelled.current = false;
    let done = 0;
    let failed = 0;
    let attempted = 0;
    for (const row of targets) {
      if (cancelled.current) break;
      notify.progress(id, {
        label,
        done: attempted,
        total: targets.length,
        onCancel: () => {
          cancelled.current = true;
        },
      });
      try {
        if ((await each(row)) === 'done') done += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        if (problemFrom(error).status === 401) {
          attempted += 1;
          reportSessionEnded();
          break;
        }
      }
      attempted += 1;
    }
    notify.dismiss(id);
    return { done, failed, left: targets.length - attempted };
  };

  const replayMany = async (targets: readonly DeliveryView[]): Promise<void> => {
    const replayable = targets.filter((row) => row.replayable);
    const skipped = targets.length - replayable.length;
    const errors: Record<string, string> = {};
    const tally = await runMany(replayable, `Replaying ${replayable.length} ${replayable.length === 1 ? 'delivery' : 'deliveries'}`, async (row) => {
      const outcome = await api.observe.integrations.replay(row.id);
      if (outcome.ok) return 'done';
      errors[row.id] = outcome.error ?? 'It failed again without saying why.';
      return 'failed';
    });
    setLastErrors((current) => ({ ...current, ...errors }));
    const said = replaySummary({ ...tally, skipped });
    notify(said.text, { tone: said.tone });
    router.refresh();
  };

  const dismissMany = async (targets: readonly DeliveryView[], reason: string): Promise<void> => {
    const tally = await runMany(targets, `Dismissing ${targets.length} ${targets.length === 1 ? 'failure' : 'failures'}`, async (row) => {
      await api.observe.integrations.dismiss(row.id, reason);
      return 'done';
    });
    const said = dismissSummary(tally);
    notify(said.text, { tone: said.tone });
    router.refresh();
  };

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'action', header: 'Action', field: 'actionName', kind: 'title', minWidth: 180 },
      { id: 'from', header: 'From', field: 'from', minWidth: 160, hideBelow: 'md', cardRole: 'subtitle' },
      { id: 'error', header: 'What went wrong', field: 'errorLine', kind: 'mono', minWidth: 240, truncate: 2 },
      ...(status !== 'dismissed' ? [{ id: 'attempts', header: 'Attempts', field: 'attempts', align: 'end' as const, width: 130, minWidth: 120, cardRole: 'badge' as const }] : []),
      { id: 'created', header: 'First failed', field: 'createdAt', kind: 'relative', width: 140, minWidth: 130, sortable: 'page' },
      ...(status === 'open'
        ? []
        : [
            { id: 'resolved', header: status === 'dismissed' ? 'Dismissed' : 'Delivered', field: 'resolvedAt', kind: 'relative' as const, width: 130, minWidth: 120, sortable: 'page' as const },
            { id: 'by', header: 'By', field: 'resolvedByName', width: 150, minWidth: 130, hideBelow: 'lg' as const, empty: '—' },
          ]),
      ...(status === 'dismissed' ? [{ id: 'reason', header: 'Why', field: 'dismissedReason', minWidth: 160, truncate: 2 as const, hideBelow: 'md' as const }] : []),
    ],
    [status],
  );

  const replayGate = (row: DeliveryView): string | undefined =>
    !row.replayable ? 'This failure didn’t come from an action, so there is nothing to send again.' : !online ? OFFLINE : undefined;

  const rowActionsFor = (row: DeliveryView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'view', label: 'View details', icon: 'eye' }];
    if (!acting) return actions;
    const gate = replayGate(row);
    actions.push(
      { id: 'replay', label: 'Replay', icon: 'refresh-cw', ...(gate ? { disabled: true, disabledReason: gate } : {}) },
      {
        id: 'dismiss',
        label: 'Dismiss…',
        icon: 'archive',
        ...(online ? {} : { disabled: true, disabledReason: OFFLINE }),
        confirm: {
          title: row.actionKey ? `Dismiss this ${row.actionName} failure?` : 'Dismiss this failure?',
          body: 'It leaves the open list and is not sent again. The failure and your reason stay on record.',
          confirmLabel: 'Dismiss failure',
          requireReason: { label: 'Why', hint: 'Somebody will ask later: “sent by hand”, “the far end fixed it”.' },
        },
      },
    );
    return actions;
  };

  const bulkActions: ActionSpec[] = acting
    ? [
        {
          id: 'replay-selected',
          label: 'Replay',
          icon: 'refresh-cw',
          variant: 'primary',
          ...(online ? {} : { disabled: true, disabledReason: OFFLINE }),
          confirm: {
            title: 'Replay the selected deliveries?',
            body: 'Each is sent again, one at a time, with its original idempotency key — so anything a first attempt already did at the far end isn’t done twice. Failures with no action are left as they are.',
            confirmLabel: 'Replay deliveries',
          },
        },
        {
          id: 'dismiss-selected',
          label: 'Dismiss…',
          icon: 'archive',
          ...(online ? {} : { disabled: true, disabledReason: OFFLINE }),
          confirm: {
            title: 'Dismiss the selected failures?',
            body: 'They leave the open list and are not sent again. Each keeps your reason on record.',
            confirmLabel: 'Dismiss failures',
            requireReason: { label: 'Why', hint: 'One reason for all of them.' },
          },
        },
      ]
    : [];

  return (
    <div className="app-Page app-Integrations">
      <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      {summary}
      <h2 className="itsm-visually-hidden">Failed deliveries</h2>
      {capped ? (
        <InlineAlert tone="info">
          Showing the newest 200 failures. Replay or dismiss some to see older ones.
        </InlineAlert>
      ) : null}
      <DataTable<DeliveryView>
        caption="Failed deliveries"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        dataComplete={!capped}
        search={{ placeholder: 'Search failures', mode: 'client', shortcut: '/' }}
        scope={{ label: 'Show', value: status, options: scopes }}
        activate={{ kind: 'drawer', openKind: 'delivery', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        {...(open ? { currentKeys: [open.id] } : {})}
        selection={acting ? 'multiple' : 'none'}
        bulkActions={bulkActions}
        rowActionsFor={rowActionsFor}
        onAction={async (id, targets, details) => {
          if (id === 'replay-selected') return replayMany(targets);
          if (id === 'dismiss-selected') return dismissMany(targets, details?.reason ?? '');
          const row = targets[0];
          if (!row) return;
          if (id === 'view') drawer.open(row.id);
          if (id === 'replay') await replayOne(row);
          if (id === 'dismiss') {
            const result = await dismiss.run(row, details?.reason ?? '');
            if (result.ok && drawer.key === row.id) drawer.close();
          }
        }}
        cells={{
          from: (row) =>
            row.fromHref ? (
              <Link href={row.fromHref} className="app-Integrations__link">
                {row.from}
              </Link>
            ) : (
              row.from
            ),
          attempts: (row) =>
            attemptsTone(row.attempts) === 'warning' ? (
              <StatusPill size="sm" tone="warning" icon="refresh-cw" label={`${row.attempts} attempts`} />
            ) : (
              <span className="app-Integrations__count">{row.attempts}</span>
            ),
          error: (row) => (
            <span className="app-Integrations__error">
              {lastErrors[row.id] ? <span className="app-Integrations__again">Failed again · </span> : null}
              {row.errorLine}
            </span>
          ),
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{ title: EMPTY[status].title, description: EMPTY[status].description, icon: 'webhook' }}
        {...(status === 'open' && rows.length === 0 && !problem
          ? { emptyContent: <EmptyState size="sm" tone="success" title={EMPTY.open.title} description={EMPTY.open.description} /> }
          : {})}
        noResults={{ title: 'No failures match', description: 'Try other words, or clear the search.' }}
      />
      <DeliveryDrawer
        id={drawer.key}
        row={open}
        canReplay={canReplay}
        online={online}
        {...(open && lastErrors[open.id] ? { lastError: lastErrors[open.id] } : {})}
        replaying={replay.pending}
        onClose={() => drawer.close()}
        onReplay={replayOne}
        onDismiss={dismissOne}
      />
    </div>
  );
}
