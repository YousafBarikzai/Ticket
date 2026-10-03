'use client';

import type { ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { InlineEdit, useItsm, type InlineEditOption, type InlineEditResult } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import type { CategorySummary, TeamSummary } from '../../client/desk-ticket.js';
import { searchPeople } from '../../client/desk-list.js';
import { LEVELS, PRIORITIES, type Level, type Priority, type TicketChange } from '../../client/mutations.js';
import { channelLabel, personName, priorityLabel, typeLabel } from '../../inbox/presentation.js';
import type { ChipChangeOptions } from '../PropertyChips.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { isLevel, LEVEL_LABEL } from './priority.js';
import { TriageOnRow, type TriageState } from './Triage.js';

/**
 * The inspector's Details (SPEC §6.2; A6 §5.6.5 row 4): the facts that route
 * the ticket (who asked is the Requester card's) — each editable in place where the reader may change it, through
 * the workspace's one writer (optimistic, with the version they saw, a
 * conflict explained rather than overwritten). AI triage sits on the rows it
 * would change: Team, Category and Priority.
 */

/** A save through the workspace, as the inline editor's answer. */
export async function saveThrough(ws: WorkspaceApi, change: TicketChange, options?: ChipChangeOptions): Promise<InlineEditResult> {
  const outcome = await ws.change(change, options);
  if (outcome === 'done') return undefined;
  if (outcome === 'conflict') return { error: 'Not saved: someone else changed this ticket first.' };
  return { error: ws.gate ?? 'Not saved. Try again.' };
}

function Row({ label, children, field }: { readonly label: string; readonly children: ReactNode; readonly field: string }): ReactNode {
  return (
    <div className="app-InspRow" data-field={field}>
      <dt className="app-InspRow__label">{label}</dt>
      <dd className="app-InspRow__value">{children}</dd>
    </div>
  );
}

function Plain({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="app-InspRow__text">{children}</span>;
}

function None({ children = 'Not set' }: { readonly children?: string }): ReactNode {
  return <span className="app-InspRow__none">{children}</span>;
}

/* ---------------------------------------------------------------- Rows */

export interface DetailsProps {
  readonly ws: WorkspaceApi;
  readonly triage: TriageState;
  readonly teams: readonly TeamSummary[] | null | undefined;
  readonly categories: readonly CategorySummary[] | null | undefined;
}

const LEVEL_OPTIONS: readonly InlineEditOption[] = LEVELS.map((level) => ({ value: level, label: LEVEL_LABEL[level] }));
const PRIORITY_OPTIONS: readonly InlineEditOption[] = PRIORITIES.map((priority) => ({ value: priority, label: priorityLabel(priority) }));

function reopenedText(count: number): string {
  if (count === 1) return 'Once';
  if (count === 2) return 'Twice';
  return `${count} times`;
}

export function Details({ ws, triage, teams, categories }: DetailsProps): ReactNode {
  const { ticket, people, viewer } = ws.bundle;
  const can = viewer.can;
  const { locale, timeZone } = useItsm();
  const gate = ws.gate;
  const at = (value: string): string => formatDateTime(value, { locale, timeZone });

  /* Team (A6): moving teams unassigns, as the chip does, with "Keep … assigned" on the toast. */
  const group = ticket.groupId?.toLowerCase() ?? null;
  const assignee = ticket.assigneeId?.toLowerCase() ?? null;
  const teamOptions: InlineEditOption[] = (teams ?? []).map((team) => ({ value: team.id, label: team.name }));
  if (group && !teamOptions.some((option) => option.value === group)) teamOptions.unshift({ value: group, label: 'Another team' });
  const teamName = group ? (teams?.find((team) => team.id === group)?.name ?? (teams ? 'Another team' : 'A team')) : null;
  const moveTeam = (value: string): Promise<InlineEditResult> => {
    if (!value) return Promise.resolve(undefined);
    const assigneeName = assignee ? personName(assignee, people, viewer.id) : null;
    const followUp =
      assignee && assigneeName
        ? { label: `Keep ${assigneeName === 'You' ? 'yourself' : assigneeName} assigned`, change: { kind: 'assign' as const, assigneeId: assignee } }
        : undefined;
    return saveThrough(ws, { kind: 'assign', assigneeId: null, groupId: value }, followUp ? { followUp } : undefined);
  };
  let team: ReactNode;
  if (teams && teams.length > 0 && can.assign) {
    team = (
      <InlineEdit
        label="Team"
        editor="select"
        value={group ?? ''}
        options={teamOptions}
        placeholder="No team"
        onSave={moveTeam}
        {...(gate ? { readOnlyReason: gate } : {})}
      />
    );
  } else {
    team = teamName ? <Plain>{teamName}</Plain> : <None>No team</None>;
  }

  /* Category (WA2): read-only, and named only when the list can be read. */
  const category = ticket.categoryId?.toLowerCase() ?? null;
  const categoryName = category ? (categories?.find((entry) => entry.id === category)?.path ?? 'Another category') : null;
  let categoryValue: ReactNode;
  if (categories && categories.length > 0 && can.update) {
    const options: InlineEditOption[] = categories.map((entry) => ({ value: entry.id, label: entry.path }));
    if (category && !options.some((option) => option.value === category)) options.unshift({ value: category, label: 'Another category' });
    categoryValue = (
      <InlineEdit
        label="Category"
        editor="select"
        value={category ?? ''}
        options={options}
        onSave={(next) => saveThrough(ws, { kind: 'category', categoryId: next || null })}
        {...(gate ? { readOnlyReason: gate } : {})}
      />
    );
  } else {
    categoryValue = categoryName ? <Plain>{categoryName}</Plain> : <None />;
  }

  /* Priority, impact and urgency: the service works the priority out again when either changes. */
  const priority = ticket.priority.toUpperCase();
  const priorityValue = can.update ? (
    <InlineEdit
      label="Priority"
      editor="select"
      value={priority}
      options={PRIORITY_OPTIONS}
      onSave={(next) => saveThrough(ws, { kind: 'priority', priority: next as Priority })}
      {...(gate ? { readOnlyReason: gate } : {})}
    />
  ) : (
    <Plain>{priorityLabel(ticket.priority)}</Plain>
  );
  const level = (value: string | null | undefined): Level | null => (isLevel(value) ? value : null);
  const levelEditor = (field: 'impact' | 'urgency'): ReactNode => {
    const current = level(ticket[field]);
    if (!can.update) return current ? <Plain>{LEVEL_LABEL[current]}</Plain> : <None />;
    return (
      <InlineEdit
        label={field === 'impact' ? 'Impact' : 'Urgency'}
        editor="select"
        value={current ?? ''}
        options={LEVEL_OPTIONS}
        onSave={(next) =>
          saveThrough(ws, field === 'impact' ? { kind: 'impact', impact: level(next) } : { kind: 'urgency', urgency: level(next) })
        }
        {...(gate ? { readOnlyReason: gate } : {})}
      />
    );
  };

  /* Affected user: the person the problem is with, when it is not the requester. */
  const affected = ticket.affectedUserId?.toLowerCase() ?? null;
  const requester = ticket.requesterId?.toLowerCase() ?? null;
  const affectedName = affected ? (affected === requester ? 'Same as requester' : personName(affected, people, viewer.id)) : null;
  const affectedValue =
    can.update && can.readPeople ? (
      <InlineEdit
        label="Affected user"
        editor="person"
        value={affected ?? ''}
        display={affectedName ?? undefined}
        placeholder="Search people"
        loadOptions={async (query) => (await searchPeople(query)).map((person) => ({ value: person.id, label: person.name }))}
        onSave={(next) => saveThrough(ws, { kind: 'affectedUser', affectedUserId: next || null })}
        {...(gate ? { readOnlyReason: gate } : {})}
      />
    ) : affectedName ? (
      <Plain>{affectedName}</Plain>
    ) : (
      <None>Not recorded</None>
    );

  return (
    <>
      <dl className="app-InspRows">
        <Row label="Affected user" field="affectedUser">
          {affectedValue}
        </Row>
        <Row label="Team" field="team">
          {team}
          <TriageOnRow triage={triage} row="team" />
        </Row>
        <Row label="Category" field="category">
          {categoryValue}
          <TriageOnRow triage={triage} row="category" />
        </Row>
        <Row label="Priority" field="priority">
          {priorityValue}
          <TriageOnRow triage={triage} row="priority" />
        </Row>
        <Row label="Impact" field="impact">
          {levelEditor('impact')}
        </Row>
        <Row label="Urgency" field="urgency">
          {levelEditor('urgency')}
          {can.update ? <p className="app-InspRow__hint">Changing impact or urgency works the priority out again.</p> : null}
        </Row>
        {ticket.serviceId ? (
          <Row label="Service" field="service">
            <Plain>Linked to a catalogue service</Plain>
          </Row>
        ) : null}
        <Row label="Type" field="type">
          <Plain>{typeLabel(ticket.type)}</Plain>
          <p className="app-InspRow__hint">Fixed when the ticket was raised</p>
        </Row>
        <Row label="Channel" field="channel">
          <Plain>{channelLabel(ticket.sourceChannel)}</Plain>
        </Row>
        <Row label="Raised" field="raised">
          <Plain>
            <time dateTime={ticket.createdAt}>{at(ticket.createdAt)}</time>
          </Plain>
        </Row>
        <Row label="Due" field="due">
          {ticket.dueAt ? (
            <Plain>
              <time dateTime={ticket.dueAt}>{at(ticket.dueAt)}</time>
            </Plain>
          ) : (
            <None>No due date</None>
          )}
        </Row>
        {ticket.resolvedAt ? (
          <Row label="Resolved" field="resolved">
            <Plain>
              <time dateTime={ticket.resolvedAt}>{at(ticket.resolvedAt)}</time>
            </Plain>
          </Row>
        ) : null}
        {ticket.reopenCount > 0 ? (
          <Row label="Reopened" field="reopened">
            <Plain>{reopenedText(ticket.reopenCount)}</Plain>
          </Row>
        ) : null}
      </dl>
    </>
  );
}

/** The ticket's facts as plain text, for a screen outside a workspace (never expected, but never empty). */
export function FactsOnly({ ticket, people, me }: { readonly ticket: Ticket; readonly people: Parameters<typeof personName>[1]; readonly me: string | null }): ReactNode {
  return (
    <dl className="app-InspRows">
      <Row label="Requester" field="requester">
        <Plain>{ticket.requesterId ? personName(ticket.requesterId.toLowerCase(), people, me) : 'Not recorded'}</Plain>
      </Row>
      <Row label="Priority" field="priority">
        <Plain>{priorityLabel(ticket.priority)}</Plain>
      </Row>
      <Row label="Type" field="type">
        <Plain>{typeLabel(ticket.type)}</Plain>
      </Row>
      <Row label="Channel" field="channel">
        <Plain>{channelLabel(ticket.sourceChannel)}</Plain>
      </Row>
    </dl>
  );
}
