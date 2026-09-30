'use client';

import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Ticket } from '@itsm/sdk';
import { Disclosure, Icon, SkeletonText, useItsm, type InlineEditResult } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { categoriesQuery, teamsQuery } from '../../client/desk-ticket.js';
import { priorityLabel, type PeopleMap } from '../../inbox/presentation.js';
import { useTicketWorkspace, type WorkspaceApi } from '../TicketWorkspace.js';
import { Connections } from './Connections.js';
import { CustomFieldRows, applicableFields } from './CustomFields.js';
import { Details, FactsOnly, saveThrough } from './Details.js';
import './inspector.css';
import { fieldsQuery } from './queries.js';
import { SlaSection } from './SlaSection.js';
import { Tasks, tasksOf, tasksSummary } from './Tasks.js';
import { TriageStrip, useTriage } from './Triage.js';

/**
 * The ticket inspector (SPEC §6.2, X-12): a calm column of the ticket's
 * properties beside the conversation from 800 px of workspace, and the same
 * content in a non-modal sheet (`]`, "Show details") below that.
 *
 * Sections, each a disclosure that remembers being opened or closed on this
 * device: **Details** and **SLA** open by default — who asked and the facts
 * that route the ticket, and the clocks — then Custom fields, Connections
 * (tags, watchers, related tickets), Tasks and Assist, closed until wanted.
 * AI triage sits on the rows it would change, with a strip at the top only
 * while suggestions wait.
 *
 * Every change goes through the workspace's one writer (`useTicketWorkspace`),
 * so an edit here is optimistic, carries the version the person saw, and a
 * conflict is explained in the same dialog as a chip's.
 */

export interface InspectorProps {
  readonly ticket: Ticket;
  /** Names for the ids on the ticket (requester, assignee). */
  readonly people?: PeopleMap;
  /** The signed-in person's id, so their own name reads "You". */
  readonly me?: string | null;
  /** `column` beside the conversation; `sheet` when the window is narrower. */
  readonly mode?: 'column' | 'sheet';
}

/** Assist is loaded when its section is first opened: most tickets are worked without it. */
const LazyAssist = lazy(() => import('../assist/Assist.js'));

/** Where each section's open or closed state is remembered on this device. */
export const SECTION_KEYS = {
  details: 'wb.inspector.details',
  sla: 'wb.inspector.sla',
  custom: 'wb.inspector.custom',
  connections: 'wb.inspector.connections',
  tasks: 'wb.inspector.tasks',
  assist: 'wb.inspector.assist',
} as const;

/** The text "Copy summary" puts on the clipboard for a possible major incident. */
export function incidentSummary(ticket: Ticket, link: string, locale: string, timeZone: string): string {
  const description = (ticket.description ?? '').trim();
  return [
    `${ticket.number} · ${ticket.title}`,
    `Priority: ${priorityLabel(ticket.priority)}`,
    `Raised: ${formatDateTime(ticket.createdAt, { locale, timeZone })}`,
    description ? `\n${description.length > 600 ? `${description.slice(0, 600)}…` : description}` : '',
    `\n${link}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function Inspector({ ticket, people = {}, me = null, mode = 'column' }: InspectorProps): ReactNode {
  const ws = useTicketWorkspace();
  if (!ws) {
    return (
      <div className="app-Insp" data-mode={mode}>
        <FactsOnly ticket={ticket} people={people} me={me} />
      </div>
    );
  }
  return <InspectorBody ws={ws} mode={mode} />;
}

function InspectorBody({ ws, mode }: { readonly ws: WorkspaceApi; readonly mode: 'column' | 'sheet' }): ReactNode {
  const { ticket, viewer, timers, entries } = ws.bundle;
  const can = viewer.can;
  const { locale, timeZone } = useItsm();
  const teams = useQuery(teamsQuery()).data;
  const categories = useQuery(categoriesQuery()).data;
  const definitions = useQuery(fieldsQuery()).data;
  const fields = useMemo(() => applicableFields(definitions, ticket), [definitions, ticket]);
  const tasks = useMemo(() => tasksOf(entries), [entries]);
  const triage = useTriage(ws);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  /* Connections and Assist read on first opening: most tickets are worked without them, and `j`/`k` should cost one read. */
  const [connectionsOpened, setConnectionsOpened] = useState(false);
  const [assistOpened, setAssistOpened] = useState(false);

  /** "Review": opens Details and moves to the first suggestion's Accept. */
  const review = useCallback(() => {
    const details = detailsRef.current;
    if (details) details.open = true;
    requestAnimationFrame(() => {
      const first = details?.querySelector<HTMLElement>('[data-triage-pending] button');
      first?.scrollIntoView?.({ block: 'nearest' });
      first?.focus();
    });
  }, []);

  const saveCustom = useCallback(
    (field: (typeof fields)[number], value: unknown): Promise<InlineEditResult> =>
      saveThrough(ws, {
        kind: 'custom',
        key: field.key,
        label: field.label,
        value,
        ...(field.type === 'select' && typeof value === 'string' ? { display: field.options.find((option) => option.value === value)?.label ?? value } : {}),
      }),
    [ws],
  );

  const link = typeof window === 'undefined' ? `/tickets/${ticket.number}` : `${window.location.origin}/tickets/${encodeURIComponent(ticket.number)}`;

  return (
    <div className="app-Insp" data-mode={mode}>
      <TriageStrip triage={triage} onReview={review} summaryText={incidentSummary(ticket, link, locale, timeZone)} />

      <Disclosure ref={detailsRef} summary="Details" defaultOpen persistKey={SECTION_KEYS.details} className="app-Insp__section">
        <Details ws={ws} triage={triage} teams={teams} categories={categories} />
      </Disclosure>

      {timers !== null ? (
        <Disclosure summary="SLA" defaultOpen persistKey={SECTION_KEYS.sla} className="app-Insp__section">
          <SlaSection timers={timers} />
        </Disclosure>
      ) : null}

      {fields.length > 0 ? (
        <Disclosure summary={<SectionSummary label="Custom fields" count={`${fields.length}`} />} persistKey={SECTION_KEYS.custom} className="app-Insp__section">
          <CustomFieldRows
            fields={fields}
            ticket={ticket}
            {...(!can.update ? { readOnlyReason: 'You can’t change this ticket' } : ws.gate ? { readOnlyReason: ws.gate } : {})}
            onSave={saveCustom}
          />
        </Disclosure>
      ) : null}

      <Disclosure
        summary="Connections"
        persistKey={SECTION_KEYS.connections}
        className="app-Insp__section"
        onToggle={(event) => {
          if (event.currentTarget.open) setConnectionsOpened(true);
        }}
      >
        {connectionsOpened ? <Connections ws={ws} /> : null}
      </Disclosure>

      <Disclosure summary={<SectionSummary label="Tasks" count={tasksSummary(tasks)} />} persistKey={SECTION_KEYS.tasks} className="app-Insp__section">
        <Tasks ws={ws} />
      </Disclosure>

      {can.aiRead ? (
        <Disclosure
          summary={<SectionSummary label="Assist" icon />}
          persistKey={SECTION_KEYS.assist}
          className="app-Insp__section"
          onToggle={(event) => {
            if (event.currentTarget.open) setAssistOpened(true);
          }}
        >
          {assistOpened ? (
            <Suspense fallback={<SkeletonText lines={3} size="callout" />}>
              <LazyAssist />
            </Suspense>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}

function SectionSummary({ label, count, icon = false }: { readonly label: string; readonly count?: string; readonly icon?: boolean }): ReactNode {
  return (
    <span className="app-Insp__summary">
      <span>{label}</span>
      {icon ? <Icon name="sparkles" size="xs" className="app-Insp__summaryIcon" /> : null}
      {count ? <span className="app-Insp__summaryCount">{count}</span> : null}
    </span>
  );
}
