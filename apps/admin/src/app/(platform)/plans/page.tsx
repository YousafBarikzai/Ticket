import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { requirePlatformOperator } from '../../../server/session.js';

export const metadata: Metadata = { title: 'Plans' };
export const dynamic = 'force-dynamic';

/**
 * The price list (OD-05, ADR-0047).
 *
 * `pricePerAgentMicros` is micro-pence and arrives as a string, because a
 * bigint does not survive JSON and a number loses precision on an annual
 * figure for a large tenant. It is formatted here and nowhere else.
 */
export function formatPrice(micros: string | null, currency: string): string {
  if (micros === null) return 'Negotiated';
  const pence = Number(BigInt(micros) / 10_000n) / 100;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence);
}

export default async function PlansPage(): Promise<ReactNode> {
  const { api } = await requirePlatformOperator();

  let plans: Awaited<ReturnType<typeof api.platform.plans>>;
  try {
    plans = await api.platform.plans();
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The plans could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Plans</h1>
        <p className="itsm-Admin__lede">
          Per agent, per month. <strong>Nothing in this platform charges anybody</strong> — these are the numbers a
          plan is sold against and the limits it enforces, not a billing system.
        </p>
      </header>

      <Table
        caption="Plans on this deployment"
        columns={[
          { key: 'name', header: 'Plan', cell: (row) => row.name },
          { key: 'price', header: 'Per agent', align: 'end', cell: (row) => formatPrice(row.pricePerAgentMicros, row.currency) },
          {
            key: 'agents',
            header: 'Agents',
            align: 'end',
            cell: (row) => {
              const limit = row.limits.find((entry) => entry.meter === 'agents');
              if (!limit) return 'No limit';
              return limit.hard === null ? `${limit.soft ?? '—'} then warned` : `${limit.hard} hard`;
            },
          },
          {
            key: 'retired',
            header: 'Sold',
            cell: (row) => (
              <Badge intent={row.isRetired ? 'neutral' : 'success'} srPrefix="Sold">
                {row.isRetired ? 'Retired' : 'Yes'}
              </Badge>
            ),
          },
        ]}
        rows={[...plans].sort((a, b) => a.sortOrder - b.sortOrder)}
        rowKey={(row) => row.key}
      />
    </div>
  );
}
