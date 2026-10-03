import type { ReactNode } from 'react';
import { describeTrend } from '../../charts/scale.js';
import { Sparkline } from '../../charts/Sparkline.js';
import { AvatarStack } from '../../display/AvatarStack.js';
import { channelInfo } from '../../display/channel.js';
import { PriorityChip } from '../../display/PriorityChip.js';
import { StatusPill } from '../../display/StatusPill.js';
import { priorityLook, TICKET_STATE_LOOK, ticketStateLook, ticketTypeLook } from '../../display/ticket-states.js';
import { formatDuration } from '../../format/duration.js';
import { formatDateTime, formatNumber, formatPercent } from '../../format/format.js';
import { RelativeTime } from '../../format/RelativeTime.js';
import { Icon } from '../../icons/Icon.js';
import type { IconName, LinkComponent, Tone } from '../../types.js';
import { Avatar } from '../../web/Avatar.js';
import { Badge } from '../../web/Badge.js';
import type { SlaState } from '../../workbench/SlaClock.js';
import { fillTemplate, isBlank, personName, textOf, valueAt } from '../model.js';
import type { CellKind, ColumnSpec } from '../types.js';
import { DueCell } from './DueCell.js';
import { SlaCell } from './SlaCell.js';
import { TimeCell } from './TimeCell.js';

/**
 * The cell registry: how each `CellKind` draws a value. Plain data in, markup
 * out — a server page describes a column as `{ kind: 'status', map }` and the
 * table draws a `StatusPill` from it, so no render function ever has to cross
 * from server to client (SPEC §3.6 rule 3).
 *
 * Hook-free on purpose: the table calls these while it renders, with the
 * locale, zone and words it read from the provider once.
 */

/**
 * The cell kinds a `DataTable` draws: the serialisable `CellKind`s and the
 * two v3 adds (§2.14). `due` is a date that turns red with its slip ("+4d")
 * once it has passed on a row still open; `type` is a ticket type's chip
 * (`TYPE_LOOK`: a sunken chip, a muted glyph, the type's name). Both are
 * plain data, like every kind, so a server page can ask for them.
 */
export type DataCellKind = CellKind | 'due' | 'type';

/**
 * When a `due` date that has passed counts as late: the row's `field` is not
 * one of `notIn` (`{ field: 'statusCategory', notIn: ['resolved', 'closed'] }`),
 * or is one of `in`. Without a rule every past date is late.
 */
export interface OverdueRule {
  readonly field: string;
  readonly notIn?: readonly string[];
  readonly in?: readonly string[];
}

/**
 * A column of a `DataTable`: a `ColumnSpec`, with the v3 kinds and, for
 * `due`, the rule that says when a past date is late.
 */
export interface DataTableColumn extends Omit<ColumnSpec, 'kind'> {
  readonly kind?: DataCellKind;
  /** `due` only. */
  readonly overdueWhen?: OverdueRule;
}

/** The ticket types' words, tones and glyphs as a column map, so a `type` column searches and sorts by its words. */
const TYPE_MAP: NonNullable<ColumnSpec['map']> = Object.freeze(
  Object.fromEntries(
    (['incident', 'request', 'question', 'problem', 'change', 'task'] as const).map((key) => {
      const look = ticketTypeLook(key);
      return [key, { label: look.label, tone: look.tone, icon: look.icon }];
    }),
  ),
);

/**
 * The column as the table's model sees it — sorting, alignment, search, the
 * View menu: a `due` date is a `date`, a `type` a `badge` with the types'
 * words. Only the cell itself draws the difference. A column of a v2 kind
 * comes back as it is, so its identity (and every memo keyed on it) holds.
 */
export function modelColumn(column: DataTableColumn): ColumnSpec {
  const { kind, overdueWhen: _overdueWhen, ...rest } = column;
  if (kind === 'due') return { ...rest, kind: 'date' };
  if (kind === 'type') return { ...rest, kind: 'badge', map: column.map ?? TYPE_MAP };
  return column as ColumnSpec;
}

/** Whether a row's past `due` date is late under the column's rule. */
export function isOpenFor(rule: OverdueRule | undefined, row: unknown): boolean {
  if (!rule) return true;
  const value = valueAt(row, rule.field);
  const key = isBlank(value) ? '' : scalar(value);
  if (rule.in && !rule.in.includes(key)) return false;
  if (rule.notIn && rule.notIn.includes(key)) return false;
  return true;
}

export interface CellContext {
  readonly locale: string;
  readonly timeZone: string;
  /** Spoken for an empty cell: "Not set". */
  readonly notSet: string;
  /** The application's link, or `null` outside a provider (a plain anchor). */
  readonly Link: LinkComponent | null;
}

/** Where the cell is drawn: in the primary control (text only — the control is the link) or as a cell of its own. */
export interface CellPlacement {
  readonly primary?: boolean;
}

function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith('mailto:');
}

function scalar(value: unknown): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.id ?? record.value ?? record.key ?? record.name ?? '');
  }
  return String(value);
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The dash an empty cell shows, with "Not set" for a screen reader — or the column's own word ("Unassigned"). */
export function EmptyCell({ column, notSet }: { readonly column: Pick<ColumnSpec, 'empty'>; readonly notSet: string }): ReactNode {
  if (column.empty && column.empty !== '—') return <span className="itsm-DataTable__empty">{column.empty}</span>;
  return (
    <span className="itsm-DataTable__empty">
      <span aria-hidden="true">—</span>
      <span className="itsm-visually-hidden">{notSet}</span>
    </span>
  );
}

function withSecondary(main: ReactNode, column: Pick<ColumnSpec, 'secondaryField'>, row: unknown): ReactNode {
  if (!column.secondaryField) return main;
  const secondary = valueAt(row, column.secondaryField);
  if (isBlank(secondary)) return main;
  return (
    <span className="itsm-DataTable__stack">
      {main}
      <span className="itsm-DataTable__secondary">{typeof secondary === 'object' ? personName(secondary) : String(secondary)}</span>
    </span>
  );
}

/** A moment's `<time>` text in the column's form, its full spelling, and its ISO string; `null` when it is not a moment. */
function moment(value: unknown, column: Pick<ColumnSpec, 'format'>, context: CellContext, kind: 'date' | 'datetime'): { iso: string; text: string; full: string } | null {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let text: string;
  const options = column.format as Intl.DateTimeFormatOptions | undefined;
  if (options && !('unit' in options) && Object.keys(options).length > 0) {
    try {
      text = new Intl.DateTimeFormat(context.locale, { ...options, timeZone: context.timeZone }).format(date);
    } catch {
      text = formatDateTime(iso, { locale: context.locale, timeZone: context.timeZone, style: kind });
    }
  } else {
    text = formatDateTime(iso, { locale: context.locale, timeZone: context.timeZone, style: kind });
  }
  return { iso, text, full: formatDateTime(iso, { locale: context.locale, timeZone: context.timeZone, style: 'full' }) };
}

function time(value: unknown, column: Pick<ColumnSpec, 'format'>, context: CellContext, kind: 'date' | 'datetime'): ReactNode {
  const at = moment(value, column, context, kind);
  if (!at) return value instanceof Date ? value.toISOString() : String(value);
  return <TimeCell iso={at.iso} text={at.text} full={at.full} />;
}

/** A link drawn inside a cell that is not the row's primary control. */
function CellLink({ href, children, Link }: { readonly href: string; readonly children: ReactNode; readonly Link: LinkComponent | null }): ReactNode {
  if (isExternal(href)) {
    return (
      <a className="itsm-DataTable__link" href={href} target="_blank" rel="noreferrer noopener">
        {children}
        <Icon name="external" size="xs" className="itsm-DataTable__linkIcon" />
        <span className="itsm-visually-hidden"> (opens in a new tab)</span>
      </a>
    );
  }
  if (Link) {
    return (
      <Link className="itsm-DataTable__link" href={href} prefetch={false}>
        {children}
      </Link>
    );
  }
  return (
    <a className="itsm-DataTable__link" href={href}>
      {children}
    </a>
  );
}

function mapped(column: Pick<ColumnSpec, 'kind' | 'map'>, value: unknown): { label: string; tone?: Tone; icon?: IconName } {
  const key = scalar(value);
  const entry = column.map?.[key];
  return entry ?? { label: textOf(column, value) || key };
}

/**
 * A cell's content. The primary column gets its words only: the table wraps
 * them in the row's link or button, and a link inside a link is the nesting
 * X-62 forbids.
 */
export function renderCell(column: DataTableColumn, row: unknown, context: CellContext, placement: CellPlacement = {}): ReactNode {
  const value = valueAt(row, column.field);
  const kind: DataCellKind = column.kind ?? 'text';
  /** The column as the model reads it: what words a value has, in a v2 kind. */
  const model = modelColumn(column);
  // Nobody in a person column that has a word for it ("Unassigned"): the dashed avatar beside the word.
  if (isBlank(value) && kind === 'person' && column.empty && column.empty !== '—' && !placement.primary) {
    return (
      <span className="itsm-DataTable__person" data-nobody="">
        <Avatar kind="unassigned" size="sm" decorative />
        <span className="itsm-DataTable__empty">{column.empty}</span>
      </span>
    );
  }
  if (isBlank(value) && kind !== 'boolean') return <EmptyCell column={column} notSet={context.notSet} />;
  const numberFormat = column.format && !('unit' in column.format) ? (column.format as Intl.NumberFormatOptions) : undefined;

  switch (kind) {
    case 'title':
      return withSecondary(<span className="itsm-DataTable__titleText">{textOf(model, value)}</span>, column, row);

    case 'mono':
      return <code className="itsm-DataTable__mono">{textOf(model, value)}</code>;

    case 'number':
    case 'currency': {
      const number = toNumber(value);
      if (number === null) return textOf(model, value);
      if (kind === 'currency' && !numberFormat?.currency) return formatNumber(number, { locale: context.locale, ...numberFormat });
      return formatNumber(number, { locale: context.locale, ...numberFormat, ...(kind === 'currency' ? { style: 'currency' as const } : {}) });
    }

    case 'percent': {
      const number = toNumber(value);
      return number === null ? textOf(model, value) : formatPercent(number, { locale: context.locale, ...numberFormat });
    }

    case 'date':
    case 'datetime':
      return time(value, column, context, kind);

    case 'relative':
      return <RelativeTime date={value instanceof Date ? value.toISOString() : String(value)} />;

    case 'duration': {
      const minutes = toNumber(value);
      return minutes === null ? textOf(model, value) : formatDuration(minutes, { locale: context.locale });
    }

    case 'status': {
      // The column's own words win; a canonical ticket state without them takes its D5 look.
      const key = scalar(value);
      const state = column.map?.[key] ?? (Object.prototype.hasOwnProperty.call(TICKET_STATE_LOOK, key) ? ticketStateLook(key) : mapped(model, value));
      return <StatusPill size="sm" label={state.label} tone={state.tone ?? 'neutral'} icon={state.icon ?? 'auto'} {...(column.srPrefix ? { srPrefix: column.srPrefix } : {})} />;
    }

    case 'priority': {
      // P1–P4 are the signal-bar chip (v3 §2.14); a column that maps its values keeps its own words.
      const code = scalar(value).toUpperCase();
      if (!column.map?.[scalar(value)] && priorityLook(code)) {
        return <PriorityChip priority={code} size="sm" srPrefix={column.srPrefix ?? 'Priority'} />;
      }
      const state = mapped(model, value);
      return (
        <Badge size="sm" tone={state.tone ?? 'neutral'} {...(state.icon ? { icon: state.icon } : {})} srPrefix={column.srPrefix ?? 'Priority'}>
          {state.label}
        </Badge>
      );
    }

    case 'badge': {
      const state = mapped(model, value);
      return (
        <Badge size="sm" tone={state.tone ?? 'neutral'} {...(state.icon ? { icon: state.icon } : {})} {...(column.srPrefix ? { srPrefix: column.srPrefix } : {})}>
          {state.label}
        </Badge>
      );
    }

    case 'type': {
      const key = scalar(value);
      const entry = column.map?.[key];
      const look = ticketTypeLook(key);
      return (
        <span className="itsm-DataTable__type">
          <Icon name={entry?.icon ?? look.icon} size={12} className="itsm-DataTable__typeIcon" />
          {entry?.label ?? look.label}
        </span>
      );
    }

    case 'due': {
      const at = moment(value, column, context, column.format && 'hour' in column.format ? 'datetime' : 'date');
      if (!at) return textOf(model, value);
      return <DueCell iso={at.iso} text={at.text} full={at.full} open={isOpenFor(column.overdueWhen, row)} locale={context.locale} />;
    }

    case 'person': {
      const name = personName(value);
      const initials = typeof value === 'object' && value ? (value as { initials?: unknown }).initials : undefined;
      const person = (
        <span className="itsm-DataTable__person">
          <Avatar name={name} size="sm" decorative {...(typeof initials === 'string' ? { initials } : {})} />
          <span className="itsm-DataTable__personName">{name}</span>
        </span>
      );
      return withSecondary(person, column, row);
    }

    case 'people': {
      const people = (Array.isArray(value) ? value : [value]).map((person) => ({ name: personName(person) })).filter((person) => person.name);
      return <AvatarStack people={people} size="xs" label={column.header} locale={context.locale} />;
    }

    case 'tags': {
      const tags = (Array.isArray(value) ? value : [value]).map((tag) => textOf({ ...column, kind: 'text' }, tag)).filter(Boolean);
      const shown = tags.slice(0, 3);
      return (
        <span className="itsm-DataTable__tags">
          {shown.map((tag) => (
            <Badge key={tag} size="sm" emphasis="outline">
              {tag}
            </Badge>
          ))}
          {tags.length > shown.length ? (
            <span className="itsm-DataTable__more">
              +{tags.length - shown.length}
              <span className="itsm-visually-hidden"> more: {tags.slice(3).join(', ')}</span>
            </span>
          ) : null}
        </span>
      );
    }

    case 'boolean': {
      if (isBlank(value)) return <EmptyCell column={column} notSet={context.notSet} />;
      const truthy = value === true || value === 'true';
      const label = column.map?.[truthy ? 'true' : 'false']?.label ?? (truthy ? 'Yes' : 'No');
      return (
        <span className="itsm-DataTable__boolean" data-value={truthy ? 'true' : 'false'}>
          {truthy ? <Icon name="check" size="sm" /> : null}
          {label}
        </span>
      );
    }

    case 'link': {
      const text = textOf(model, value);
      if (placement.primary) return text;
      const href = column.href ? fillTemplate(column.href, row) : typeof value === 'string' ? value : undefined;
      return href ? (
        <CellLink href={href} Link={context.Link}>
          {text}
        </CellLink>
      ) : (
        text
      );
    }

    case 'progress': {
      let ratio = toNumber(value);
      if (ratio === null) return textOf(model, value);
      if (ratio > 1) ratio /= 100;
      ratio = Math.max(0, Math.min(1, ratio));
      return (
        <span className="itsm-DataTable__progress">
          <span className="itsm-DataTable__progressTrack" aria-hidden="true">
            <span className="itsm-DataTable__progressFill" style={{ inlineSize: `${ratio * 100}%` }} />
          </span>
          <span className="itsm-DataTable__progressValue">{formatPercent(ratio, { locale: context.locale })}</span>
        </span>
      );
    }

    case 'sparkline': {
      const values = (Array.isArray(value) ? value : []).filter((item): item is number => typeof item === 'number');
      if (values.length === 0) return <EmptyCell column={column} notSet={context.notSet} />;
      return <Sparkline values={values} label={`${column.header}: ${describeTrend(values, (n) => formatNumber(n, { locale: context.locale }))}`} width={72} height={24} />;
    }

    case 'channel': {
      const key = scalar(value);
      const info = column.map?.[key] ? { label: column.map[key]!.label, icon: column.map[key]!.icon ?? channelInfo(key).icon } : channelInfo(key);
      return (
        <span className="itsm-DataTable__channel">
          <Icon name={info.icon} size="sm" />
          {info.label}
        </span>
      );
    }

    case 'sla': {
      if (typeof value !== 'object' || value === null) return textOf(model, value);
      const clock = value as { state?: SlaState; remainingMinutes?: number | null; dueAt?: string };
      if (!clock.state) return <EmptyCell column={column} notSet={context.notSet} />;
      return (
        <SlaCell
          state={clock.state}
          remainingMinutes={clock.remainingMinutes ?? null}
          locale={context.locale}
          {...(clock.dueAt ? { dueAt: clock.dueAt } : {})}
          {...(column.srPrefix ? { srPrefix: column.srPrefix } : {})}
        />
      );
    }

    case 'text':
    default:
      return withSecondary(<span className="itsm-DataTable__text">{textOf(model, value)}</span>, column, row);
  }
}
