'use client';

import { Children, type ReactNode, type Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import type { SurfaceProps } from '../display/Surface.js';
import { ProblemState } from '../feedback/ProblemState.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { EmptySpec, IconName, Problem } from '../types.js';
import { cx } from './cx.js';
import { EmptyState } from './EmptyState.js';
import { Skeleton, SkeletonText } from './Skeleton.js';

export interface CardProps extends Omit<SurfaceProps, 'title' | 'children' | 'ref'> {
  readonly children?: ReactNode;
  /** The card's heading. With `href`, it is also the link. */
  readonly title?: string;
  /** `h2` by default: a card on a page sits under the page's `h1`. */
  readonly titleAs?: 'h2' | 'h3' | 'h4';
  readonly subtitle?: string;
  /** A registry icon in a small tinted square before the title. Decorative. */
  readonly icon?: IconName;
  /** One quiet item beside the title — "Updated 2 min ago", a `StatusPill`. */
  readonly meta?: ReactNode;
  /** Controls at the end of the header row, beside the title — a `Menu` trigger, a segmented range. */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  /**
   * Makes the card navigable by the stretched-link pattern: the title is the
   * `<a>` (through the provider's `Link`), and its hit area covers the card.
   * The heading stays a heading and `actions` stay separately clickable.
   */
  readonly href?: string;
  /** Shows skeleton lines in place of the body, with the header kept. */
  readonly loading?: boolean;
  /** Shows an inline "Couldn't load … · Try again" in place of the body; the rest of the page is unaffected. */
  readonly problem?: Problem;
  /** Client only. Offered as "Try again" beside a retryable `problem`. */
  readonly onRetry?: () => void;
  /** Shown in place of the body when the card has no children. */
  readonly empty?: EmptySpec;
  /** Client only. Receives the id of an `empty` action that has no `href`. */
  readonly onAction?: (id: string) => void;
  /** A hairline under the header, for cards whose body is a list or a table. */
  readonly headerDivider?: boolean;
  /**
   * @deprecated Use `as="section"` with `aria-labelledby` where a region is
   * wanted. Makes the card a named region landmark, labelled by its title.
   */
  readonly asRegion?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

function hasContent(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => !(typeof child === 'string' && child.trim() === ''));
}

/**
 * A titled panel on the canvas: the admin's `Panel` and the drafts'
 * `Section`, one component.
 *
 * The header is a flex row — icon, title and subtitle, meta, actions — so
 * `actions` sit beside the title as their name says (the old card stacked
 * them underneath). In a narrow card the meta drops under the subtitle
 * rather than squeezing the title into broken words, and the actions stay
 * on the title's line. A navigable card uses the stretched-link pattern: the
 * title is the link and its `::after` covers the card, which keeps the
 * heading a heading and the actions separately clickable, where the old
 * `onActivate` wrapped the whole card, heading and all, in a `<button>` —
 * content a button is not allowed to hold. It lifts on hover and shows a
 * chevron, so it reads as a way in on a touch screen too.
 *
 * Each card fails and loads on its own: `loading` keeps the header and shows
 * skeleton lines, `problem` shows the problem inline with Try again (never
 * behind a tooltip, X-80), and `empty` shows a small empty state when there
 * is nothing to put in it. A page of cards therefore degrades one card at a
 * time.
 */
export function Card({
  children,
  title,
  titleAs = 'h2',
  subtitle,
  icon,
  meta,
  actions,
  footer,
  href,
  loading = false,
  problem,
  onRetry,
  empty,
  onAction,
  headerDivider = false,
  asRegion = false,
  as: Tag = 'section',
  tone = 'raised',
  padding = 'lg',
  radius = '2xl',
  elevation = 'xs',
  className,
  ref,
  ...rest
}: CardProps): ReactNode {
  const titleId = useStableId('itsm-card-title');
  const Link = useOptionalItsm()?.Link;
  const Heading = titleAs;
  const childLevel = Math.min(Number(titleAs.slice(1)) + 1, 4) as 3 | 4;
  const navigable = Boolean(href && title);

  let body: ReactNode;
  if (loading) {
    body = <SkeletonText lines={3} size="callout" className="itsm-Card__skeleton" />;
  } else if (problem) {
    body = (
      <ProblemState
        size="sm"
        problem={problem}
        headingLevel={childLevel}
        {...(title ? { context: title } : {})}
        {...(onRetry ? { onRetry } : {})}
      />
    );
  } else if (empty && !hasContent(children)) {
    body = <EmptyState size="sm" headingLevel={childLevel} {...empty} {...(onAction ? { onAction } : {})} />;
  } else {
    body = hasContent(children) ? children : null;
  }

  const linkedTitle =
    navigable && href ? (
      Link ? (
        <Link href={href} className="itsm-Card__link">
          {title}
        </Link>
      ) : (
        <a href={href} className="itsm-Card__link">
          {title}
        </a>
      )
    ) : (
      title
    );

  const hasHeader = Boolean(title || subtitle || icon || meta || actions || (loading && !title));

  return (
    <Tag
      {...rest}
      ref={ref as Ref<HTMLDivElement & HTMLLIElement>}
      className={cx('itsm-Surface itsm-Card', className)}
      data-tone={tone}
      data-radius={radius}
      data-elevation={elevation}
      data-padding="none"
      data-space={padding}
      data-interactive={navigable ? '' : undefined}
      data-divider={headerDivider ? '' : undefined}
      aria-busy={loading || undefined}
      {...(asRegion && title ? { role: 'region', 'aria-labelledby': titleId } : {})}
    >
      {hasHeader ? (
        <div className="itsm-Card__header">
          {icon ? (
            <span className="itsm-Card__icon" aria-hidden="true">
              <Icon name={icon} size="md" />
            </span>
          ) : null}
          <div className="itsm-Card__heading">
            <div className="itsm-Card__titles">
              {title ? (
                <Heading className="itsm-Card__title" id={titleId}>
                  {linkedTitle}
                </Heading>
              ) : loading ? (
                <Skeleton className="itsm-Card__titleSkeleton" width="40%" height={18} />
              ) : null}
              {subtitle ? <p className="itsm-Card__subtitle">{subtitle}</p> : null}
            </div>
            {meta ? <div className="itsm-Card__meta">{meta}</div> : null}
          </div>
          {actions ? <div className="itsm-Card__actions">{actions}</div> : null}
          {navigable && !actions ? <Icon name="chevron-right" size="sm" className="itsm-Card__chevron" directional /> : null}
        </div>
      ) : null}
      {body !== null ? <div className="itsm-Card__body">{body}</div> : null}
      {footer ? <div className="itsm-Card__footer">{footer}</div> : null}
    </Tag>
  );
}
