'use client';

import { memo, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Avatar, Checkbox, Icon, IconButton, RelativeTime, StatusPill, useItsm } from '@itsm/ui';
import type { CollectionColumn } from '@itsm/ui/a11y';
import { Menu, type MenuItemSpec } from '@itsm/ui/overlays';
import {
  dueText,
  dueUrgency,
  isUrgentPriority,
  isWaitingState,
  priorityLabel,
  rowDescription,
  rowLabel,
  stateLabel,
  type PersonName,
} from './presentation.js';
import type { ListRow } from './queries.js';

/**
 * One ticket in the inbox list (SPEC §6.2, X-33, X-62, X-67).
 *
 * Two calm lines at comfortable density — the title, and then what it is
 * (number, requester, state, P1/P2, team) with the assignee's avatar — and one
 * line at compact. The end of the first line is the updated time, or the
 * deadline when it is within the hour or passed: that is the only time a row
 * raises its voice, and it does so in words with an icon, never a ring.
 *
 * Three sibling controls, never one inside another: the checkbox, the link
 * (whose hit area stretches over the row) and the ⋯ menu. The link is named
 * "VPN keeps dropping, INC-000123, unread" and described "Priority 2, In
 * progress, due in 2 h 10 min, updated 5 min ago", so a screen reader hears a
 * row the way a sighted person scans it.
 *
 * Memoised: the list re-renders on every clock tick and live refresh, and a
 * row that has not changed should cost nothing.
 */

export interface TicketRowProps {
  readonly row: ListRow;
  readonly index: number;
  readonly href: string;
  /** The requester's name, or null when the ticket has none. */
  readonly requester: string | null;
  /** The assignee, when the view shows one (not in My work) and there is one. */
  readonly assignee: PersonName | null;
  /** The team's name, in views that span teams. */
  readonly team: string | null;
  /** The ticket open beside the list (`?t=`). */
  readonly current: boolean;
  readonly selectable: boolean;
  readonly checked: boolean;
  readonly unread: boolean;
  /** Set when the row has left the view: why ("Now assigned to Jo"). */
  readonly moved: string | null;
  readonly flash: boolean;
  readonly now: number;
  /** The list is ordered by deadline, so the row shows its deadline rather than its age. */
  readonly byDue?: boolean;
  /** Which of this row's controls holds the list's one tab stop, if any. */
  readonly tabStop: CollectionColumn | null;
  readonly menuOpen: boolean;
  /** The ⋯ menu's items; only built while it is open. */
  readonly menuItems: readonly MenuItemSpec[];
  /** Where focus goes when the menu closes: the control it was opened from (X-63). */
  readonly menuReturn: RefObject<HTMLElement | null>;
  readonly onMenuOpenChange: (index: number, open: boolean) => void;
  readonly onLinkClick: (index: number, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onCheck: (index: number, checked: boolean, extend: boolean) => void;
  /** ↑ and ↓ on the ⋯ button move between rows, as from any other control in the row. */
  readonly onMenuKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** The pointer rests on the row (or leaves it): its ticket may be wanted soon. */
  readonly onIntent?: (index: number, resting: boolean) => void;
  readonly rowRef: (index: number, element: HTMLLIElement | null) => void;
}

function ignoreChange(): void {
  // Controlled: `onClick` reports the change to the list.
}

function control(index: number, column: CollectionColumn, tabStop: CollectionColumn | null) {
  return { tabIndex: (tabStop === column ? 0 : -1) as 0 | -1, 'data-itsm-control': column, 'data-itsm-row': index };
}

/**
 * The time at the end of line 1. A deadline within the hour, or missed, is
 * always shown, loud (SPEC §6.2). Otherwise it is the time the list is
 * ordered by: in a list sorted by deadline (Due soon, My work) a later
 * deadline is shown quietly, because "updated 17 hr ago" beside a row placed
 * by its deadline explains nothing about why it sits there. A paused ticket's
 * clock is stopped, so it shows its age instead.
 */
function RowTime({ row, now, locale, byDue }: { readonly row: ListRow; readonly now: number; readonly locale?: string; readonly byDue: boolean }): ReactNode {
  const urgency = row.statusCategory === 'open' ? dueUrgency(row.dueAt, now) : null;
  if (urgency === 'breached' || urgency === 'soon') {
    return (
      <span className="app-TicketRow__due" data-urgency={urgency}>
        <Icon name={urgency === 'breached' ? 'circle-alert' : 'clock'} size="xs" />
        {dueText(row.dueAt, now, locale)}
      </span>
    );
  }
  if (byDue && urgency === 'later') {
    return <span className="app-TicketRow__due">{dueText(row.dueAt, now, locale)}</span>;
  }
  return <RelativeTime className="app-TicketRow__time" date={row.updatedAt} />;
}

function TicketRowView({
  row,
  index,
  href,
  requester,
  assignee,
  team,
  current,
  selectable,
  checked,
  unread,
  moved,
  flash,
  now,
  byDue = false,
  tabStop,
  menuOpen,
  menuItems,
  menuReturn,
  onMenuOpenChange,
  onLinkClick,
  onCheck,
  onMenuKeyDown,
  onIntent,
  rowRef,
}: TicketRowProps): ReactNode {
  const { Link, locale } = useItsm();
  const descriptionId = `inbox-row-${row.id}-description`;
  const urgency = row.statusCategory === 'open' ? dueUrgency(row.dueAt, now) : null;
  const description = [rowDescription(row, now, locale), team, moved].filter(Boolean).join(', ');

  return (
    <li
      ref={(element) => rowRef(index, element)}
      className="app-TicketRow"
      data-itsm-row={index}
      data-row-id={row.id}
      data-current={current || undefined}
      data-checked={checked || undefined}
      data-unread={unread || undefined}
      data-moved={moved !== null || undefined}
      data-flash={flash || undefined}
      data-urgency={urgency === 'breached' || urgency === 'soon' ? urgency : undefined}
      onPointerEnter={onIntent ? () => onIntent(index, true) : undefined}
      onPointerLeave={onIntent ? () => onIntent(index, false) : undefined}
    >
      <span className="app-TicketRow__gutter">
        {unread ? <span className="app-TicketRow__dot" aria-hidden="true" /> : null}
        {selectable ? (
          <Checkbox
            className="app-TicketRow__check"
            label={`Select ${row.number}`}
            labelHidden
            checked={checked}
            // A click (or Space) says whether Shift was held, for a range; the
            // change itself is the list's to make, so the box stays controlled.
            onChange={ignoreChange}
            onClick={(event) => onCheck(index, !checked, event.shiftKey)}
            {...control(index, 'select', tabStop)}
          />
        ) : null}
      </span>

      <Link
        href={href}
        prefetch={false}
        className="app-TicketRow__link"
        data-avatar={assignee ? '' : undefined}
        aria-label={rowLabel(row, unread)}
        aria-describedby={descriptionId}
        aria-current={current ? 'true' : undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => onLinkClick(index, event)}
        {...control(index, 'primary', tabStop)}
      >
        <span className="app-TicketRow__title">{row.title}</span>
        <span className="app-TicketRow__end">
          <RowTime row={row} now={now} locale={locale} byDue={byDue} />
        </span>
        <span className="app-TicketRow__meta">
          <span className="app-TicketRow__number">{row.number}</span>
          {requester ? <span className="app-TicketRow__requester">{requester}</span> : null}
          {isWaitingState(row.status) ? (
            <StatusPill className="app-TicketRow__pill" size="sm" tone="warning" icon="pause" label={stateLabel(row.status)} />
          ) : (
            <span className="app-TicketRow__status">{stateLabel(row.status)}</span>
          )}
          {isUrgentPriority(row.priority) ? (
            <span className="app-TicketRow__priority" data-priority={row.priority.toUpperCase()} title={priorityLabel(row.priority)}>
              <Icon name="flag" size="xs" />
              {row.priority.toUpperCase()}
            </span>
          ) : null}
          {team ? <span className="app-TicketRow__team">{team}</span> : null}
          {moved ? (
            <span className="app-TicketRow__moved">
              <Icon name="arrow-right" size="xs" directional />
              {moved}
            </span>
          ) : null}
        </span>
        {assignee ? <Avatar className="app-TicketRow__avatar" name={assignee.name} initials={assignee.initials} size="xs" decorative /> : null}
        <span className="app-TicketRow__updated" aria-hidden="true" />
      </Link>
      <span id={descriptionId} hidden>
        {description}
      </span>

      <span className="app-TicketRow__menu">
        <Menu
          label={`Actions for ${row.number}`}
          align="end"
          open={menuOpen}
          onOpenChange={(open) => onMenuOpenChange(index, open)}
          onCloseFocus={menuReturn}
          items={menuItems}
          trigger={
            <IconButton
              className="app-TicketRow__more"
              label={`More actions for ${row.number}`}
              icon="ellipsis"
              size="sm"
              variant="ghost"
              tooltip={false}
              onKeyDown={onMenuKeyDown}
              {...control(index, 'menu', tabStop)}
            />
          }
        />
      </span>
    </li>
  );
}

export const TicketRow = memo(TicketRowView);
