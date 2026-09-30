'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ActionSpec, type EmptySpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { PersonCell } from '../PersonCell.js';
import { AssetDrawer, WarrantyValue } from './AssetDrawer.js';
import { AssetForm } from './AssetForm.js';
import type { AssetDetailView } from './assets.js';
import { ASSET_LIMIT, ASSET_STATUSES, ASSET_STATUS_LOOK, WARRANTY_WINDOWS, isAssetFiltered, type AssetQuery, type AssetView } from './presentation.js';
import { useNewParam } from './useNewParam.js';

/**
 * Assets (SPEC §6.1 `/cmdb/assets`, B §3.12): the register — tag, serial,
 * status, who holds it, where, cost centre and warranty — searched and
 * filtered on the server, with the warranty filter (`?warranty=30`, what the
 * Command centre's "warranties end within 30 days" opens) answered from the
 * API's warranty report. A row opens the asset's drawer (`?open=asset:<tag>`);
 * *Add asset* (`c`, `?new=1`) for people who manage the register.
 */

export interface AssetsViewProps {
  readonly rows: readonly AssetView[];
  readonly problem?: Problem;
  readonly query: AssetQuery;
  readonly capped: boolean;
  readonly holders: boolean;
  readonly costCentres: readonly string[];
  readonly holderOption?: { readonly value: string; readonly label: string };
  readonly today: string;
  readonly detail?: AssetDetailView;
  readonly detailMissing?: boolean;
  readonly canManage: boolean;
  readonly canReadCis: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

export function AssetsView(props: AssetsViewProps): ReactNode {
  const { rows, query, canManage, capped, holders } = props;
  const router = useRouter();
  const drawer = useDrawer('asset');
  const create = useNewParam();
  const online = useOnline();
  const formId = useId();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const filtered = isAssetFiltered(query);
  const open = drawer.key ? rows.find((row) => row.tag === drawer.key) : undefined;
  const takenTags = useMemo(() => rows.map((row) => row.tag), [rows]);

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'tag', header: 'Tag', field: 'tag', kind: 'mono', width: 148, sortable: 'page', cardRole: 'title' },
      { id: 'serial', header: 'Serial', field: 'serial', kind: 'mono', width: '1fr', cardRole: 'subtitle' },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: ASSET_STATUS_LOOK, srPrefix: 'Status', width: 148, cardRole: 'badge', sortable: 'page' },
      ...(holders ? [{ id: 'holder', header: 'Holder', field: 'holderName', kind: 'text' as const, width: '1fr' as const, sortable: 'page' as const, cardRole: 'meta' as const }] : []),
      { id: 'location', header: 'Location', field: 'location', kind: 'text', width: '1fr', hideBelow: 'lg', sortable: 'page', cardRole: 'hidden' },
      { id: 'costCentre', header: 'Cost centre', field: 'costCentre', kind: 'text', width: 140, hideBelow: 'xl', sortable: 'page', cardRole: 'hidden' },
      { id: 'supplier', header: 'Supplier', field: 'supplier', kind: 'text', width: '1fr', hideBelow: 'xl', defaultHidden: true, hideable: true, cardRole: 'hidden' },
      { id: 'warranty', header: 'Warranty', field: 'warrantyEndsOn', kind: 'text', width: 220, sortable: 'page', cardRole: 'meta' },
    ],
    [holders],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: ASSET_STATUSES.map((value) => ({ value, label: ASSET_STATUS_LOOK[value]!.label, tone: ASSET_STATUS_LOOK[value]!.tone })),
      },
      ...(props.costCentres.length > 0 ? [{ id: 'costCentre', label: 'Cost centre', type: 'select' as const, mode: 'server' as const, pinned: true, options: props.costCentres.map((value) => ({ value, label: value })) }] : []),
      {
        id: 'warranty',
        label: 'Warranty',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: WARRANTY_WINDOWS.map((entry) => ({ value: entry.value, label: entry.label, tone: entry.value === 'expired' ? ('danger' as const) : ('warning' as const) })),
      },
      {
        id: 'holder',
        label: 'Holder',
        type: 'person',
        mode: 'server',
        options: props.holderOption ? [props.holderOption] : [],
        loadOptions: async (text, signal) => {
          const people = await api.tenant.users({ q: text || undefined, limit: 20 });
          if (signal.aborted) return [];
          return people.map((person) => ({ value: person.id, label: person.displayName || person.email }));
        },
      },
    ],
    [props.costCentres, props.holderOption],
  );

  const addAction: ActionSpec = { id: 'add-asset', label: 'Add asset', icon: 'plus', variant: 'primary', shortcut: 'c', ...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' }) };
  const windowLabel = WARRANTY_WINDOWS.find((entry) => entry.value === query.warranty)?.label.toLowerCase();
  const empty: EmptySpec = {
    title: 'No assets yet',
    description: 'Add laptops, phones, monitors and licences to see who holds what, and when each warranty ends.',
    icon: 'assets',
    ...(canManage ? { action: { id: 'add-asset', label: 'Add asset', icon: 'plus', variant: 'primary' } as ActionSpec } : {}),
  };

  return (
    <div className="app-Page app-Assets">
      <PageHeader
        title="Assets"
        {...(rows.length === 0 && !filtered && !props.problem ? { subtitle: 'Hardware and licences: who holds what, where, and when warranties end.' } : {})}
        {...(canManage ? { primaryAction: addAction } : {})}
        {...(props.viewOnly ? { viewOnly: props.viewOnly } : {})}
        onAction={(id) => {
          if (id === 'add-asset') create.open('1');
        }}
      />
      {/* The page's h1 is the header's; the table's empty and error states are h3s, so the list gets its h2. */}
      <h2 className="itsm-visually-hidden">The asset register</h2>
      <DataTable<AssetView>
        caption="Assets"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        urlKey=""
        sort={{ columnId: 'tag', direction: 'ascending' }}
        search={{ placeholder: 'Search by tag or serial', mode: 'server', param: 'q', shortcut: '/' }}
        filters={filters}
        viewMenu={{ density: true, columns: true }}
        dataComplete={!capped}
        activate={{ kind: 'drawer', openKind: 'asset', keyField: 'tag' }}
        onActivate={(row) => drawer.open(row.tag)}
        {...(drawer.key && open ? { currentKeys: [open.id] } : {})}
        countNoun={{ one: 'asset', other: 'assets' }}
        cells={{
          tag: (row) => <code className="app-CmdbTag">{row.tag}</code>,
          serial: (row) => (row.serial ? <span className="app-CmdbMono">{row.serial}</span> : <span className="app-CmdbMuted">—</span>),
          holder: (row) => <PersonCell person={row.holder ?? null} empty={row.status === 'assigned' ? 'Someone' : '—'} />,
          warranty: (row) => (row.warrantyEndsOn ? <WarrantyValue asset={row} /> : <span className="app-CmdbMuted">Not recorded</span>),
        }}
        empty={empty}
        onAction={(id) => {
          if (id === 'add-asset') create.open('1');
        }}
        noResults={
          query.warranty
            ? { title: `No warranties ${windowLabel === 'already expired' ? 'have expired' : windowLabel?.replace(/^ends/, 'end') ?? 'match'}`, description: 'Nothing needs renewing or replacing for now. Clear the filter to see every asset.', icon: 'circle-check' }
            : { title: 'No assets match these filters', description: 'Clear a filter, or search for something else.' }
        }
        {...(props.problem ? { problem: props.problem, onRetry: () => router.refresh() } : {})}
      />
      {capped ? (
        <p className="app-Cmdb__caption" role="note">
          Showing the first {ASSET_LIMIT} — search or filter to narrow.
        </p>
      ) : null}

      <AssetDrawer
        tag={drawer.key}
        {...(open ? { row: open } : {})}
        {...(props.detail ? { initial: props.detail } : {})}
        {...(props.detailMissing && drawer.key ? { missing: true } : {})}
        today={props.today}
        canManage={canManage}
        canReadCis={props.canReadCis}
        takenTags={takenTags}
        onClose={drawer.close}
      />

      <Sheet
        open={create.value !== null && canManage}
        onOpenChange={(next) => {
          if (!next) {
            setDirty(false);
            create.close();
          }
        }}
        size="md"
        title="Add asset"
        description="Only what you know now: everything but the tag can be added later."
        dirty={dirty}
        footer={
          <div className="app-CmdbActions">
            <Button
              variant="secondary"
              onClick={() => {
                setDirty(false);
                create.close();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
              Add asset
            </Button>
          </div>
        }
      >
        {create.value !== null && canManage ? (
          <AssetForm
            formId={formId}
            takenTags={takenTags}
            canLinkCi={props.canReadCis}
            onDirtyChange={setDirty}
            onBusyChange={setBusy}
            onDone={(saved) => {
              setDirty(false);
              if (saved) {
                create.finish(`asset:${saved.tag}`);
                router.refresh();
              } else create.close();
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
