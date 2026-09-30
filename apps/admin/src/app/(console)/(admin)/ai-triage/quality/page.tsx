import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card, EmptyState, SegmentedControl, Table } from '@itsm/ui';
import { BarChart, LineChart } from '@itsm/ui/charts';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { rangeFrom } from '../../../../../components/ai-triage/decisions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import {
  acceptanceText,
  appliedText,
  asPercent,
  brierText,
  byFieldOrder,
  calibrationSeries,
  fieldLabel,
  gateShort,
  gateText,
  providerLabel,
  reasonLabel,
  skipRows,
} from '../../../../../triage.js';
import { modeViewOnly, rangeOptions, triageTabs } from '../data.js';
import '../../../../../components/ai-triage/ai-triage.css';

export const metadata: Metadata = { title: 'Quality · AI triage' };
export const dynamic = 'force-dynamic';

/**
 * AI triage › Quality (SPEC §6.1): how often each field's answer matched
 * what the desk settled on, how honest the confidence was (the reliability
 * chart, with the diagonal a perfectly calibrated answer would follow), the
 * auto-apply gate field by field, and who answered and who was passed over
 * and why. Every chart has its numbers under "View as table".
 *
 * Only resolved tickets are scored, so a quiet range says "nothing scored
 * yet" rather than drawing charts of nothing. The auto-apply gate is always
 * read over the backend's own 90-day window, whatever range is shown, so
 * what this page calls earned is what the next decision checks.
 */
export default async function QualityPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/ai-triage/quality');
  if (!access.allowed) return <Forbidden route="/ai-triage/quality" />;
  const { me, api } = access;
  const days = rangeFrom((await searchParams).days);
  const viewOnly = modeViewOnly(me);
  const range = (
    <div className="app-TriageRange">
      <SegmentedControl label="Period" mode="nav" value={String(days)} options={rangeOptions('/ai-triage/quality')} size="sm" />
    </div>
  );
  const header = <PageHeader title="AI triage" tabs={triageTabs(me)} {...(viewOnly ? { viewOnly } : {})} />;

  const score = await read(() => api.observe.ai.score({ purpose: 'triage', days }));
  if (!score.ok) {
    return (
      <div className="app-Page app-Triage">
        {header}
        {range}
        <Card title="Quality" problem={score.problem} />
      </div>
    );
  }
  const value = score.value;
  const questions = [...value.questions].sort((a, b) => byFieldOrder(a.question, b.question));
  const scored = questions.filter((question) => question.scored > 0 && question.accuracy !== null);
  const calibration = calibrationSeries(value.questions);
  const providers = Object.entries(value.byProvider).map(([provider, count]) => ({ id: provider, label: provider === 'rules' ? 'Nobody (rules)' : providerLabel(provider), value: count }));
  const skips = skipRows(value.skips);

  return (
    <div className="app-Page app-Triage">
      {header}
      {range}
      {scored.length === 0 ? (
        <Card>
          <EmptyState
            size="md"
            illustration="empty-chart"
            title="Nothing scored yet"
            description={
              value.decisions > 0
                ? `${value.decisions} ${value.decisions === 1 ? 'decision was' : 'decisions were'} made in the last ${days} days. Each is scored against what the desk settled on once its ticket is resolved.`
                : `No decisions in the last ${days} days. Answers are scored against what the desk settled on as their tickets are resolved.`
            }
          />
        </Card>
      ) : (
        <>
          <Card title="Accuracy by field" subtitle={`How often the answer matched what the desk settled on, over ${value.settled} resolved ${value.settled === 1 ? 'ticket' : 'tickets'}.`}>
            <BarChart
              title="Accuracy by field"
              titleHidden
              variant="list"
              sort="none"
              valueFormat={{ style: 'percent', maximumFractionDigits: 1 }}
              data={scored.map((question) => ({
                id: question.question,
                label: fieldLabel(question.question),
                value: question.accuracy ?? 0,
                secondary: `Brier ${brierText(question.brier)} · Auto-apply: ${gateShort(question)}`,
              }))}
              table="toggle"
              categoryLabel="Field"
              valueLabel="Right"
              description={`Right most often on ${fieldLabel([...scored].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0]!.question).toLowerCase()}. A lower Brier score means its confidence was more honest.`}
              locale={me.locale}
            />
          </Card>
          {calibration.series.length > 1 ? (
            <Card title="Is its confidence honest?" subtitle="When it said it was this sure, how often it was right. A well-calibrated answer follows the diagonal.">
              <LineChart
                title="Accuracy by confidence band"
                titleHidden
                xType="category"
                xLabel="Confidence it gave"
                series={calibration.series}
                yFormat={{ style: 'percent', maximumFractionDigits: 0 }}
                baseline="zero"
                table="toggle"
                interactive
                description="Points under the diagonal were over-confident; points above it, under-confident. Empty bands have no point."
                locale={me.locale}
              />
            </Card>
          ) : null}
          <Card title="Field by field" subtitle="The auto-apply gate is read over the last 90 days, whatever period is shown.">
            <Table
              caption="Field by field"
              captionHidden
              columns={[
                { key: 'field', header: 'Field', cell: (row) => fieldLabel(row.question) },
                { key: 'scored', header: 'Scored', cell: (row) => row.scored, align: 'end' },
                { key: 'accuracy', header: 'Right', cell: (row) => asPercent(row.accuracy), align: 'end' },
                { key: 'brier', header: 'Brier (lower is better)', cell: (row) => brierText(row.brier), align: 'end' },
                { key: 'agents', header: 'Agents', cell: (row) => acceptanceText(row), align: 'end' },
                { key: 'applied', header: 'Set by AI', cell: (row) => appliedText(row), align: 'end' },
                { key: 'gate', header: 'Auto-apply', cell: (row) => gateText(row) },
              ]}
              rows={questions}
              rowKey={(row) => row.question}
            />
          </Card>
        </>
      )}
      {providers.length > 0 ? (
        <div className="app-TriageProviders">
          <Card title="Who answered" subtitle={`Decisions in the last ${days} days, by who answered.`}>
            <BarChart
              title="Who answered"
              titleHidden
              variant="list"
              data={providers}
              valueFormat={{ maximumFractionDigits: 0 }}
              table="toggle"
              categoryLabel="Answered by"
              valueLabel="Decisions"
              locale={me.locale}
            />
          </Card>
          <Card title="Passed over" subtitle="A provider the chain skipped, and why. A skip never fails the ticket.">
            {skips.length > 0 ? (
              <Table
                caption="Providers passed over"
                captionHidden
                columns={[
                  { key: 'provider', header: 'Provider', cell: (row) => providerLabel(row.key.split(':')[0] ?? row.key) },
                  { key: 'why', header: 'Why', cell: (row) => reasonLabel(row.key.split(':')[1] ?? '') || '—' },
                  { key: 'count', header: 'Times', cell: (row) => row.count, align: 'end' },
                ]}
                rows={skips}
                rowKey={(row) => row.key}
              />
            ) : (
              <EmptyState size="sm" tone="success" title="Nobody was passed over" headingLevel={3} />
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
