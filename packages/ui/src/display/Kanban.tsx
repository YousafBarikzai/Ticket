import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { ShellLink } from '../shell/ShellLink.js';
import type { IconName, Tone } from '../types.js';
import { Avatar, UNASSIGNED_LABEL } from '../web/Avatar.js';
import { cx } from '../web/cx.js';
import { Count } from './Count.js';
import { PriorityChip } from './PriorityChip.js';

/** Where a dragged card would land: allowed, refused, or under the pointer right now. */
export type KanbanDropState = 'idle' | 'allowed' | 'blocked' | 'over';

export interface KanbanColumnProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** Stable key of the column ("in_progress"); also builds the heading's id, so it must be unique on the page. */
  readonly id: string;
  /** "In progress", "Closed". */
  readonly title: string;
  /** The column's state tone: its icon is drawn in this intent's border colour. */
  readonly tone: Tone;
  readonly icon: IconName;
  /** Cards in the column; `null` when it is not counted (never drawn as 0). */
  readonly count: number | null;
  /** Beside the count: a pill such as "2 breaching". */
  readonly meta?: ReactNode;
  /** A line under the header: "None overdue". */
  readonly sub?: string;
  /**
   * Folded to a 56 px strip with the count and a vertical title. The strip is
   * a button "Show Closed, 41" when `onFoldedChange` is given, otherwise a
   * link to `foldHref`; with neither it only shows the count.
   */
  readonly folded?: boolean;
  /** Where the strip goes when there is no client to unfold it in place: the board with this column open. */
  readonly foldHref?: string;
  /**
   * Client only: unfolds (`false`) from the strip and folds (`true`) from the
   * header's "Hide" button, which is drawn only when this is given.
   */
  readonly onFoldedChange?: (folded: boolean) => void;
  /** While a card is dragged: `allowed` lights the column, `blocked` dims it and shows why not, `over` is the target. */
  readonly dropState?: KanbanDropState;
  /** Heading level of the column title; 3 by default (page `h1`, board section `h2`). */
  readonly headingLevel?: 2 | 3 | 4;
  /** The cards (`KanbanCard`). */
  readonly children?: ReactNode;
  /** What an empty column says: "Nothing waiting". */
  readonly empty?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/** The DOM id of a column's heading: the column id, made safe for an id attribute. */
function headingId(id: string): string {
  return `itsm-kanban-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function hasCards(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) return false;
  if (Array.isArray(children)) return children.some(hasCards);
  return true;
}

function FoldedStrip({
  title,
  icon,
  count,
  foldHref,
  onFoldedChange,
}: Pick<KanbanColumnProps, 'title' | 'icon' | 'count' | 'foldHref' | 'onFoldedChange'>): ReactNode {
  // The title comes before the count in the DOM so the control is called
  // "Show Closed, 41"; the stylesheet puts the count above it.
  const content = (
    <>
      <Icon name={icon} size="md" className="itsm-KanbanColumn__icon" />
      <span className="itsm-KanbanColumn__stripTitle">
        <span className="itsm-visually-hidden">Show </span>
        {title}
      </span>
      <Count value={count} className="itsm-KanbanColumn__count" />
      <Icon name="chevron-right" size="sm" directional className="itsm-KanbanColumn__chevron" />
    </>
  );
  if (onFoldedChange) {
    return (
      <button type="button" className="itsm-KanbanColumn__strip" aria-expanded={false} onClick={() => onFoldedChange(false)}>
        {content}
      </button>
    );
  }
  if (foldHref) {
    return (
      <ShellLink href={foldHref} className="itsm-KanbanColumn__strip">
        {content}
      </ShellLink>
    );
  }
  return (
    <div className="itsm-KanbanColumn__strip" data-static="">
      <Icon name={icon} size="md" className="itsm-KanbanColumn__icon" />
      <span className="itsm-KanbanColumn__stripTitle">{title}</span>
      <Count value={count} className="itsm-KanbanColumn__count" />
    </div>
  );
}

/**
 * A board column (v3 §2.13, A1 §7.12). Presentational and server-safe: the
 * Service Desk's client board wraps it with drag and drop.
 *
 * A raised-alt well with a 1 px `border.subtle` edge and the card radius,
 * at least 260 px tall. The 44 px header sticks while the cards scroll: the
 * state icon in its intent's colour, the title, the count, any `meta`, and —
 * when the board can fold it — a "Hide" button. Cards sit in a list, so a
 * screen reader hears "list, 12 items" under the column's heading.
 *
 * Folded, the column is a 56 px strip — the board's Resolved and Closed by
 * default — whose one control is named "Show Closed, 41"; the column carries
 * `data-folded` (the §7.0.1 test hook the parity checks count). During a
 * drag, `dropState` lights an allowed target, dims a refused one with a
 * "no entry" badge, and marks the column under the pointer.
 */
export function KanbanColumn({
  id,
  title,
  tone,
  icon,
  count,
  meta,
  sub,
  folded = false,
  foldHref,
  onFoldedChange,
  dropState = 'idle',
  headingLevel = 3,
  children,
  empty,
  className,
  ref,
  ...rest
}: KanbanColumnProps): ReactNode {
  const common = {
    ...rest,
    ref,
    className: cx('itsm-KanbanColumn', className),
    'data-tone': tone,
    'data-drop-state': dropState === 'idle' ? undefined : dropState,
  };
  if (folded) {
    return (
      <section {...common} data-folded="">
        <FoldedStrip title={title} icon={icon} count={count} {...(foldHref ? { foldHref } : {})} {...(onFoldedChange ? { onFoldedChange } : {})} />
      </section>
    );
  }
  const Heading = `h${headingLevel}` as const;
  const labelId = headingId(id);
  const filled = hasCards(children);
  return (
    <section {...common}>
      <header className="itsm-KanbanColumn__head">
        <Icon name={icon} size="md" className="itsm-KanbanColumn__icon" />
        <Heading id={labelId} className="itsm-KanbanColumn__title">
          {title}
        </Heading>
        <Count value={count} className="itsm-KanbanColumn__count" />
        <span className="itsm-KanbanColumn__spacer" />
        {meta ? <span className="itsm-KanbanColumn__meta">{meta}</span> : null}
        {dropState === 'blocked' ? (
          <span className="itsm-KanbanColumn__blocked">
            <Icon name="ban" size="sm" />
            <span className="itsm-visually-hidden">Can't move here</span>
          </span>
        ) : null}
        {onFoldedChange ? (
          <button type="button" className="itsm-KanbanColumn__fold" aria-expanded={true} onClick={() => onFoldedChange(true)}>
            <Icon name="chevron-left" size="sm" directional />
            <span className="itsm-visually-hidden">{`Hide ${title}`}</span>
          </button>
        ) : null}
      </header>
      {sub ? <p className="itsm-KanbanColumn__sub">{sub}</p> : null}
      <div className="itsm-KanbanColumn__body">
        {filled ? (
          <ul className="itsm-KanbanColumn__cards" aria-labelledby={labelId}>
            {children}
          </ul>
        ) : empty ? (
          <p className="itsm-KanbanColumn__empty">{empty}</p>
        ) : null}
      </div>
    </section>
  );
}

/** The SLA state a card's stripe and progress hairline are drawn in. */
export type KanbanStripe = 'success' | 'warning' | 'danger' | 'neutral';

export interface KanbanCardProps extends Omit<HTMLAttributes<HTMLLIElement>, 'children' | 'title'> {
  /** The record: the title is its link, stretched over the card. */
  readonly href: string;
  /** "INC-000123", in the `id` style. */
  readonly refId: string;
  readonly title: string;
  /** `P1`–`P4`, drawn as a small `PriorityChip`. */
  readonly priority?: string;
  /** A category or service: "Hardware". */
  readonly tag?: string;
  /** Who has it; `null` is the dashed "Unassigned"; absent draws nobody. */
  readonly assignee?: { readonly name: string; readonly initials?: string } | null;
  /** When it is due, as written. `overdue` turns the chip red with a clock and says so; `done` turns it green. */
  readonly due?: { readonly label: string; readonly overdue?: boolean; readonly done?: boolean };
  /** The SLA state, as the 3 px stripe at the card's start edge. */
  readonly stripe?: KanbanStripe;
  /** Share of the SLA time used, 0–1: a 2 px hairline along the foot. */
  readonly progress?: number;
  /** Something new since the agent last looked: an accent dot, and "Unread" first in the link's name. */
  readonly unread?: boolean;
  readonly selected?: boolean;
  /** The drag ghost: drawn at 45 % opacity. Disabled states never use opacity. */
  readonly dragging?: boolean;
  /** The card's menu ("Move to ▸"): the board's keyboard and single-pointer path (WCAG 2.1.1, 2.5.7). */
  readonly menu?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLLIElement>;
}

/** 0–1, as a CSS length along the card's foot. */
function along(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  return `${Number((clamped * 100).toFixed(2))}%`;
}

/**
 * A board card (v3 §2.13, A1 §7.12): a list item for `KanbanColumn`'s list.
 * Server-safe and presentational; the board wraps it with drag and drop
 * through its `ref`.
 *
 * Top row: the reference in the `id` style, an unread dot, and the
 * priority chip. The title (500 13/18, two lines) is the card's link,
 * stretched over the card. Then the tag; then the foot with the assignee —
 * or the dashed "Unassigned" — and the due chip, which is red with a clock
 * and spoken ", overdue" when late and green when done. The SLA state is the
 * 3 px stripe at the start edge and the 2 px hairline of time used along the
 * foot; both are decoration over the words of the due chip, never the only
 * cue.
 */
export function KanbanCard({
  href,
  refId,
  title,
  priority,
  tag,
  assignee,
  due,
  stripe,
  progress,
  unread = false,
  selected = false,
  dragging = false,
  menu,
  className,
  ref,
  ...rest
}: KanbanCardProps): ReactNode {
  const dueState = due?.overdue ? 'late' : due?.done ? 'done' : undefined;
  const measured = progress !== undefined && Number.isFinite(progress);
  return (
    <li
      {...rest}
      ref={ref}
      className={cx('itsm-KanbanCard', className)}
      data-stripe={stripe}
      data-late={due?.overdue ? '' : undefined}
      data-selected={selected ? '' : undefined}
      data-dragging={dragging ? '' : undefined}
    >
      <div className="itsm-KanbanCard__top">
        <span className="itsm-KanbanCard__ref">{refId}</span>
        {unread ? <span className="itsm-KanbanCard__unread" aria-hidden="true" /> : null}
        <span className="itsm-KanbanCard__spacer" />
        {priority ? <PriorityChip priority={priority} size="sm" className="itsm-KanbanCard__priority" /> : null}
        {menu ? <span className="itsm-KanbanCard__menu">{menu}</span> : null}
      </div>
      <ShellLink href={href} className="itsm-KanbanCard__link">
        {unread ? <span className="itsm-visually-hidden">Unread: </span> : null}
        {title}
      </ShellLink>
      {tag ? <span className="itsm-KanbanCard__tag">{tag}</span> : null}
      {assignee !== undefined || due ? (
        <div className="itsm-KanbanCard__foot">
          {assignee === null ? (
            <span className="itsm-KanbanCard__assignee" data-unassigned="">
              <Avatar kind="unassigned" size="sm" decorative />
              {UNASSIGNED_LABEL}
            </span>
          ) : assignee ? (
            <span className="itsm-KanbanCard__assignee">
              <Avatar name={assignee.name} {...(assignee.initials ? { initials: assignee.initials } : {})} size="sm" decorative />
              {assignee.name}
            </span>
          ) : null}
          {due ? (
            <span className="itsm-KanbanCard__due" data-state={dueState}>
              <Icon name={due.overdue ? 'clock' : due.done ? 'circle-check' : 'calendar'} size={12} />
              {due.label}
              {due.overdue ? <span className="itsm-visually-hidden">, overdue</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {measured ? (
        <span className="itsm-KanbanCard__progress" aria-hidden="true">
          {/* Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6). */}
          <span className="itsm-KanbanCard__progressFill" style={{ inlineSize: along(progress) } as CSSProperties} />
        </span>
      ) : null}
    </li>
  );
}
