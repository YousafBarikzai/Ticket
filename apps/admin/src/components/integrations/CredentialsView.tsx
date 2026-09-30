'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, DescriptionList, EmptyState, IconButton, RelativeTime, StatusPill, notify, useItsm, type ActionSpec, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { AddCredentialSheet, RotateCredentialDialog } from './CredentialDialogs.js';
import type { CredentialView } from './presentation.js';
import type { IntegrationsHeader } from './types.js';

/**
 * Integrations › Credentials (SPEC §6.1): what this desk authenticates with —
 * a reference, a kind, a fingerprint (enough to tell two apart, useless to
 * anyone who steals it), when it was last used, when it expires ("Expires in
 * 9 days", "Expired", always in words) and whether its encryption key is
 * current. Never a value: no route returns one.
 *
 * *Add credential* (`?new=1`, also ⌘K), *Rotate…* and *Delete…* (typing the
 * reference to confirm, and naming the actions that would lose it). A row
 * opens its drawer (`?open=credential:<ref>`).
 */
export interface CredentialsViewProps {
  readonly header: IntegrationsHeader;
  readonly rows: readonly CredentialView[];
  readonly canManage: boolean;
  readonly actionsHref?: string;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'credential', other: 'credentials' };
const OFFLINE = 'You’re offline — changes can’t be saved.';

export function CredentialsView({ header, rows, canManage, actionsHref, problem }: CredentialsViewProps): ReactNode {
  const drawer = useDrawer('credential');
  const create = useCreateParam();
  const router = useRouter();
  const online = useOnline();
  const { Link } = useItsm();
  const [rotating, setRotating] = useState<CredentialView | null>(null);
  const [deleting, setDeleting] = useState<CredentialView | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const open = drawer.key ? rows.find((row) => row.ref === drawer.key) : undefined;

  useEffect(() => {
    if (flash.length === 0) return;
    const timer = window.setTimeout(() => setFlash([]), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const remove = useMutation((ref: string) => api.observe.integrations.deleteCredential(ref), {
    failure: 'Couldn’t delete the credential',
  });

  const deleteOne = async (row: CredentialView): Promise<void> => {
    const result = await remove.run(row.ref);
    if (!result.ok) return;
    notify(`Credential ${row.ref} deleted`, { tone: 'success' });
    if (drawer.key === row.ref) drawer.close();
  };

  const deleteSpec = (row: CredentialView) => ({
    title: `Delete ${row.ref}?`,
    body: 'The value is destroyed and can’t be recovered. Anything that uses it fails from its next call until a credential with this reference is added again.',
    confirmLabel: 'Delete credential',
    tone: 'danger' as const,
    typeToConfirm: row.ref,
    ...(row.usedBy.length > 0
      ? { consequences: [{ label: `Used by ${row.usedBy.length === 1 ? 'the action' : `${row.usedBy.length} actions:`} ${row.usedBy.join(', ')}`, ...(actionsHref ? { href: actionsHref } : {}) }] }
      : {}),
  });

  const copy = (value: string): void => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(value),
      () => undefined,
    );
  };

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'ref', header: 'Credential', field: 'ref', kind: 'title', secondaryField: 'description', minWidth: 200, truncate: 2 },
      { id: 'kind', header: 'Kind', field: 'kindLabel', width: 140, minWidth: 130, hideBelow: 'md' },
      { id: 'fingerprint', header: 'Fingerprint', field: 'fingerprint', kind: 'mono', minWidth: 210, hideBelow: 'lg' },
      { id: 'used', header: 'Last used', field: 'lastUsedAt', kind: 'relative', width: 130, minWidth: 120, empty: 'Never', sortable: 'page', hideBelow: 'sm' },
      { id: 'expires', header: 'Expires', field: 'expiryLabel', minWidth: 180, cardRole: 'badge' },
      { id: 'key', header: 'Key', field: 'keyLabel', width: 180, minWidth: 170, hideBelow: 'md' },
    ],
    [],
  );

  const rowActionsFor = (row: CredentialView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'view', label: 'View details', icon: 'eye' }];
    if (!canManage) return actions;
    const gate = online ? {} : { disabled: true, disabledReason: OFFLINE };
    actions.push({ id: 'rotate', label: 'Rotate…', icon: 'refresh-cw', ...gate }, { id: 'delete', label: 'Delete…', icon: 'trash', tone: 'danger', ...gate, confirm: deleteSpec(row) });
    return actions;
  };

  const expiryCell = (row: CredentialView): ReactNode =>
    row.expiry.state === 'expired' || row.expiry.state === 'soon' ? (
      <StatusPill size="sm" tone={row.expiry.tone} {...(row.expiry.icon ? { icon: row.expiry.icon } : {})} label={row.expiry.label} />
    ) : row.expiresAt ? (
      <RelativeTime date={row.expiresAt} mode="absolute" absoluteStyle="date" />
    ) : (
      <span className="app-Integrations__quiet">{row.expiry.label}</span>
    );

  return (
    <div className="app-Page app-Integrations">
      <PageHeader
        title="Integrations"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'add-credential', label: 'Add credential', icon: 'plus', variant: 'primary', shortcut: 'c' } as ActionSpec } : {})}
        onAction={(id) => {
          if (id === 'add-credential') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">Credentials</h2>
      <DataTable<CredentialView>
        caption="Credentials"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="ref"
        search={{ placeholder: 'Search credentials', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'drawer', openKind: 'credential', keyField: 'ref' }}
        onActivate={(row) => drawer.open(row.ref)}
        {...(open ? { currentKeys: [open.ref] } : {})}
        highlightKeys={flash}
        rowActionsFor={rowActionsFor}
        onAction={async (id, targets) => {
          if (id === 'add-credential') create.open('1');
          const row = targets[0];
          if (!row) return;
          if (id === 'view') drawer.open(row.ref);
          if (id === 'rotate') setRotating(row);
          if (id === 'delete') await deleteOne(row);
        }}
        cells={{
          expires: expiryCell,
          key: (row) =>
            row.needsRewrap ? <StatusPill size="sm" tone="warning" icon="key" label="Needs re-encrypting" /> : <span className="app-Integrations__quiet">Current</span>,
          fingerprint: (row) => (
            <span className="app-Delivery__key">
              <code className="app-Delivery__mono">{row.fingerprint}</code>
              <IconButton
                icon={copied === row.fingerprint ? 'check' : 'copy'}
                label={copied === row.fingerprint ? `Copied the fingerprint of ${row.ref}` : `Copy the fingerprint of ${row.ref}`}
                size="sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  copy(row.fingerprint);
                }}
              />
            </span>
          ),
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{
          title: 'No credentials stored',
          description: 'Actions that call a service needing a key or token authenticate with a credential stored here.',
          icon: 'key',
          ...(canManage ? { action: { id: 'add-credential', label: 'Add credential', icon: 'plus', variant: 'primary' } } : {}),
        }}
        noResults={{ title: 'No credentials match', description: 'Try other words, or clear the search.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.ref ?? 'Credential'}
        {...(open ? { description: open.description ?? open.kindLabel } : {})}
        {...(open ? { headerMeta: <StatusPill size="sm" tone={open.health.tone} label={open.health.label} srPrefix="Health" /> } : {})}
        {...(open && canManage
          ? {
              footer: (
                <>
                  <Button variant="dangerTinted" iconStart="trash" onClick={() => setDeleting(open)} {...(online ? {} : { disabledReason: OFFLINE })}>
                    Delete…
                  </Button>
                  <Button variant="primary" iconStart="refresh-cw" onClick={() => setRotating(open)} {...(online ? {} : { disabledReason: OFFLINE })}>
                    Rotate…
                  </Button>
                </>
              ),
            }
          : {})}
      >
        {drawer.key !== null && !open ? (
          <EmptyState
            size="sm"
            title="That credential no longer exists"
            description="It may have been deleted since the link was made."
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={() => drawer.close()}
          />
        ) : open ? (
          <div className="app-Delivery">
            <DescriptionList
              layout="inline"
              dense
              items={[
                { id: 'kind', label: 'Kind', value: open.kindLabel },
                {
                  id: 'fingerprint',
                  label: 'Fingerprint',
                  value: <code className="app-Delivery__mono">{open.fingerprint}</code>,
                  hint: 'Tells two values apart without revealing either.',
                },
                { id: 'expires', label: 'Expires', value: expiryCell(open) },
                { id: 'key', label: 'Encryption key', value: open.keyLabel, ...(open.needsRewrap ? { hint: 'The key that protects stored values has changed since this was written. Rotating re-encrypts it.' } : {}) },
                { id: 'used', label: 'Last used', value: open.lastUsedAt ? <RelativeTime date={open.lastUsedAt} /> : 'Never' },
                { id: 'created', label: 'Stored', value: <RelativeTime date={open.createdAt} mode="absolute" absoluteStyle="date" /> },
                ...(open.rotatedAt ? [{ id: 'rotated', label: 'Last rotated', value: <RelativeTime date={open.rotatedAt} mode="absolute" absoluteStyle="date" /> }] : []),
                {
                  id: 'usedBy',
                  label: 'Used by',
                  value:
                    open.usedBy.length === 0
                      ? 'No action names it'
                      : actionsHref
                        ? <Link href={actionsHref}>{open.usedBy.join(', ')}</Link>
                        : open.usedBy.join(', '),
                },
              ]}
            />
          </div>
        ) : null}
      </Sheet>
      <AddCredentialSheet
        open={canManage && create.value !== null}
        taken={rows.map((row) => row.ref)}
        onClose={() => create.close()}
        onSaved={(ref) => setFlash([ref])}
      />
      <RotateCredentialDialog credential={rotating} onClose={() => setRotating(null)} />
      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
          spec={deleteSpec(deleting)}
          onConfirm={() => deleteOne(deleting)}
        />
      ) : null}
    </div>
  );
}
