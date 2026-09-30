import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { StatusPill } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { TenantsView } from '../../../../components/platform/TenantsView.js';
import type { TenantDetail } from '../../../../components/platform/TenantDrawer.js';
import { platformMeterViews, plansInOrder, tenantView } from '../../../../components/platform/presentation.js';
import { read } from '../../../../server/read.js';
import { requirePlatformOperator } from '../../../../server/session.js';
import { changePlan, resumeTenant, setAiRegions, suspendTenant } from '../actions.js';
import '../../../../components/platform/platform.css';

export const metadata: Metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

/** `?open=tenant:<id>` → the id, or null. (A local reading: `useDrawer` is a client module a server page cannot call.) */
function openTenant(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('tenant:')) return null;
  const id = value.slice('tenant:'.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Platform › Tenants (SPEC §6.1 `/tenants`): every desk on this deployment
 * with its status and plan; a drawer per tenant with its meters, AI regions
 * and the operator's actions. Behind the `(platform)` layout's 404 gate; the
 * page asks again (cached for the request) because it needs the operator's
 * API client, and the writes ask a third time, on their own requests.
 */
export default async function TenantsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const { me, api } = await requirePlatformOperator();
  const [tenants, plans, params] = await Promise.all([read(() => api.platform.tenants()), read(() => api.platform.plans()), searchParams]);
  const planRows = plans.ok ? plansInOrder(plans.value) : [];
  const format = { locale: me.locale, timeZone: me.timeZone };
  const rows = tenants.ok ? tenants.value.map((row) => tenantView(row, planRows, format)) : [];

  const openId = openTenant(params.open);
  let detail: TenantDetail | null = null;
  if (openId && rows.some((row) => row.id === openId)) {
    const usage = await read(() => api.platform.tenantUsage(openId));
    detail = usage.ok ? { id: openId, meters: platformMeterViews(usage.value, me.locale) } : { id: openId, meters: null, problem: usage.problem };
  } else if (openId) {
    detail = { id: openId, meters: null, problem: { status: 404 } };
  }

  return (
    <div className="app-Page app-Platform">
      <PageHeader
        title="Tenants"
        className="app-PlatformHeader"
        status={<StatusPill tone="info" icon="platform" label="Operator" />}
        {...(tenants.ok && rows.length === 0 ? { subtitle: 'Every desk on this deployment.' } : {})}
      />
      <TenantsView
        rows={rows}
        plans={planRows.map((plan) => ({ key: plan.key, name: plan.name, retired: plan.isRetired }))}
        detail={detail}
        actions={{ suspend: suspendTenant, resume: resumeTenant, changePlan, setAiRegions }}
        {...(tenants.ok ? {} : { problem: tenants.problem })}
      />
    </div>
  );
}
