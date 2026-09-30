'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, DescriptionList, EmptyState, StatusPill, useItsm, type ActionSpec, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { JsonView } from '../JsonView.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { ACTION_STATUS_LOOK, type ActionView } from './presentation.js';
import type { IntegrationsHeader } from './types.js';

/**
 * Integrations › Actions (SPEC §6.1): the named outbound calls a workflow
 * may make — what each calls, with which credential, how long it waits, and
 * whether it can be trusted right now (its credential missing or expired, its
 * failures waiting, or healthy). A row opens the action's drawer
 * (`?open=action:<key>`) with its configuration, secret-looking values
 * hidden. A draft can be published (a confirmation first: the address and
 * the credential are checked again at that moment).
 *
 * Actions are written through the API; this console reads and publishes
 * them. There is no editor here, and the empty state says so rather than
 * offering a button that leads nowhere.
 */
export interface ActionsViewProps {
  readonly header: IntegrationsHeader;
  readonly rows: readonly ActionView[];
  readonly canPublish: boolean;
  /** Where a credential and the failed deliveries can be opened, when this person may. */
  readonly credentialsHref?: string;
  readonly deliveriesHref?: string;
  /** The credentials could not be read, so their state is unknown (never "missing"). */
  readonly credentialsUnknown?: boolean;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'action', other: 'actions' };
const OFFLINE = 'You’re offline — changes can’t be saved.';

const statusMap = {
  published: { label: ACTION_STATUS_LOOK.published!.label, tone: ACTION_STATUS_LOOK.published!.tone },
  draft: { label: ACTION_STATUS_LOOK.draft!.label, tone: ACTION_STATUS_LOOK.draft!.tone },
};

export function ActionsView({ header, rows, canPublish, credentialsHref, deliveriesHref, credentialsUnknown = false, problem }: ActionsViewProps): ReactNode {
  const drawer = useDrawer('action');
  const router = useRouter();
  const online = useOnline();
  const { Link } = useItsm();
  const [publishing, setPublishing] = useState<ActionView | null>(null);
  const open = drawer.key ? rows.find((row) => row.key === drawer.key) : undefined;

  const publish = useMutation((row: ActionView) => api.observe.integrations.publishAction(row.key), {
    success: (result) => `${rows.find((row) => row.key === result.key)?.name ?? result.key} is live`,
    failure: 'Couldn’t publish the action',
  });

  const publishSpec = (row: ActionView) => ({
    title: `Publish ${row.name}?`,
    body: 'Workflows can call it as soon as it’s live. Its address and credential are checked again first; if either can’t be used, nothing changes.',
    confirmLabel: 'Publish action',
  });

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Action', field: 'name', kind: 'title', secondaryField: 'description', minWidth: 220, truncate: 2 },
      { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, width: 160 },
      { id: 'kind', header: 'Kind', field: 'kindLabel', width: 120, minWidth: 110, hideBelow: 'md' },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: statusMap, srPrefix: 'Status', width: 110, minWidth: 100, cardRole: 'badge' },
      { id: 'credential', header: 'Credential', field: 'credentialRef', minWidth: 200, empty: 'None', hideBelow: 'sm' },
      { id: 'health', header: 'Health', field: 'healthLabel', minWidth: 190 },
      { id: 'timeout', header: 'Gives up after', field: 'timeoutLabel', width: 130, minWidth: 120, align: 'end', hideBelow: 'lg' },
    ],
    [],
  );

  const rowActionsFor = (row: ActionView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'view', label: 'View details', icon: 'eye' }];
    if (canPublish && row.status !== 'published') {
      actions.push({ id: 'publish', label: 'Publish…', icon: 'send', ...(online ? {} : { disabled: true, disabledReason: OFFLINE }), confirm: publishSpec(row) });
    }
    return actions;
  };

  return (
    <div className="app-Page app-Integrations">
      <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      <h2 className="itsm-visually-hidden">Actions</h2>
      <DataTable<ActionView>
        caption="Actions"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="key"
        search={{ placeholder: 'Search actions', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'drawer', openKind: 'action', keyField: 'key' }}
        onActivate={(row) => drawer.open(row.key)}
        {...(open ? { currentKeys: [open.key] } : {})}
        rowActionsFor={rowActionsFor}
        onAction={async (id, targets) => {
          const row = targets[0];
          if (!row) return;
          if (id === 'view') drawer.open(row.key);
          if (id === 'publish') await publish.run(row);
        }}
        cells={{
          credential: (row) =>
            row.credentialRef ? (
              <span className="app-CredentialChip" data-tone={row.credentialLook?.tone ?? 'neutral'}>
                <span className="app-CredentialChip__dot" aria-hidden="true" />
                <span className="app-CredentialChip__ref">{row.credentialRef}</span>
                {row.credentialLook && !credentialsUnknown ? <span className="app-CredentialChip__state">{row.credentialLook.label}</span> : null}
              </span>
            ) : (
              <span className="app-Integrations__quiet">None</span>
            ),
          health: (row) => <StatusPill size="sm" tone={row.health.tone} {...(row.health.icon ? { icon: row.health.icon } : {})} label={row.health.label} srPrefix="Health" />,
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{
          title: 'No actions yet',
          description: 'Actions are the outbound calls a workflow can make. None are defined, so workflows on this desk can’t reach anything outside it.',
          icon: 'integrations',
        }}
        noResults={{ title: 'No actions match', description: 'Try other words, or clear the search.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.name ?? 'Action'}
        {...(open ? { description: open.kindLabel } : {})}
        {...(open ? { headerMeta: <StatusPill size="sm" tone={open.health.tone} label={open.health.label} srPrefix="Health" /> } : {})}
        {...(open && canPublish && open.status !== 'published'
          ? {
              footer: (
                <Button variant="primary" iconStart="send" loading={publish.pending} loadingLabel="Publishing…" {...(online ? {} : { disabledReason: OFFLINE })} onClick={() => setPublishing(open)}>
                  Publish…
                </Button>
              ),
            }
          : {})}
      >
        {drawer.key !== null && !open ? (
          <EmptyState
            size="sm"
            title="That action no longer exists"
            description="It may have been removed since the link was made."
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={() => drawer.close()}
          />
        ) : open ? (
          <div className="app-Delivery">
            {open.description ? <p className="app-Delivery__lede">{open.description}</p> : null}
            <TechnicalKey value={open.key} label="action key" />
            <DescriptionList
              layout="inline"
              dense
              items={[
                { id: 'status', label: 'Status', value: open.statusLabel, hint: open.status === 'published' ? 'Workflows can call it.' : 'Workflows can’t call it until it’s published.' },
                ...(open.target ? [{ id: 'target', label: 'Calls', value: <code className="app-Delivery__mono">{open.target}</code> }] : []),
                {
                  id: 'credential',
                  label: 'Credential',
                  value: open.credentialRef ? (
                    <>
                      {credentialsHref ? <Link href={`${credentialsHref}?open=credential:${encodeURIComponent(open.credentialRef)}`}>{open.credentialRef}</Link> : open.credentialRef}
                      {open.credentialLook && !credentialsUnknown ? ` · ${open.credentialLook.label}` : ''}
                    </>
                  ) : (
                    'None'
                  ),
                  ...(open.credentialHeader ? { hint: `Sent in the ${open.credentialHeader} header.` } : {}),
                },
                {
                  id: 'failures',
                  label: 'Failed deliveries',
                  value:
                    open.openFailures > 0 ? (
                      deliveriesHref ? (
                        <Link href={deliveriesHref}>{`${open.openFailures} waiting`}</Link>
                      ) : (
                        `${open.openFailures} waiting`
                      )
                    ) : (
                      'None'
                    ),
                },
                ...(open.kind === 'transform'
                  ? []
                  : [
                      { id: 'timeout', label: 'Gives up after', value: `${open.timeoutLabel} per call` },
                      { id: 'retries', label: 'Retries on record', value: `${open.retryMax}`, hint: 'How often a failing step is tried again is set by the workflow that calls it.' },
                    ]),
              ]}
            />
            <div className="app-Delivery__section">
              <h3 id="action-config" className="app-Delivery__heading">
                Configuration
              </h3>
              <p className="app-Delivery__note">Values that look like secrets are hidden.</p>
              <JsonView value={open.config} label="Configuration" openDepth={2} />
            </div>
            {open.responseMapping && typeof open.responseMapping === 'object' && Object.keys(open.responseMapping).length > 0 ? (
              <div className="app-Delivery__section">
                <h3 id="action-mapping" className="app-Delivery__heading">
                  What it reads from the answer
                </h3>
                <JsonView value={open.responseMapping} label="Response mapping" openDepth={1} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      {publishing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setPublishing(null);
          }}
          spec={publishSpec(publishing)}
          onConfirm={async () => {
            // A refusal is said by the toast `useMutation` raises; the dialog closes either way.
            await publish.run(publishing);
          }}
        />
      ) : null}
    </div>
  );
}
