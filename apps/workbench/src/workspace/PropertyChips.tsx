'use client';

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Avatar, Button, PriorityChip, StatusPill, VisuallyHidden, ticketStateLook, type ButtonProps } from '@itsm/ui';
import { ConfirmDialog, Dialog, Menu, PersonPicker, type MenuItemSpec, type PersonOption } from '@itsm/ui/overlays';
import type { CategorySummary, TeamSummary, WorkspacePermissions } from '../client/desk-ticket.js';
import { searchPeople } from '../client/desk-list.js';
import { PRIORITIES, type Priority, type TicketChange } from '../client/mutations.js';
import { personName, priorityLabel, stateLabel, type PeopleMap } from '../inbox/presentation.js';
import { ALLOWED_TRANSITIONS, transitionsFrom } from '../queue/transitions.js';

/**
 * The ticket's properties as chips (SPEC §6.2, v3 §7.1.4): Status, Priority,
 * Assignee, Team and Category, each a menu that changes it in place — then
 * the one next step. The keys `s`, `p` (then `1`–`4`), `a` and `t` open the
 * same menus from anywhere in the ticket or the list.
 *
 * Status and priority carry their D5 look — the state's `StatusPill` (a
 * wait in `hold`, never amber) and the priority's `PriorityChip` with its
 * bars, spoken "Priority 3, medium" — and the rest are neutral. The SLA is
 * no longer words in this row: it is the hero's SLA block (`SlaBlock`).
 *
 * A chip the person may not change is shown, not hidden — the value is the
 * point — but as plain text without a menu. Only moves the state machine
 * allows are offered (`transitionsFrom`), gated on `ticket.transition`
 * (F24); a tenant's own status that this app does not know reads "Managed by
 * a workflow" rather than offering moves the service would refuse.
 */

export type ChipMenu = 'status' | 'priority' | 'assignee' | 'team' | 'category';

/** A change, and what to offer after it lands ("Keep Jo assigned"). */
export interface ChipChangeOptions {
  readonly followUp?: { readonly label: string; readonly change: TicketChange };
}

export interface PropertyChipsProps {
  readonly ticket: Ticket;
  readonly people: PeopleMap;
  readonly me: string | null;
  readonly meName: string;
  readonly can: WorkspacePermissions;
  /** The tenant's teams (A6); `null` when the API cannot list them — the chip is then read-only. */
  readonly teams: readonly TeamSummary[] | null | undefined;
  /** Ticket categories (WA2); `null` when the API cannot list them. */
  readonly categories: readonly CategorySummary[] | null | undefined;
  /** "Step 2 of 5", said with the status where the lifecycle row is not drawn (the pane). */
  readonly step?: string | null;
  /** A state gate for every change: "Needs a connection", "You no longer have access to this ticket". */
  readonly gate?: string;
  readonly openMenu: ChipMenu | null;
  readonly onOpenMenuChange: (menu: ChipMenu | null) => void;
  /** Where focus goes when a menu opened by a shortcut closes: the row it was pressed on. */
  readonly returnFocusTo?: RefObject<HTMLElement | null> | null;
  readonly onChange: (change: TicketChange, options?: ChipChangeOptions) => void;
  /** "Resolve…" in the status menu: the resolve popover, which asks what fixed it. */
  readonly onResolve: () => void;
  /** Fields someone else just changed: they flash once (a static dot under reduced motion). */
  readonly flash?: ReadonlySet<ChipMenu>;
  /** The next step, at the end of the row. */
  readonly children?: ReactNode;
}

/* ------------------------------------------------------------- Status */

/** The waiting states, offered first: the moves an agent makes most while a ticket is theirs. */
const SUGGESTED: readonly { readonly to: string; readonly label: string }[] = [
  { to: 'pending_requester', label: 'Wait on requester' },
  { to: 'pending_third_party', label: 'Wait on supplier' },
  { to: 'pending_approval', label: 'Needs approval' },
];

const MOVE_LABEL: Readonly<Record<string, string>> = {
  in_progress: 'In progress',
  resolved: 'Resolve…',
  reopened: 'Reopen',
  closed: 'Close',
  cancelled: 'Cancel ticket',
};

export interface StatusChoice {
  readonly to: string;
  readonly label: string;
  readonly suggested: boolean;
}

/** What the status menu offers from a state: the waiting states first, then every other allowed move. */
export function statusChoices(status: string): readonly StatusChoice[] {
  const allowed = transitionsFrom(status);
  const suggested = SUGGESTED.filter((entry) => allowed.includes(entry.to)).map((entry) => ({ ...entry, suggested: true }));
  const rest = allowed
    .filter((to) => !SUGGESTED.some((entry) => entry.to === to))
    .map((to) => ({ to, label: MOVE_LABEL[to] ?? stateLabel(to), suggested: false }));
  return [...suggested, ...rest];
}

/** Whether this app knows the state (and so which moves it has); a tenant's own state is a workflow's. */
export function isKnownState(status: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, status);
}

/** The timer the ticket answers to: moved to the SLA block, named here still for the callers that read it from the chips. */
export { headlineTimer } from './SlaBlock.js';

/* ---------------------------------------------------------------- Chips */

interface ChipProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly flash?: boolean;
  readonly field: ChipMenu;
}

/** The chip's question ("Status: "), for the ear: the v3 chips show their values alone, as the benchmark's do. */
function ChipLabel({ label }: { readonly label: string }): ReactNode {
  if (!label) return null;
  return <VisuallyHidden className="app-Chip__label">{`${label}: `}</VisuallyHidden>;
}

/** A property the person may not change: the same shape, no menu. */
function StaticChip({ label, children, flash, field, note }: ChipProps & { readonly note?: string }): ReactNode {
  return (
    <span className="app-Chip app-Chip--static" data-field={field} data-flash={flash ? '' : undefined}>
      <ChipLabel label={label} />
      <span className="app-Chip__value">{children}</span>
      {note ? <span className="app-Chip__note">{note}</span> : null}
    </span>
  );
}

function ChipTrigger({ label, children, flash, field, ...rest }: ChipProps & Omit<ButtonProps, 'children'>): ReactNode {
  return (
    <Button
      {...rest}
      variant="secondary"
      size="sm"
      shape="capsule"
      className="app-Chip"
      iconEnd="chevron-down"
      data-field={field}
      data-flash={flash ? '' : undefined}
    >
      <ChipLabel label={label} />
      <span className="app-Chip__value">{children}</span>
    </Button>
  );
}

const PRIORITY_KEYS: Readonly<Record<string, Priority>> = { '1': 'P1', '2': 'P2', '3': 'P3', '4': 'P4' };

export function PropertyChips({
  ticket,
  people,
  me,
  meName,
  can,
  teams,
  categories,
  step,
  gate,
  openMenu,
  onOpenMenuChange,
  returnFocusTo,
  onChange,
  onResolve,
  flash,
  children,
}: PropertyChipsProps): ReactNode {
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const closeFocus: 'trigger' | RefObject<HTMLElement | null> = returnFocusTo ?? 'trigger';
  const menuProps = (menu: ChipMenu) => ({
    open: openMenu === menu,
    onOpenChange: (open: boolean) => onOpenMenuChange(open ? menu : openMenu === menu ? null : openMenu),
    onCloseFocus: closeFocus,
  });
  const gated = gate ? { disabled: true, disabledReason: gate } : {};

  /* `1`–`4` while the priority menu is open (SPEC §5.6): the menu's own typeahead would look for a "1". */
  useEffect(() => {
    if (openMenu !== 'priority' || !can.update || gate) return;
    const onKey = (event: KeyboardEvent): void => {
      const priority = PRIORITY_KEYS[event.key];
      if (!priority || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenMenuChange(null);
      if (priority !== ticket.priority) onChange({ kind: 'priority', priority });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openMenu, can.update, gate, onOpenMenuChange, onChange, ticket.priority]);

  /* Status */
  const look = ticketStateLook(ticket.status, ticket.statusCategory);
  const statusValue = (
    <>
      <StatusPill size="md" tone={look.tone} icon={look.icon} label={stateLabel(ticket.status)} className="app-Chip__pill" />
      {step ? <VisuallyHidden>{`, ${step.toLowerCase()}`}</VisuallyHidden> : null}
    </>
  );
  const known = isKnownState(ticket.status);
  const choices = known ? statusChoices(ticket.status) : [];
  let status: ReactNode;
  if (!known) {
    status = (
      <StaticChip label="Status" field="status" flash={flash?.has('status')} note="Managed by a workflow">
        {statusValue}
      </StaticChip>
    );
  } else if (!can.transition || choices.length === 0) {
    status = (
      <StaticChip label="Status" field="status" flash={flash?.has('status')}>
        {statusValue}
      </StaticChip>
    );
  } else {
    const suggested = choices.filter((choice) => choice.suggested);
    const moves = choices.filter((choice) => !choice.suggested);
    const item = (choice: StatusChoice): MenuItemSpec => ({
      id: `status-${choice.to}`,
      label: choice.label,
      ...(choice.to === 'cancelled' ? { tone: 'danger' as const } : {}),
      ...gated,
      onSelect: () => {
        if (choice.to === 'resolved') onResolve();
        // A cancelled ticket has no way back (no moves out of it): ask first.
        else if (choice.to === 'cancelled') setCancelling(true);
        else onChange({ kind: 'status', to: choice.to });
      },
    });
    const items: MenuItemSpec[] = [
      ...(suggested.length > 0 ? [{ type: 'label' as const, label: 'Suggested' }, ...suggested.map(item)] : []),
      ...(suggested.length > 0 && moves.length > 0 ? [{ type: 'separator' as const }] : []),
      ...(moves.length > 0 ? [{ type: 'label' as const, label: 'Move to' }, ...moves.map(item)] : []),
    ];
    status = (
      <Menu
        {...menuProps('status')}
        label={`Change the status of ${ticket.number}`}
        items={items}
        trigger={
          <ChipTrigger label="Status" field="status" flash={flash?.has('status')} aria-keyshortcuts="S">
            {statusValue}
          </ChipTrigger>
        }
      />
    );
  }

  /* Priority */
  // The chip's own words follow the chip's question ("Priority: 3, medium"), so it does not say "priority" twice.
  const priorityValue = <PriorityChip priority={ticket.priority.toUpperCase()} words size="md" srPrefix="" className="app-Chip__priority" />;
  const priority = can.update ? (
    <Menu
      {...menuProps('priority')}
      label={`Change the priority of ${ticket.number}`}
      items={[
        {
          type: 'radio',
          id: 'priority',
          label: 'Priority · press 1 to 4',
          value: ticket.priority.toUpperCase(),
          items: PRIORITIES.map((value) => ({ value, label: priorityLabel(value) })),
          onValueChange: (value) => {
            if (gate) return;
            if (value !== ticket.priority) onChange({ kind: 'priority', priority: value as Priority });
          },
        },
      ]}
      trigger={
        <ChipTrigger label="Priority" field="priority" flash={flash?.has('priority')} aria-keyshortcuts="P">
          {priorityValue}
        </ChipTrigger>
      }
    />
  ) : (
    <StaticChip label="Priority" field="priority" flash={flash?.has('priority')}>
      {priorityValue}
    </StaticChip>
  );

  /* Assignee */
  const assignee = ticket.assigneeId?.toLowerCase() ?? null;
  const assigneeName = assignee ? personName(assignee, people, me) : null;
  const assigneeValue = assignee ? (
    <>
      <Avatar name={assignee === me ? meName : (people[assignee]?.name ?? 'Unknown person')} size="xs" decorative />
      {assigneeName}
    </>
  ) : (
    <span className="app-Chip__none">Unassigned</span>
  );
  const assigneeItems: MenuItemSpec[] = [
    ...(me && assignee !== me ? [{ id: 'assign-me', label: 'Assign to me', icon: 'user' as const, shortcut: 'i', ...gated, onSelect: () => onChange({ kind: 'assign', assigneeId: me }) }] : []),
    ...(can.readPeople ? [{ id: 'assign-to', label: 'Assign to…', icon: 'user-plus' as const, ...gated, onSelect: () => setAssigning(true) }] : []),
    ...(assignee ? [{ id: 'unassign', label: 'Unassign', icon: 'x' as const, ...gated, onSelect: () => onChange({ kind: 'assign', assigneeId: null }) }] : []),
  ];
  const assigneeChip =
    can.assign && assigneeItems.length > 0 ? (
      <Menu
        {...menuProps('assignee')}
        label={`Assign ${ticket.number}`}
        items={assigneeItems}
        trigger={
          <ChipTrigger label="Assignee" field="assignee" flash={flash?.has('assignee')} aria-keyshortcuts="A">
            {assigneeValue}
          </ChipTrigger>
        }
      />
    ) : (
      <StaticChip label="Assignee" field="assignee" flash={flash?.has('assignee')}>
        {assigneeValue}
      </StaticChip>
    );

  /* Team (A6): read-only when the teams cannot be listed. */
  const group = ticket.groupId?.toLowerCase() ?? null;
  const teamName = group ? (teams?.find((team) => team.id === group)?.name ?? (teams ? 'Another team' : 'A team')) : null;
  const teamValue = teamName ?? <span className="app-Chip__none">No team</span>;
  let teamChip: ReactNode = null;
  if (teams && teams.length > 0 && can.assign) {
    teamChip = (
      <Menu
        {...menuProps('team')}
        label={`Move ${ticket.number} to a team`}
        items={[
          {
            type: 'radio',
            id: 'team',
            label: assignee && assigneeName ? `Team · moving unassigns ${assigneeName}` : 'Team',
            value: group ?? '',
            items: teams.map((team) => ({ value: team.id, label: team.name })),
            onValueChange: (value) => {
              if (gate || value === group) return;
              // Moving teams unassigns by default (SPEC §6.2, "Also unassign Jo"): the
              // new team picks it up. Keeping the person is one press on the toast.
              const followUp =
                assignee && assigneeName ? { label: `Keep ${assigneeName === 'You' ? 'yourself' : assigneeName} assigned`, change: { kind: 'assign' as const, assigneeId: assignee } } : undefined;
              onChange({ kind: 'assign', assigneeId: null, groupId: value }, followUp ? { followUp } : {});
            },
          },
        ]}
        trigger={
          <ChipTrigger label="Team" field="team" flash={flash?.has('team')} aria-keyshortcuts="T">
            {teamValue}
          </ChipTrigger>
        }
      />
    );
  } else if (group || teams) {
    teamChip = (
      <StaticChip label="Team" field="team" flash={flash?.has('team')}>
        {teamValue}
      </StaticChip>
    );
  }

  /* Category (WA2) */
  const category = ticket.categoryId?.toLowerCase() ?? null;
  const categoryName = category ? (categories?.find((entry) => entry.id === category)?.path ?? 'Another category') : null;
  const categoryValue = categoryName ?? <span className="app-Chip__none">Not set</span>;
  let categoryChip: ReactNode = null;
  if (categories && categories.length > 0 && can.update) {
    categoryChip = (
      <Menu
        {...menuProps('category')}
        label={`Set the category of ${ticket.number}`}
        items={[
          {
            type: 'radio',
            id: 'category',
            label: 'Category',
            value: category ?? '',
            items: [{ value: '', label: 'Not set' }, ...categories.map((entry) => ({ value: entry.id, label: entry.path }))],
            onValueChange: (value) => {
              if (gate || value === (category ?? '')) return;
              onChange({ kind: 'category', categoryId: value || null });
            },
          },
        ]}
        trigger={
          <ChipTrigger label="Category" field="category" flash={flash?.has('category')}>
            {categoryValue}
          </ChipTrigger>
        }
      />
    );
  } else if (category || categories) {
    categoryChip = (
      <StaticChip label="Category" field="category" flash={flash?.has('category')}>
        {categoryValue}
      </StaticChip>
    );
  }

  const meOption = useMemo<PersonOption | undefined>(() => (me ? { id: me, name: meName } : undefined), [me, meName]);

  return (
    <div className="app-Chips" role="group" aria-label="Ticket properties">
      {status}
      {priority}
      {assigneeChip}
      {teamChip}
      {categoryChip}
      {children ? <span className="app-Chips__end">{children}</span> : null}
      {cancelling ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setCancelling(false);
          }}
          spec={{
            title: `Cancel ${ticket.number}?`,
            body: 'A cancelled ticket can’t be reopened. If it’s needed again, raise a follow-up.',
            confirmLabel: 'Cancel ticket',
            cancelLabel: 'Keep it open',
            tone: 'danger',
          }}
          onConfirm={async () => {
            setCancelling(false);
            onChange({ kind: 'status', to: 'cancelled' });
          }}
        />
      ) : null}
      {assigning ? (
        <AssignDialog
          number={ticket.number}
          me={meOption}
          onClose={() => setAssigning(false)}
          onPick={(person) => {
            setAssigning(false);
            if (person.id !== assignee) onChange({ kind: 'assign', assigneeId: person.id });
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- Assign to… */

function AssignDialog({
  number,
  me,
  onClose,
  onPick,
}: {
  readonly number: string;
  readonly me: PersonOption | undefined;
  readonly onClose: () => void;
  readonly onPick: (person: PersonOption) => void;
}): ReactNode {
  const [value, setValue] = useState<PersonOption | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Assign ${number}`}
      description="Search by name or email address."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onPick(value)}>
            Assign
          </Button>
        </>
      }
    >
      <PersonPicker
        aria-label="Person"
        value={value}
        onChange={(next) => setValue(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null))}
        loadPeople={async (query) => searchPeople(query)}
        extras={{ assignToMe: Boolean(me) }}
        {...(me ? { me } : {})}
      />
    </Dialog>
  );
}
