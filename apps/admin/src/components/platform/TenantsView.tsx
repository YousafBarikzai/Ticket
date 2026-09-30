'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { StatusPill, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { TenantDrawer, type PlatformActions, type TenantDetail } from './TenantDrawer.js';
import type { TenantView } from './presentation.js';

/**
 * Platform › Tenants (SPEC §6.1 `/tenants`): every desk on this deployment —
 * name and slug, status, plan, region, created — searchable, each opening a
 * drawer (`?open=tenant:<id>`) with its meters, AI regions and the operator's
 * actions.
 *
 * The drawer's detail is rendered by the server (the platform API is not
 * reachable from the browser), so opening one is a navigation: the sheet
 * opens at once with the row, and the meters arrive with the page. Back
 * closes it.
 */
export interface TenantsViewProps {
  readonly rows: readonly TenantView[];
  readonly plans: readonly { readonly key: string; readonly name: string; readonly retired: boolean }[];
  readonly detail: TenantDetail | null;
  readonly actions: PlatformActions;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'tenant', other: 'tenants' };
const STATUS_MAP = {
  active: { label: 'Active', tone: 'success' as const, icon: 'circle-check' as const },
  suspended: { label: 'Suspended', tone: 'warning' as const, icon: 'pause' as const },
};

export function drawerParam(id: string): string {
  return `/tenants?open=${encodeURIComponent(`tenant:${id}`)}`;
}

export function TenantsView({ rows, plans, detail, actions, problem }: TenantsViewProps): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // `undefined` follows the address; a string or null is what the person just asked for, until the address catches up.
  const [requested, setRequested] = useState<string | null | undefined>(undefined);
  const openedHere = useRef(false);
  const serverId = detail?.id ?? null;
  if (requested !== undefined && requested === serverId) setRequested(undefined);
  const openId = requested === undefined ? serverId : requested;
  const row = openId ? (rows.find((entry) => entry.id === openId) ?? null) : null;

  const open = (id: string): void => {
    setRequested(id);
    openedHere.current = true;
    startTransition(() => router.push(drawerParam(id), { scroll: false }));
  };
  const close = (): void => {
    setRequested(null);
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      startTransition(() => router.replace('/tenants', { scroll: false }));
    }
  };

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Tenant', field: 'name', kind: 'title', secondaryField: 'slug', minWidth: 220 },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: STATUS_MAP, srPrefix: 'Status', minWidth: 130, cardRole: 'badge' },
      { id: 'plan', header: 'Plan', field: 'plan', minWidth: 140, empty: '—' },
      { id: 'region', header: 'Region', field: 'region', kind: 'mono', minWidth: 120, hideBelow: 'sm' },
      { id: 'created', header: 'Created', field: 'created', minWidth: 130, hideBelow: 'md' },
    ],
    [],
  );

  return (
    <>
      <DataTable<TenantView>
        caption="Tenants"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        search={{ placeholder: 'Search tenants', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'callback' }}
        onActivate={(entry) => open(entry.id)}
        cells={{
          status: (entry) => {
            const look = STATUS_MAP[entry.status as keyof typeof STATUS_MAP];
            return <StatusPill size="sm" srPrefix="Status" tone={look?.tone ?? 'neutral'} {...(look ? { icon: look.icon } : {})} label={entry.statusLabel} />;
          },
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{ title: 'No tenants yet', description: 'Tenants appear here once they are provisioned.', icon: 'platform' }}
        noResults={{ title: 'No tenants match', description: 'Try a name, a slug, a plan or a region.' }}
      />
      <TenantDrawer
        openId={openId}
        row={row}
        detail={detail && detail.id === openId ? detail : null}
        plans={plans}
        actions={actions}
        onClose={close}
      />
    </>
  );
}
