import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { ShellLink } from '../shell/ShellLink.js';
import type { ActionSpec, EmptySpec, IconName, Tone } from '../types.js';
import { Avatar, UNASSIGNED_LABEL } from '../web/Avatar.js';
import { cx } from '../web/cx.js';
import { EmptyState } from '../web/EmptyState.js';
import { AttentionRowActions } from './AttentionRowActions.js';
import { Count } from './Count.js';
import { StatusPill } from './StatusPill.js';

/** How loudly a row asks: its icon and that icon's colour. */
export type AttentionSeverity = 'danger' | 'warning' | 'info' | 'neutral';

/** One thing that needs somebody: a breached ticket, an approval waiting, a reply nobody has read. */
export interface AttentionItem {
  readonly id: string;
  /** Draws a circled "!", a triangle, an "i" or a dot, in the matching intent's text colour. */
  readonly severity: AttentionSeverity;
  /** The record's reference, "INC-000123", in the `id` style. */
  readonly ref?: string;
  readonly title: string;
  /** Where the row goes: the title is its link, and the whole row answers to it. */
  readonly href: string;
  /** Why it is here: "Breaches in 43 min", "Reopened", "VIP". A `tone` draws it as a status pill. */
  readonly reason?: { readonly label: string; readonly tone?: Tone };
  /** Who has it. `null` is nobody — the dashed avatar and "Unassigned"; absent leaves the cell empty. */
  readonly owner?: { readonly name: string; readonly initials?: string } | null;
  /** When it is due, as written ("Today 16:00"); `at` is the instant, for `<time>`. Overdue rows add the slip ("+4d"). */
  readonly due?: { readonly label: string; readonly at?: string; readonly overdue?: boolean; readonly slip?: string };
  /** A second line, shown when the list is too narrow for its columns: "Hardware · Alex Morgan". */
  readonly meta?: string;
}

/** A filter of the list as a pill tab with its count: "Breached 3". */
export interface AttentionTab {
  readonly id: string;
  readonly label: string;
  /** `null` or absent draws no count (not counted is never drawn as 0). */
  readonly count?: number | null;
  readonly href: string;
  readonly current?: boolean;
}

export interface AttentionListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** What the list is, for a screen reader: "Needs you". The card around it shows it as its title. */
  readonly label: string;
  readonly items: readonly AttentionItem[];
  readonly tabs?: readonly AttentionTab[];
  /** Rows drawn before the rest are left to `moreHref`. */
  readonly max?: number;
  /** The full list. Drawn as a "Show all" link under the rows. */
  readonly moreHref?: string;
  /** The words of that link; "Show all" by default. */
  readonly moreLabel?: string;
  /** What an empty list says. Good news by default: an empty attention list means nothing is waiting. */
  readonly empty?: EmptySpec;
  /** The empty state's heading level: 3 (default) under a card title, 4 under a section's. */
  readonly headingLevel?: 2 | 3 | 4;
  /**
   * Quick actions on each row — "Assign to me", "Open" — revealed on hover
   * and focus, always shown on a touch screen. As data, so a server component
   * can pass link actions; the row's own client island draws them.
   */
  readonly rowActions?: readonly ActionSpec[];
  /** Client only: receives an action without `href` and the row it was chosen on. */
  readonly onAction?: (actionId: string, item: AttentionItem) => void;
  /** For the counts' digits; `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

const SEVERITY_ICON: Readonly<Record<AttentionSeverity, IconName>> = {
  danger: 'circle-alert',
  warning: 'triangle-alert',
  info: 'info',
  neutral: 'dot',
};

const DEFAULT_EMPTY: EmptySpec = { title: 'Nothing needs attention right now' };

function Tabs({ label, tabs, locale }: { readonly label: string; readonly tabs: readonly AttentionTab[]; readonly locale: string }): ReactNode {
  return (
    <nav className="itsm-AttentionList__tabs" aria-label={`${label}: filters`}>
      <ul className="itsm-AttentionList__tabList">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <ShellLink href={tab.href} className="itsm-AttentionList__tab" {...(tab.current ? { 'aria-current': 'page' as const } : {})}>
              {tab.label}
              <Count value={tab.count ?? null} size="sm" tone={tab.current ? 'accent' : 'neutral'} locale={locale} />
            </ShellLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Reason({ reason }: { readonly reason: NonNullable<AttentionItem['reason']> }): ReactNode {
  if (reason.tone) return <StatusPill label={reason.label} tone={reason.tone} size="sm" />;
  return <span className="itsm-AttentionList__chip">{reason.label}</span>;
}

function Owner({ owner }: { readonly owner: AttentionItem['owner'] }): ReactNode {
  if (owner === undefined) return null;
  if (owner === null) {
    return (
      <>
        <Avatar kind="unassigned" size="sm" decorative />
        <span className="itsm-AttentionList__ownerName" data-unassigned="">
          {UNASSIGNED_LABEL}
        </span>
      </>
    );
  }
  return (
    <>
      <Avatar name={owner.name} {...(owner.initials ? { initials: owner.initials } : {})} size="sm" decorative />
      <span className="itsm-AttentionList__ownerName">{owner.name}</span>
    </>
  );
}

function Due({ due }: { readonly due: NonNullable<AttentionItem['due']> }): ReactNode {
  return (
    <>
      {due.at ? <time dateTime={due.at}>{due.label}</time> : due.label}
      {due.overdue && due.slip ? <span className="itsm-AttentionList__slip">{due.slip}</span> : null}
      {due.overdue ? <span className="itsm-visually-hidden">, overdue</span> : null}
    </>
  );
}

/**
 * "Needs attention" rows (v3 §2.13, A1 §7.4): the dashboards' list of the
 * few things somebody should act on now, each one line of severity,
 * reference, title, reason, owner and due time. Server-safe; the quick
 * actions are a client island per row (`AttentionRowActions`), mounted only
 * when the list has `rowActions`.
 *
 * Each row is a list item whose title is a link stretched over the whole
 * row, so the row is one target and one tab stop, and a screen reader meets
 * the row's facts in reading order. The columns line up across rows (the
 * rows are subgrids of the list), and the list adapts to its container, not
 * the viewport: under 38.75rem the owners' names go (the avatars stay, and
 * the names stay readable by screen readers); under 30rem each row folds to
 * two lines.
 *
 * An unassigned row says "Unassigned" beside a dashed avatar in muted text —
 * nobody owning something is information, not an alarm, so it is never
 * amber (D5). An overdue due time is danger red with its slip ("+4d") and is
 * spoken ", overdue". The tabs are links with counts; the current one has
 * `aria-current`.
 */
export function AttentionList({
  label,
  items,
  tabs,
  max,
  moreHref,
  moreLabel = 'Show all',
  empty = DEFAULT_EMPTY,
  headingLevel = 3,
  rowActions,
  onAction,
  locale = 'en-GB',
  className,
  ref,
  ...rest
}: AttentionListProps): ReactNode {
  const shown = max !== undefined && Number.isFinite(max) ? items.slice(0, Math.max(0, Math.floor(max))) : items;
  const actions = rowActions && rowActions.length > 0 ? rowActions : null;
  return (
    <div {...rest} ref={ref} className={cx('itsm-AttentionList', className)}>
      {tabs && tabs.length > 0 ? <Tabs label={label} tabs={tabs} locale={locale} /> : null}
      {shown.length === 0 ? (
        <EmptyState
          className="itsm-AttentionList__empty"
          size="sm"
          tone="success"
          headingLevel={headingLevel}
          title={empty.title}
          {...(empty.description ? { description: empty.description } : {})}
          {...(empty.icon ? { icon: empty.icon } : {})}
          {...(empty.action ? { action: empty.action } : {})}
          {...(empty.secondaryAction ? { secondaryAction: empty.secondaryAction } : {})}
        />
      ) : (
        <ul className="itsm-AttentionList__rows" aria-label={label}>
          {shown.map((item) => (
            <li key={item.id} className="itsm-AttentionList__row" data-severity={item.severity} data-overdue={item.due?.overdue ? '' : undefined}>
              <Icon name={SEVERITY_ICON[item.severity]} size="sm" className="itsm-AttentionList__severity" />
              <span className="itsm-AttentionList__ref">{item.ref ?? null}</span>
              <span className="itsm-AttentionList__main">
                <ShellLink href={item.href} className="itsm-AttentionList__link">
                  {item.title}
                </ShellLink>
                {item.meta ? <span className="itsm-AttentionList__meta">{item.meta}</span> : null}
              </span>
              <span className="itsm-AttentionList__reason">{item.reason ? <Reason reason={item.reason} /> : null}</span>
              <span className="itsm-AttentionList__owner">
                <Owner owner={item.owner} />
              </span>
              <span className="itsm-AttentionList__due">{item.due ? <Due due={item.due} /> : null}</span>
              {actions ? <AttentionRowActions actions={actions} item={item} onAction={onAction} /> : null}
            </li>
          ))}
        </ul>
      )}
      {moreHref ? (
        <ShellLink href={moreHref} className="itsm-AttentionList__more">
          {moreLabel}
          <Icon name="arrow-right" size={14} directional />
        </ShellLink>
      ) : null}
    </div>
  );
}
