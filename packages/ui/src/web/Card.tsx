'use client';

import { Children, type ReactNode, type Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import { IconTile } from '../display/IconTile.js';
import type { SurfaceProps } from '../display/Surface.js';
import { ProblemState } from '../feedback/ProblemState.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { EmptySpec, IconName, LinkComponent, Problem } from '../types.js';
import { cx } from './cx.js';
import { EmptyState } from './EmptyState.js';
import { InfoTipTrigger } from './InfoTipTrigger.js';
import { Skeleton, SkeletonText } from './Skeleton.js';

/** What a card's ⓘ explains: the explanation alone, or with a title and where the figure comes from. */
export type CardInfo = string | { readonly title?: string; readonly body: string; readonly source?: string };

/** The link at the end of a card's foot: "Open trends →". */
export interface CardFooterLink {
  readonly href: string;
  /** Names the destination, so the link makes sense out of context: "Open trends", never "More". */
  readonly label: string;
}

export interface CardProps extends Omit<SurfaceProps, 'title' | 'children' | 'ref'> {
  readonly children?: ReactNode;
  /** The card's heading. With `href`, it is also the link. */
  readonly title?: string;
  /** `h2` by default: a card on a page sits under the page's `h1`. */
  readonly titleAs?: 'h2' | 'h3' | 'h4';
  readonly subtitle?: string;
  /** The card's answer in words, 2 px under the title: "Resolved 412, raised 398: the backlog fell by 14". */
  readonly headline?: string;
  /** A registry icon on an accent `IconTile` before the title. Decorative. */
  readonly icon?: IconName;
  /** An ⓘ after the title that explains the card on request (a toggletip, `InfoTipTrigger`), named "About {title}". */
  readonly info?: CardInfo;
  /** One quiet item beside the title — "Updated 2 min ago", a `StatusPill`. */
  readonly meta?: ReactNode;
  /** Controls at the end of the header row, beside the title — a `Menu` trigger, a segmented range. */
  readonly actions?: ReactNode;
  /** Content for the card's foot, between the caption and the foot link. */
  readonly footer?: ReactNode;
  /** A quiet line at the start of the foot: the source or period of what the card shows. */
  readonly caption?: string;
  /** A link at the end of the foot to where the card's subject continues. */
  readonly footerLink?: CardFooterLink;
  /**
   * Lets the body's children marked `data-bleed` — a table, a list — run to
   * the card's edges, dropping their own frame. The card's own padding stays
   * on everything else.
   */
  readonly bleed?: boolean;
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

function AppLink({ Link, href, className, children }: { readonly Link: LinkComponent | undefined; readonly href: string; readonly className: string; readonly children: ReactNode }): ReactNode {
  return Link ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * A titled panel on the canvas (v3 §2.13): the admin's `Panel`, the drafts'
 * `Section` and, with chart chrome, `ChartCard` — one component.
 *
 * **v3 look.** Depth is border-first: a white card with a 1 px `border.subtle`
 * edge, radius 12, no resting shadow, padding `--itsm-card-padding` (20, 16
 * in a card narrower than 35 rem — the card is its own container). The head
 * is a row: an accent `IconTile`, the title in `title3` with its ⓘ, the meta,
 * then the actions at the end; the headline sits 2 px under the title and is
 * the card's answer in words. The foot is set off by a `border.divider`
 * hairline: the caption at the start, the foot link at the end.
 *
 * **Navigable** cards use the stretched-link pattern: the title is the link
 * and its `::after` covers the card, which keeps the heading a heading and the
 * ⓘ, the actions and any link in the body or foot separately clickable. They
 * no longer lift: hover is the `border.soft` edge and elevation `sm`.
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
  headline,
  icon,
  info,
  meta,
  actions,
  footer,
  caption,
  footerLink,
  bleed = false,
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
  elevation = 'none',
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
      <AppLink Link={Link} href={href} className="itsm-Card__link">
        {title}
      </AppLink>
    ) : (
      title
    );

  const infoContent = info === undefined ? undefined : typeof info === 'string' ? { body: info } : info;
  const hasHeader = Boolean(title || subtitle || headline || icon || infoContent || meta || actions || (loading && !title));
  const hasFoot = Boolean(footer || caption || footerLink);

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
      data-bleed={bleed ? '' : undefined}
      aria-busy={loading || undefined}
      {...(asRegion && title ? { role: 'region', 'aria-labelledby': titleId } : {})}
    >
      {hasHeader ? (
        <div className="itsm-Card__header">
          {icon ? <IconTile icon={icon} size={28} className="itsm-Card__icon" /> : null}
          <div className="itsm-Card__heading">
            <div className="itsm-Card__titles">
              <div className="itsm-Card__titleRow">
                {title ? (
                  <Heading className="itsm-Card__title" id={titleId}>
                    {linkedTitle}
                  </Heading>
                ) : loading ? (
                  <Skeleton className="itsm-Card__titleSkeleton" width="40%" height={18} />
                ) : null}
                {infoContent ? (
                  <InfoTipTrigger
                    label={`About ${title ?? 'this card'}`}
                    body={infoContent.body}
                    {...(infoContent.title === undefined ? {} : { title: infoContent.title })}
                    {...(infoContent.source === undefined ? {} : { source: infoContent.source })}
                    className="itsm-Card__info"
                  />
                ) : null}
              </div>
              {headline ? <p className="itsm-Card__headline">{headline}</p> : null}
              {subtitle ? <p className="itsm-Card__subtitle">{subtitle}</p> : null}
            </div>
            {meta ? <div className="itsm-Card__meta">{meta}</div> : null}
          </div>
          {actions ? <div className="itsm-Card__actions">{actions}</div> : null}
          {navigable && !actions ? <Icon name="chevron-right" size="sm" className="itsm-Card__chevron" directional /> : null}
        </div>
      ) : null}
      {body !== null ? <div className="itsm-Card__body">{body}</div> : null}
      {hasFoot ? (
        <div className="itsm-Card__footer">
          {caption ? <p className="itsm-Card__caption">{caption}</p> : null}
          {footer}
          {footerLink ? (
            <AppLink Link={Link} href={footerLink.href} className="itsm-Card__footerLink">
              <span>{footerLink.label}</span>
              <Icon name="arrow-right" size={14} className="itsm-Card__footerArrow" directional />
            </AppLink>
          ) : null}
        </div>
      ) : null}
    </Tag>
  );
}
