'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Button, usePins } from '@itsm/ui';
import { FilterBar, ViewMenu, type FilterOption, type FilterSpec, type FilterValue } from '@itsm/ui/data';
import { PageHeader } from '@itsm/ui/shell';
import { searchPeople } from '../client/desk-list.js';
import { priorityLabel, stateLabel, typeLabel, type PeopleMap } from './presentation.js';
import { PRIORITIES, TICKET_NOUN } from './queries.js';
import type { InboxPermissions, ListCount } from './TicketList.js';
import { inboxHref, viewById, viewFilter, type InboxParam, type InboxSort, type InboxView, type TeamSummary } from './views.js';

/**
 * The list pane's header (SPEC §6.2): the view's name and how many tickets
 * it holds, "Filter this view" (`/`), the filter chips, and the View menu.
 *
 * Every filter is a visible chip with its value and its own ×, and the
 * choices offered are the ones that can match in this view — no "Resolved"
 * in My work, no assignee in a view that is about one. Changes go to the
 * URL without a server round trip (the caller writes it); the list follows.
 */

export interface ListHeaderProps {
  readonly view: InboxView;
  readonly count: ListCount | null;
  readonly teams: readonly TeamSummary[];
  /** Names for people in the URL's filters, so a chip says "Requester: Ada". */
  readonly people: PeopleMap;
  readonly me: string | null;
  readonly can: InboxPermissions;
  onChange(change: Partial<Record<InboxParam, string>>): void;
  /** Touch devices: "Select" shows the checkboxes and makes a tap select. */
  readonly selectable: boolean;
  readonly selectMode: boolean;
  onSelectModeChange(on: boolean): void;
}

const CATEGORY_STATES: Readonly<Record<string, readonly string[]>> = {
  open: ['new', 'in_progress', 'reopened'],
  paused: ['pending_requester', 'pending_third_party', 'pending_approval'],
  resolved: ['resolved'],
  closed: ['closed', 'cancelled'],
};

const TYPES = ['incident', 'request', 'question', 'problem', 'change'] as const;

export const SORT_OPTIONS: readonly { readonly value: InboxSort; readonly label: string }[] = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'dueAt', label: 'Due soonest' },
  { value: '-dueAt', label: 'Due latest' },
];

/** The states a view can hold, so the Status chip only offers what can match. */
export function statusOptionsFor(view: InboxView): string[] {
  const base = viewFilter(view.ref);
  if (base.status) return base.status.split(',');
  return (base.statusCategory ?? '')
    .split(',')
    .flatMap((category) => CATEGORY_STATES[category] ?? []);
}

function list(value: string): string[] {
  return value ? value.split(',') : [];
}

function joined(value: FilterValue | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : '';
}

/** A person's option, named from what the page already knows. */
function personOption(id: string, people: PeopleMap): FilterOption {
  return { value: id, label: people[id]?.name ?? 'Someone' };
}

/**
 * Publishes the header's height as `--app-inbox-header` on the pane, so what
 * sticks under it (the "N new" capsule, the refresh line) sits just below it
 * however many rows of chips it wraps to.
 */
function useHeaderHeight(): (element: HTMLDivElement | null) => void {
  const element = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const header = element.current;
    const pane = header?.parentElement;
    if (!header || !pane || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => pane.style.setProperty('--app-inbox-header', `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return useCallback((node: HTMLDivElement | null) => {
    element.current = node;
  }, []);
}

export function ListHeader({ view, count, teams, people, me, can, onChange, selectable, selectMode, onSelectModeChange }: ListHeaderProps): ReactNode {
  const pins = usePins();
  const headerRef = useHeaderHeight();
  const lockedAssignee = view.ref.kind === 'view' && viewById(view.ref.id).lockedAssignee;
  const statuses = useMemo(() => statusOptionsFor(view), [view]);
  const { requester, assignee } = view.filters;

  const loadPeople = useCallback(async (query: string): Promise<readonly FilterOption[]> => {
    const hits = await searchPeople(query);
    return hits.map((hit) => ({ value: hit.id, label: hit.id === me ? `${hit.name} (you)` : hit.name }));
  }, [me]);

  const filters = useMemo<FilterSpec[]>(() => {
    const specs: FilterSpec[] = [];
    if (statuses.length > 1) {
      specs.push({ id: 'status', label: 'Status', type: 'multiselect', pinned: true, options: statuses.map((state) => ({ value: state, label: stateLabel(state) })) });
    }
    specs.push({
      id: 'priority',
      label: 'Priority',
      type: 'multiselect',
      pinned: true,
      options: PRIORITIES.map((priority) => ({ value: priority, label: priorityLabel(priority) })),
    });
    specs.push({ id: 'type', label: 'Type', type: 'multiselect', options: TYPES.map((type) => ({ value: type, label: typeLabel(type) })) });
    if (!lockedAssignee) {
      const fixed: FilterOption[] = [
        { value: 'me', label: 'Me' },
        { value: 'none', label: 'Unassigned' },
      ];
      const named = assignee && assignee !== 'me' && assignee !== 'none' ? [personOption(assignee, people)] : [];
      specs.push(
        can.readPeople
          ? {
              id: 'assignee',
              label: 'Assignee',
              type: 'person',
              options: [...fixed, ...named],
              loadOptions: async (query, signal) => {
                const found = await loadPeople(query);
                if (signal.aborted) return [];
                const words = query.trim().toLowerCase();
                return [...fixed.filter((option) => !words || option.label.toLowerCase().includes(words)), ...found];
              },
            }
          : { id: 'assignee', label: 'Assignee', type: 'select', options: [...fixed, ...named] },
      );
    }
    if (view.ref.kind === 'view' && teams.length > 0) {
      specs.push({ id: 'team', label: 'Team', type: 'select', options: teams.map((team) => ({ value: team.id, label: team.name })) });
    }
    if (can.readPeople) {
      specs.push({
        id: 'requester',
        label: 'Requester',
        type: 'person',
        ...(requester ? { options: [personOption(requester, people)] } : {}),
        loadOptions: (query) => loadPeople(query),
      });
    } else if (requester) {
      // Arrived by a link ("Tickets from Ada"): shown, so it can be seen and cleared.
      specs.push({ id: 'requester', label: 'Requester', type: 'select', options: [personOption(requester, people)] });
    }
    return specs;
  }, [statuses, lockedAssignee, assignee, requester, people, can.readPeople, view.ref.kind, teams, loadPeople]);

  const values = useMemo<Record<string, FilterValue>>(
    () => ({
      status: list(view.filters.status),
      priority: list(view.filters.priority),
      type: list(view.filters.type),
      assignee: view.filters.assignee || null,
      team: view.filters.team || null,
      requester: view.filters.requester || null,
    }),
    [view.filters],
  );

  const pinId = `inbox:${inboxHref(view, { t: '' })}`;
  const pinned = pins.isPinned(pinId);
  const countText = count && (count.shown > 0 || count.hasMore) ? `${count.shown}${count.hasMore ? '+' : ''} ${count.shown === 1 && !count.hasMore ? TICKET_NOUN.one : TICKET_NOUN.other}` : undefined;

  return (
    <div ref={headerRef} className="app-InboxHeader">
      <PageHeader className="app-InboxHeader__page" title={view.title} {...(countText ? { meta: countText } : {})} />
      <FilterBar
        className="app-InboxHeader__filters"
        label={`Filters for ${view.title}`}
        search={{
          value: view.filters.q,
          label: 'Filter this view',
          placeholder: 'Filter this view',
          shortcut: '/',
          onValueChange: (q) => onChange({ q }),
        }}
        filters={filters}
        values={values}
        onChange={(next) => {
          onChange({
            status: joined(next.status),
            priority: joined(next.priority),
            type: joined(next.type),
            ...(lockedAssignee ? {} : { assignee: joined(next.assignee) }),
            team: joined(next.team),
            requester: joined(next.requester),
          });
        }}
        end={
          selectable ? (
            <Button className="app-InboxHeader__select" size="sm" variant="ghost" aria-pressed={selectMode} onClick={() => onSelectModeChange(!selectMode)}>
              {selectMode ? 'Done' : 'Select'}
            </Button>
          ) : undefined
        }
        viewMenu={
          <ViewMenu
            {...(view.fixedSort ? {} : { sort: { options: SORT_OPTIONS, value: view.sort, onChange: (sort: string) => onChange({ sort }) } })}
            density
            extra={[
              {
                id: 'pin',
                label: pinned ? 'Unpin this view' : 'Pin this view',
                icon: 'pin',
                onSelect: () =>
                  pinned
                    ? pins.unpin(pinId)
                    : pins.pin({ id: pinId, label: view.filtered ? `${view.title} (filtered)` : view.title, href: inboxHref(view, { t: '' }), kind: 'view' }),
              },
            ]}
          />
        }
      />
    </div>
  );
}
