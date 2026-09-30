'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { RelativeTime } from '../format/RelativeTime.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { useNow } from '../provider/clock.js';
import type { EmptySpec, IconName, Tone } from '../types.js';
import { Avatar } from '../web/Avatar.js';
import { cx } from '../web/cx.js';
import { EmptyState } from '../web/EmptyState.js';
import { channelInfo } from './channel.js';
import { dayHeading, dayKey } from './dates.js';

export interface ActivityActor {
  readonly name: string;
  readonly kind?: 'person' | 'system' | 'ai' | 'channel';
  readonly initials?: string;
}

/** One thing that happened: "Jo changed Status from New to In progress". */
export interface ActivityItem {
  readonly id: string;
  /** ISO 8601. */
  readonly at: string;
  readonly actor?: ActivityActor;
  /** The predicate, lower case: "changed the status of", "published". */
  readonly verb: string;
  /** What it happened to; linked when it has an `href`. */
  readonly object?: { readonly label: string; readonly href?: string };
  /** A change's old and new values, drawn as "New → In progress". */
  readonly from?: string;
  readonly to?: string;
  /** A quoted line under the sentence: a reason, a comment excerpt. */
  readonly detail?: string;
  /** How it arrived ("email"), shown as a glyph and a word. */
  readonly channel?: string;
  /** The marker's glyph where there is no person to show. */
  readonly icon?: IconName;
  /** Tints the marker: a failure in danger, a publish in success. */
  readonly tone?: Tone;
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Names the list: "Recent activity". */
  readonly label: string;
  readonly items: readonly ActivityItem[];
  /** `day` (default) puts the items under day headings in the reader's time zone. */
  readonly groupBy?: 'day' | 'none';
  /** Shows the first `max` items; pair with `viewAllHref`. */
  readonly max?: number;
  readonly viewAllHref?: string;
  /** "View all activity" by default. */
  readonly viewAllLabel?: string;
  /** Shown when there are no items. "No activity yet" by default. */
  readonly empty?: EmptySpec;
  /** Items that arrived since render, held behind "N new · Show" so the list never shifts under the reader. */
  readonly newCount?: number;
  /** Client only. Called by "Show"; the parent then passes the new items and a `newCount` of 0. */
  readonly onShowNew?: () => void;
  /** The level of the day headings (and of the empty state's title). 3 by default: a feed usually sits in a card titled with an `h2`. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

function markerGlyph(item: ActivityItem): IconName {
  if (item.icon) return item.icon;
  if (item.actor?.kind === 'ai') return 'sparkles';
  if (item.actor?.kind === 'system') return 'bot';
  if (item.actor?.kind === 'channel') return item.channel ? channelInfo(item.channel).icon : 'message-square';
  return 'history';
}

function Change({ from, to }: { readonly from: string | undefined; readonly to: string | undefined }): ReactNode {
  if (!from && !to) return null;
  return (
    <span className="itsm-ActivityFeed__change">
      {from ? (
        <>
          <span className="itsm-visually-hidden">from </span>
          <span className="itsm-ActivityFeed__value">{from}</span>
        </>
      ) : null}
      {from && to ? <Icon name="arrow-right" size="xs" className="itsm-ActivityFeed__arrow" directional /> : null}
      {to ? (
        <>
          <span className="itsm-visually-hidden">{from ? ' to ' : 'to '}</span>
          <span className="itsm-ActivityFeed__value">{to}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * A feed of what happened — the command centre's recent activity, a channel's
 * log, the portal's latest updates — grouped under day headings.
 *
 * Each item is a sentence ("**Jo** published *VIP requester*"), with a
 * change drawn as two values and an arrow that a screen reader hears as
 * "from New to In progress", an optional quoted detail, and a meta line with
 * the time (absolute on the server, relative once hydrated, so the HTML and
 * the first client render agree) and the channel as a glyph and a word. The
 * marker is the person's avatar, or a glyph for automation, tinted by tone.
 *
 * Live updates never move what the reader is looking at: new items wait
 * behind "3 new · Show", announced once, politely. Choosing Show hands the
 * parent the job of inserting them; focus then moves to the list rather than
 * falling back to the top of the page with the vanished button.
 */
export function ActivityFeed({
  label,
  items,
  groupBy = 'day',
  max,
  viewAllHref,
  viewAllLabel = 'View all activity',
  empty,
  newCount = 0,
  onShowNew,
  headingLevel = 3,
  className,
  ref,
  ...rest
}: ActivityFeedProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = itsm?.locale ?? 'en-GB';
  const timeZone = itsm?.timeZone ?? 'UTC';
  const Link = itsm?.Link;
  const now = useNow();
  const listRef = useRef<HTMLOListElement | null>(null);
  const showing = useRef(false);

  useEffect(() => {
    if (!showing.current || newCount > 0) return;
    showing.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) listRef.current?.focus();
  }, [newCount]);

  const visible = typeof max === 'number' && max >= 0 ? items.slice(0, Math.floor(max)) : items;
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const pending = Math.max(0, Math.floor(newCount));
  const noun = pending === 1 ? 'update' : 'updates';

  const renderItem = (item: ActivityItem): ReactNode => {
    const person = item.actor && (item.actor.kind ?? 'person') === 'person';
    const channel = item.channel ? channelInfo(item.channel) : null;
    return (
      <li key={item.id} className="itsm-ActivityFeed__item" data-tone={item.tone}>
        <span className="itsm-ActivityFeed__marker" aria-hidden="true">
          {person && item.actor ? (
            <Avatar
              name={item.actor.name}
              {...(item.actor.initials ? { initials: item.actor.initials } : {})}
              size="sm"
              decorative
            />
          ) : (
            <span className="itsm-ActivityFeed__glyph">
              <Icon name={markerGlyph(item)} size="xs" />
            </span>
          )}
        </span>
        <div className="itsm-ActivityFeed__content">
          <p className="itsm-ActivityFeed__sentence">
            {item.actor ? <span className="itsm-ActivityFeed__actor">{item.actor.name}</span> : null}
            {item.actor ? ' ' : null}
            {item.verb}
            {item.object ? ' ' : null}
            {item.object ? (
              item.object.href ? (
                Link ? (
                  <Link href={item.object.href} className="itsm-ActivityFeed__object">
                    {item.object.label}
                  </Link>
                ) : (
                  <a href={item.object.href} className="itsm-ActivityFeed__object">
                    {item.object.label}
                  </a>
                )
              ) : (
                <span className="itsm-ActivityFeed__object">{item.object.label}</span>
              )
            ) : null}
            {item.from || item.to ? ' ' : null}
            <Change from={item.from} to={item.to} />
          </p>
          {item.detail ? <p className="itsm-ActivityFeed__detail">{item.detail}</p> : null}
          <p className="itsm-ActivityFeed__meta">
            <RelativeTime date={item.at} />
            {channel ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="itsm-ActivityFeed__channel">
                  <Icon name={channel.icon} size="xs" />
                  <span className="itsm-visually-hidden">, by </span>
                  {channel.label}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </li>
    );
  };

  let list: ReactNode;
  if (visible.length === 0) {
    list = (
      <EmptyState size="sm" headingLevel={headingLevel} {...(empty ?? { title: 'No activity yet' })} className="itsm-ActivityFeed__empty" />
    );
  } else if (groupBy === 'day') {
    const groups: { key: string; first: string; items: ActivityItem[] }[] = [];
    for (const item of visible) {
      const key = dayKey(item.at, timeZone) ?? 'unknown';
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(item);
      else groups.push({ key, first: item.at, items: [item] });
    }
    list = (
      <ol ref={listRef} tabIndex={-1} className="itsm-ActivityFeed__list" aria-label={label}>
        {groups.map((group) => (
          <li key={`${group.key}-${group.items[0]!.id}`} className="itsm-ActivityFeed__day">
            <Heading className="itsm-ActivityFeed__dayHeading" suppressHydrationWarning>
              {dayHeading(group.first, now, locale, timeZone)}
            </Heading>
            <ol className="itsm-ActivityFeed__items">{group.items.map(renderItem)}</ol>
          </li>
        ))}
      </ol>
    );
  } else {
    list = (
      <ol ref={listRef} tabIndex={-1} className="itsm-ActivityFeed__list itsm-ActivityFeed__items" aria-label={label}>
        {visible.map(renderItem)}
      </ol>
    );
  }

  return (
    <div {...rest} ref={ref} className={cx('itsm-ActivityFeed', className)} data-grouped={groupBy === 'day' ? '' : undefined}>
      <span className="itsm-visually-hidden" role="status">
        {pending > 0 ? `${pending} new ${noun}` : ''}
      </span>
      {pending > 0 && onShowNew ? (
        <div className="itsm-ActivityFeed__new">
          <button
            type="button"
            className="itsm-ActivityFeed__show"
            onClick={() => {
              showing.current = true;
              onShowNew();
            }}
          >
            <Icon name="arrow-up" size="xs" />
            <span>{`${pending} new`}</span>
            <span className="itsm-visually-hidden">{` ${noun},`}</span>
            <span aria-hidden="true">·</span>
            <span>Show</span>
          </button>
        </div>
      ) : null}
      {list}
      {viewAllHref && visible.length > 0 ? (
        <p className="itsm-ActivityFeed__all">
          {Link ? (
            <Link href={viewAllHref} className="itsm-ActivityFeed__allLink">
              {viewAllLabel}
            </Link>
          ) : (
            <a href={viewAllHref} className="itsm-ActivityFeed__allLink">
              {viewAllLabel}
            </a>
          )}
        </p>
      ) : null}
    </div>
  );
}
