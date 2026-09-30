'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, DescriptionList, EmptyState, InlineAlert, Meter, RelativeTime, StatusPill, VisuallyHidden, notify, useItsm, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { useDrawer } from '../../client/useDrawer.js';
import { OUTCOME_LOOK, decisionsCsv, type DecisionView } from './decisions.js';

/**
 * AI triage › Decisions (SPEC §6.1): every triage decision in the range —
 * when, which ticket (Open goes to the workbench), who answered, what it did,
 * how long it took, what it cost, and how many providers were passed over.
 * The reasons are in the drawer (`?open=decision:<id>`), never only in a
 * tooltip, beside each field's answer with its confidence and what it was
 * allowed to do, and the attempts in order.
 *
 * *Download CSV* saves the decisions in the range as a file named for the
 * workspace, the range and the day.
 */
export interface DecisionRowView extends DecisionView {
  /** Where the ticket opens, when this person may open it: the workbench, or this console's ticket finder. */
  readonly ticketHref?: string;
}

export interface DecisionsViewProps {
  readonly rows: readonly DecisionRowView[];
  readonly days: number;
  /** The API lists the newest 100; a full page may leave older ones in the range out. */
  readonly capped: boolean;
  readonly fileName: string;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'decision', other: 'decisions' };
const NEVER = { warning: 2, danger: 2 } as const;

const outcomeMap = Object.fromEntries(Object.entries(OUTCOME_LOOK).map(([key, look]) => [key, { label: look.label, tone: look.tone }]));

/** Saves text as a file in the browser: a Blob behind a temporary link (same origin, nothing fetched). */
export function saveFile(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DecisionsView({ rows, days, capped, fileName, problem }: DecisionsViewProps): ReactNode {
  const drawer = useDrawer('decision');
  const router = useRouter();
  const { locale } = useItsm();
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'when', header: 'When', field: 'createdAt', kind: 'relative', width: 150, minWidth: 130, sortable: 'page', cardRole: 'meta' },
      { id: 'ticket', header: 'Ticket', field: 'ticketLabel', kind: 'title', minWidth: 200, secondaryField: 'ticketTitle', truncate: 2 },
      { id: 'provider', header: 'Answered by', field: 'providerLabel', width: 150, minWidth: 130, hideBelow: 'sm' },
      { id: 'outcome', header: 'Outcome', field: 'outcome', kind: 'status', map: outcomeMap, srPrefix: 'Outcome', width: 170, minWidth: 150, cardRole: 'badge' },
      { id: 'time', header: 'Time', field: 'timeLabel', width: 100, minWidth: 90, align: 'end', hideBelow: 'md' },
      { id: 'cost', header: 'Cost', field: 'costDisplay', width: 100, minWidth: 90, align: 'end', hideBelow: 'md' },
      { id: 'passed', header: 'Passed over', field: 'passedOver', kind: 'number', width: 130, minWidth: 120, align: 'end', hideBelow: 'lg' },
    ],
    [],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'outcome',
        label: 'Outcome',
        type: 'multiselect',
        mode: 'client',
        pinned: true,
        options: Object.entries(OUTCOME_LOOK).map(([value, look]) => ({ value, label: look.label, tone: look.tone })),
      },
    ],
    [],
  );

  const download = (): void => {
    saveFile(fileName, decisionsCsv(rows));
    notify(`Downloaded ${rows.length} ${rows.length === 1 ? 'decision' : 'decisions'}`, { tone: 'success', description: fileName });
  };

  return (
    <>
      {capped ? (
        <InlineAlert tone="info">
          The newest 100 decisions are listed. Older ones in the last {days} days aren’t — the list goes no further back.
        </InlineAlert>
      ) : null}
      <DataTable<DecisionRowView>
        caption="Triage decisions"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        dataComplete={!capped}
        search={{ placeholder: 'Search decisions', mode: 'client', shortcut: '/' }}
        filters={filters}
        activate={{ kind: 'drawer', openKind: 'decision', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        {...(open ? { currentKeys: [open.id] } : {})}
        toolbarEnd={
          rows.length > 0 ? (
            <Button size="sm" variant="secondary" iconStart="download" onClick={download}>
              Download CSV<VisuallyHidden> of {rows.length} {rows.length === 1 ? 'decision' : 'decisions'}</VisuallyHidden>
            </Button>
          ) : null
        }
        cells={{
          passed: (row) =>
            row.passedOver > 0 ? (
              <span className="app-Decisions__passed">
                {row.passedOver}
                <VisuallyHidden> {row.passedOver === 1 ? 'provider' : 'providers'} passed over</VisuallyHidden>
              </span>
            ) : (
              <span className="app-Integrations__quiet">None</span>
            ),
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{
          title: `No decisions in the last ${days} days`,
          description: 'Triage decides each new ticket that arrives by email, the portal, chat or phone while it is on.',
          icon: 'ai',
        }}
        noResults={{ title: 'No decisions match', description: 'Try other words, or clear the filters.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open ? (open.ticketNumber ? `${open.ticketNumber} · triage` : 'Triage decision') : 'Triage decision'}
        {...(open?.ticketTitle ? { description: open.ticketTitle } : {})}
        {...(open ? { headerMeta: <StatusPill size="sm" tone={open.outcomeTone} label={open.outcomeLabel} srPrefix="Outcome" /> } : {})}
        {...(open?.ticketHref
          ? {
              footer: (
                <Button variant="primary" href={open.ticketHref}>
                  Open ticket
                </Button>
              ),
            }
          : {})}
      >
        {drawer.key !== null && !open ? (
          <EmptyState
            size="sm"
            title="That decision isn’t in this list"
            description={`It may be older than the last ${days} days, or than the newest 100. Try a longer period.`}
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={() => drawer.close()}
          />
        ) : open ? (
          <div className="app-Delivery">
            <DescriptionList
              layout="inline"
              dense
              items={[
                { id: 'when', label: 'When', value: <RelativeTime date={open.createdAt} mode="absolute" absoluteStyle="datetime" /> },
                { id: 'mode', label: 'Mode', value: open.modeLabel },
                { id: 'provider', label: 'Answered by', value: open.providerLabel },
                { id: 'time', label: 'Time', value: open.timeLabel },
                { id: 'cost', label: 'Cost', value: open.costDisplay },
              ]}
            />
            <div className="app-Delivery__section">
              <h3 id="decision-answers" className="app-Delivery__heading">
                Answers
              </h3>
              {open.answers.length === 0 ? (
                <p className="app-Delivery__note">Nobody answered, so the ticket kept what intake gave it.</p>
              ) : (
                <ul className="app-Answers">
                  {open.answers.map((answer) => (
                    <li key={answer.question} className="app-Answers__item">
                      <div className="app-Answers__head">
                        <span className="app-Answers__field">{answer.label}</span>
                        <span className="app-Answers__value">{answer.value}</span>
                        {answer.actionLabel ? <StatusPill size="sm" tone={answer.action === 'apply' ? 'accent' : answer.action === 'suggest' ? 'info' : 'neutral'} label={answer.actionLabel} /> : null}
                      </div>
                      <Meter
                        label={`Confidence in ${answer.label.toLowerCase()}`}
                        value={answer.confidence}
                        max={1}
                        // A confidence is not a quota: full is certainty, not a limit reached.
                        thresholds={NEVER}
                        format={{ style: 'percent', maximumFractionDigits: 0 }}
                        locale={locale}
                      />
                      {answer.why ? <p className="app-Delivery__note">Why not more: {answer.why}.</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="app-Delivery__section">
              <h3 id="decision-attempts" className="app-Delivery__heading">
                Who was asked, in order
              </h3>
              {open.attempts.length === 0 ? (
                <p className="app-Delivery__note">No provider was asked.</p>
              ) : (
                <ol className="app-Attempts">
                  {open.attempts.map((attempt, index) => (
                    <li key={`${attempt.provider}-${index}`} className="app-Attempts__item" data-outcome={attempt.outcome}>
                      <StatusPill
                        size="sm"
                        tone={attempt.outcome === 'answered' ? 'success' : attempt.outcome === 'failed' ? 'danger' : 'neutral'}
                        label={attempt.outcomeLabel}
                      />
                      <span className="app-Attempts__who">{attempt.providerLabel}</span>
                      <span className="app-Attempts__why">
                        {attempt.reasonLabel ? `${attempt.reasonLabel}` : ''}
                        {attempt.ms > 0 ? `${attempt.reasonLabel ? ' · ' : ''}${attempt.ms} ms` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
