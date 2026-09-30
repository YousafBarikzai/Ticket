import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { MetricsTable, type MetricTableRow } from '../../../../../components/insights/MetricsTable.js';
import { measureSentence, unitLabel } from '../../../../../components/insights/presentation.js';
import { tabsFor } from '../../../../../navigation.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/insights/insights.css';

export const metadata: Metadata = { title: 'Metrics · Insights' };
export const dynamic = 'force-dynamic';

/** The vocabulary `GET /analytics/metrics` serves beside the list: each fact and the dimensions it can be broken down by. */
function dimensionsByFact(facts: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!Array.isArray(facts)) return out;
  for (const entry of facts) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { fact, dimensions } = entry as { fact?: unknown; dimensions?: unknown };
    if (typeof fact === 'string' && Array.isArray(dimensions)) out[fact] = dimensions.filter((name): name is string => typeof name === 'string');
  }
  return out;
}

/**
 * Insights › Metrics (SPEC §6.1): every metric the desk can ask about — the
 * built-in ones and the desk's own — with what each measures in words, and
 * a live explorer a row away.
 */
export default async function MetricsPage(): Promise<ReactNode> {
  const access = await pageAccess('/insights/metrics');
  if (!access.allowed) return <Forbidden route="/insights/metrics" />;
  const { me, api } = access;
  const metrics = await read(() => api.observe.insights.metrics());

  return (
    <div className="app-Page app-Insights">
      <PageHeader title="Insights" tabs={tabsFor(me, 'insights')} />
      {metrics.ok ? (
        <MetricsTable
          dimensions={dimensionsByFact(metrics.value.facts)}
          rows={metrics.value.data.map(
            (metric): MetricTableRow => ({
              key: metric.key,
              name: metric.name,
              description: metric.description,
              fact: metric.fact,
              aggregate: metric.aggregate,
              ...(metric.field ? { field: metric.field } : {}),
              unit: metric.unit,
              measures: measureSentence(metric),
              unitLabel: unitLabel(metric.unit),
              origin: metric.builtin ? 'builtin' : 'custom',
            }),
          )}
        />
      ) : (
        <Card title="Metrics" problem={metrics.problem} />
      )}
    </div>
  );
}
