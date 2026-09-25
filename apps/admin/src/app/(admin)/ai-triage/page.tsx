import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, EmptyState, Metric, MetricGrid, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';
import { asPercent, brierText, calibrationRows, fieldLabel, gateText, modeNotice, skipLabel, skipRows } from '../../../triage.js';

export const metadata: Metadata = { title: 'AI triage' };
export const dynamic = 'force-dynamic';

/**
 * Shadow triage, and whether it has earned anything (ADR-0051).
 *
 * In shadow the AI decides a triage for each new channel ticket and records
 * it, and nothing on the ticket changes. When the ticket is resolved, what it
 * was resolved as is written against the decision. This page is the only place
 * that comparison is read — which is the point of shadow: the evidence for
 * letting a decision act is gathered where nobody is affected by it.
 *
 * Read-only. The mode and thresholds are settings, and changing them happens
 * under Configuration with the audit trail that goes with it. The recent
 * decisions list needs `ai.manage`, because a list of every decision is a list
 * of every triaged ticket; the totals need only `ai.read`.
 */
export default async function AiTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'ai.read')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see AI triage"
        description="It needs ai.read. Ask an administrator."
      />
    );
  }

  const params = await searchParams;
  const days = Math.min(365, Math.max(1, Number.parseInt(params.days ?? '90', 10) || 90));
  const manager = holds(me, 'ai.manage');

  const [score, recent] = await Promise.all([
    read(() => api.observe.ai.score({ purpose: 'triage', days })),
    manager ? read(() => api.observe.ai.decisions({ purpose: 'triage', limit: 25 })) : Promise.resolve(null),
  ]);

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>AI triage</h1>
        <p className="itsm-Admin__lede">
          In shadow, the AI decides a type, category, team and priority for each new email, chat, voice and portal
          ticket and records it. Nothing on the ticket changes. When the ticket is resolved, the answer is compared with
          what the desk settled on — and that comparison is what would one day let a decision act on its own.
        </p>
      </header>

      {!score.ok ? (
        <EmptyState tone="error" title="AI triage could not be loaded" description={score.message} />
      ) : (
        <>
          {modeNotice(score.value) ? (
            <p className="itsm-Admin__note" role="status">
              {modeNotice(score.value)}
            </p>
          ) : null}

          <MetricGrid>
            <Metric label={`Decisions, last ${days} days`} value={score.value.decisions} note={`Mode: ${score.value.mode}`} />
            <Metric
              label="Scored"
              value={score.value.settled}
              note="Resolved tickets whose answer has been compared with the desk's."
            />
            <Metric
              label="Fell back to rules"
              value={score.value.fellToRules}
              note="No provider answered, so the ticket kept what intake gave it."
              tone={score.value.fellToRules > 0 ? 'bad' : 'neutral'}
            />
            <Metric
              label="Cost"
              value={score.value.costDisplay}
              note={
                score.value.meanLatencyMs === null
                  ? 'Counted in this month’s AI budget.'
                  : `Mean answer time ${score.value.meanLatencyMs} ms. Counted in the AI budget.`
              }
            />
          </MetricGrid>

          <Panel
            title="How often it matched the desk"
            description={
              <>
                Against resolved tickets only. Auto-apply would need {Math.round(score.value.thresholds.auto * 100)}%
                confidence and is earned per field from this evidence; it is{' '}
                {score.value.autoEligible ? (
                  <Badge intent="success" srPrefix="Auto">
                    earned
                  </Badge>
                ) : (
                  <Badge srPrefix="Auto">not earned</Badge>
                )}{' '}
                and is not switched on in this release.
              </>
            }
            result={{ ok: true, value: score.value.questions }}
            empty="Nothing has been scored yet. Scores appear once triaged tickets are resolved."
          >
            {(questions) => (
              <Table
                caption="Accuracy by field"
                columns={[
                  { key: 'field', header: 'Field', cell: (row) => fieldLabel(row.question) },
                  { key: 'scored', header: 'Scored', cell: (row) => row.scored, align: 'end' },
                  { key: 'accuracy', header: 'Right', cell: (row) => asPercent(row.accuracy), align: 'end' },
                  { key: 'brier', header: 'Brier (lower is better)', cell: (row) => brierText(row.brier), align: 'end' },
                  { key: 'gate', header: 'Auto-apply', cell: (row) => gateText(row) },
                ]}
                rows={questions}
                rowKey={(row) => row.question}
              />
            )}
          </Panel>

          <Panel
            title="Is its confidence honest?"
            description="How often it was right when it said it was this sure. A well-calibrated answer at 90% is right about nine times in ten."
            result={{ ok: true, value: calibrationRows(score.value.questions) }}
            empty="Nothing to calibrate yet."
          >
            {(rows) => (
              <Table
                caption="Calibration by confidence band"
                columns={[
                  { key: 'band', header: 'It said', cell: (row) => row.band },
                  ...score.value.questions.map((question) => ({
                    key: question.question,
                    header: fieldLabel(question.question),
                    cell: (row: (typeof rows)[number]) => row.cells[question.question] ?? '—',
                    align: 'end' as const,
                  })),
                ]}
                rows={rows}
                rowKey={(row) => row.band}
              />
            )}
          </Panel>

          <Panel
            title="Who answered, and who was passed over"
            description="Each decision asks its providers in order and skips any that cannot be used. A skip is never a failure of the ticket."
            result={{ ok: true, value: skipRows(score.value.skips) }}
            empty="No provider has been passed over."
          >
            {(rows) => (
              <>
                <p className="itsm-Admin__note">
                  Answered by:{' '}
                  {Object.entries(score.value.byProvider)
                    .map(([provider, count]) => `${provider} ${count}`)
                    .join(' · ') || 'nobody yet'}
                </p>
                <Table
                  caption="Providers passed over"
                  columns={[
                    { key: 'why', header: 'Passed over', cell: (row) => row.label },
                    { key: 'count', header: 'Times', cell: (row) => row.count, align: 'end' },
                  ]}
                  rows={rows}
                  rowKey={(row) => row.key}
                />
              </>
            )}
          </Panel>
        </>
      )}

      {recent ? (
        <Panel title="Recent decisions" result={recent} empty="No decisions yet.">
          {(rows) => (
            <Table
              caption="Recent triage decisions"
              columns={[
                { key: 'when', header: 'When', cell: (row) => new Date(row.createdAt).toLocaleString() },
                { key: 'ticket', header: 'Ticket', cell: (row) => <code>{row.subjectId}</code> },
                {
                  key: 'who',
                  header: 'Answered by',
                  cell: (row) => (row.provider === 'rules' ? 'Nobody (rules)' : `${row.provider} · ${row.model ?? ''}`),
                },
                { key: 'outcome', header: 'Outcome', cell: (row) => row.outcome },
                { key: 'ms', header: 'Time', cell: (row) => (row.provider === 'rules' ? '—' : `${row.latencyMs} ms`), align: 'end' },
                { key: 'cost', header: 'Cost', cell: (row) => row.costDisplay, align: 'end' },
                {
                  key: 'skipped',
                  header: 'Passed over',
                  cell: (row) =>
                    row.attempts
                      .filter((attempt) => attempt.outcome !== 'answered' && attempt.reason)
                      .map((attempt) => skipLabel(`${attempt.provider}:${attempt.reason}`))
                      .join('; ') || '—',
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}
