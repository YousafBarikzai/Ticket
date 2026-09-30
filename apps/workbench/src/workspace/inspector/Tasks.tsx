'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TimelineEntry, TimelineTaskEntry } from '@itsm/sdk';
import { Button, Checkbox, FormField, Input, notify } from '@itsm/ui';
import { api } from '../../client/api.js';
import { deskKeys } from '../../client/query-client.js';
import { personName, problemOf } from '../../inbox/presentation.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';

/**
 * The ticket's tasks (SPEC §6.2 "Tasks"): the pieces of work inside it, from
 * its history, ticked off here and added here with `ticket.task.manage`. A
 * finished task stays ticked — the service has no way to reopen one, so the
 * box is not offered as if it had.
 */

export function tasksOf(entries: readonly TimelineEntry[]): TimelineTaskEntry[] {
  const byId = new Map<string, TimelineTaskEntry>();
  for (const entry of entries) if (entry.kind === 'task') byId.set(entry.id, entry);
  return [...byId.values()];
}

export function isDone(task: Pick<TimelineTaskEntry, 'status'>): boolean {
  return task.status === 'done' || task.status === 'completed' || task.status === 'cancelled';
}

/** "2 open" / "All done": the section's count. */
export function tasksSummary(tasks: readonly TimelineTaskEntry[]): string {
  if (tasks.length === 0) return 'None';
  const open = tasks.filter((task) => !isDone(task)).length;
  return open === 0 ? 'All done' : `${open} open`;
}

export function Tasks({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { entries, viewer, people, ticket } = ws.bundle;
  const tasks = useMemo(() => tasksOf(entries), [entries]);
  const client = useQueryClient();
  const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const canManage = viewer.can.tasks === true;
  const gate = ws.gate;

  const complete = async (task: TimelineTaskEntry): Promise<void> => {
    if (gate) {
      notify(gate, { tone: 'warning' });
      return;
    }
    setCompleting((current) => new Set([...current, task.id]));
    try {
      await api.completeTask(task.id);
      notify(`“${task.title}” done`, { tone: 'success' });
      await client.invalidateQueries({ queryKey: deskKeys.ticket(ticket.number) });
    } catch (failure) {
      const problem = problemOf(failure);
      notify('That task isn’t done yet', { tone: 'danger', ...(problem.detail ? { description: problem.detail } : {}) });
    } finally {
      setCompleting((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  const add = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Say what needs doing.');
      field.current?.focus();
      return;
    }
    setAdding(true);
    setError(undefined);
    try {
      await api.createTask(ticket.number, { title: trimmed });
      setTitle('');
      notify('Task added', { tone: 'success' });
      await client.invalidateQueries({ queryKey: deskKeys.ticket(ticket.number) });
    } catch (failure) {
      const problem = problemOf(failure);
      setError(problem.fieldErrors?.title ?? problem.detail ?? 'That task wasn’t added. Try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="app-Tasks">
      {tasks.length === 0 ? (
        <p className="app-Insp__empty">No tasks on this ticket.</p>
      ) : (
        <ul className="app-Tasks__list">
          {tasks.map((task) => {
            const done = isDone(task) || completing.has(task.id);
            const owner = task.assigneeId ? personName(task.assigneeId.toLowerCase(), people, viewer.id) : null;
            return (
              <li key={task.id} className="app-Tasks__item" data-done={isDone(task) ? '' : undefined}>
                <Checkbox
                  label={task.title}
                  {...(owner ? { description: owner } : {})}
                  checked={done}
                  disabled={!canManage || isDone(task) || completing.has(task.id)}
                  onChange={(event) => {
                    if (event.target.checked) void complete(task);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? (
        <form
          className="app-Tasks__add"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <FormField label="New task" labelHidden {...(error ? { error } : {})}>
            <Input
              ref={field}
              value={title}
              maxLength={200}
              placeholder="Add a task"
              autoComplete="off"
              onChange={(event) => {
                setTitle(event.target.value);
                setError(undefined);
              }}
            />
          </FormField>
          <Button type="submit" size="sm" variant="secondary" loading={adding} loadingLabel="Adding task…" {...(gate ? { disabledReason: gate } : {})}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
