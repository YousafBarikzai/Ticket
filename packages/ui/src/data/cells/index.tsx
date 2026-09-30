import type { ReactNode } from 'react';
import { describeTrend } from '../../charts/scale.js';
import { Sparkline } from '../../charts/Sparkline.js';
import { AvatarStack } from '../../display/AvatarStack.js';
import { channelInfo } from '../../display/channel.js';
import { StatusPill } from '../../display/StatusPill.js';
import { formatDuration } from '../../format/duration.js';
import { formatDateTime, formatNumber, formatPercent } from '../../format/format.js';
import { RelativeTime } from '../../format/RelativeTime.js';
import { Icon } from '../../icons/Icon.js';
import type { IconName, LinkComponent, Tone } from '../../types.js';
import { Avatar } from '../../web/Avatar.js';
import { Badge } from '../../web/Badge.js';
import { SlaClock, type SlaState } from '../../workbench/SlaClock.js';
import { fillTemplate, isBlank, personName, textOf, valueAt } from '../model.js';
import type { CellKind, ColumnSpec } from '../types.js';
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

/** Priority tones when a column gives no map: only the two that need attention are coloured. */
const PRIORITY_TONES: Readonly<Record<string, Tone>> = { P1: 'danger', P2: 'warning', P3: 'neutral', P4: 'neutral' };

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

function withSecondary(main: ReactNode, column: ColumnSpec, row: unknown): ReactNode {
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

function time(value: unknown, column: ColumnSpec, context: CellContext, kind: 'date' | 'datetime'): ReactNode {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
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
  return <TimeCell iso={iso} text={text} full={formatDateTime(iso, { locale: context.locale, timeZone: context.timeZone, style: 'full' })} />;
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

function mapped(column: ColumnSpec, value: unknown): { label: string; tone?: Tone; icon?: IconName } {
  const key = scalar(value);
  const entry = column.map?.[key];
  return entry ?? { label: textOf(column, value) || key };
}

/**
 * A cell's content. The primary column gets its words only: the table wraps
 * them in the row's link or button, and a link inside a link is the nesting
 * X-62 forbids.
 */
export function renderCell(column: ColumnSpec, row: unknown, context: CellContext, placement: CellPlacement = {}): ReactNode {
  const value = valueAt(row, column.field);
  if (isBlank(value) && column.kind !== 'boolean') return <EmptyCell column={column} notSet={context.notSet} />;
  const kind: CellKind = column.kind ?? 'text';
  const numberFormat = column.format && !('unit' in column.format) ? (column.format as Intl.NumberFormatOptions) : undefined;

  switch (kind) {
    case 'title':
      return withSecondary(<span className="itsm-DataTable__titleText">{textOf(column, value)}</span>, column, row);

    case 'mono':
      return <code className="itsm-DataTable__mono">{textOf(column, value)}</code>;

    case 'number':
    case 'currency': {
      const number = toNumber(value);
      if (number === null) return textOf(column, value);
      if (kind === 'currency' && !numberFormat?.currency) return formatNumber(number, { locale: context.locale, ...numberFormat });
      return formatNumber(number, { locale: context.locale, ...numberFormat, ...(kind === 'currency' ? { style: 'currency' as const } : {}) });
    }

    case 'percent': {
      const number = toNumber(value);
      return number === null ? textOf(column, value) : formatPercent(number, { locale: context.locale, ...numberFormat });
    }

    case 'date':
    case 'datetime':
      return time(value, column, context, kind);

    case 'relative':
      return <RelativeTime date={value instanceof Date ? value.toISOString() : String(value)} />;

    case 'duration': {
      const minutes = toNumber(value);
      return minutes === null ? textOf(column, value) : formatDuration(minutes, { locale: context.locale });
    }

    case 'status': {
      const state = mapped(column, value);
      return <StatusPill size="sm" label={state.label} tone={state.tone ?? 'neutral'} icon={state.icon ?? 'auto'} {...(column.srPrefix ? { srPrefix: column.srPrefix } : {})} />;
    }

    case 'badge':
    case 'priority': {
      const state = mapped(column, value);
      const tone = state.tone ?? (kind === 'priority' ? (PRIORITY_TONES[scalar(value).toUpperCase()] ?? 'neutral') : 'neutral');
      const srPrefix = column.srPrefix ?? (kind === 'priority' ? 'Priority' : undefined);
      return (
        <Badge size="sm" tone={tone} {...(state.icon ? { icon: state.icon } : {})} {...(srPrefix ? { srPrefix } : {})}>
          {state.label}
        </Badge>
      );
    }

    case 'person': {
      const name = personName(value);
      const initials = typeof value === 'object' && value ? (value as { initials?: unknown }).initials : undefined;
      const person = (
        <span className="itsm-DataTable__person">
          <Avatar name={name} size="xs" decorative {...(typeof initials === 'string' ? { initials } : {})} />
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
      const text = textOf(column, value);
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
      if (ratio === null) return textOf(column, value);
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
      if (typeof value !== 'object' || value === null) return textOf(column, value);
      const clock = value as { state?: SlaState; remainingMinutes?: number | null; dueAt?: string; targetType?: string };
      if (!clock.state) return <EmptyCell column={column} notSet={context.notSet} />;
      return (
        <SlaClock
          targetType={clock.targetType ?? 'resolution'}
          state={clock.state}
          remainingMinutes={clock.remainingMinutes ?? null}
          {...(clock.dueAt ? { dueAt: clock.dueAt } : {})}
        />
      );
    }

    case 'text':
    default:
      return withSecondary(<span className="itsm-DataTable__text">{textOf(column, value)}</span>, column, row);
  }
}
