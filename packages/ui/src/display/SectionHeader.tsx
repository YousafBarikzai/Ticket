import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';
import { Count } from './Count.js';

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title' | 'id'> {
  /** The section's name, sentence case: "Common requests". */
  readonly title: string;
  /** `h2` (default) for a section of the page, `h3` for one inside a section. */
  readonly level?: 2 | 3;
  /**
   * How many things the section holds, drawn as a `Count` beside the title and
   * read as part of the heading ("Common requests, 6"). `null` or absent draws
   * nothing: an unknown count is never shown as 0.
   */
  readonly count?: number | null;
  /** A short qualifier after the title: "Northwind Traders · D−21". */
  readonly sub?: string;
  /** Controls at the end of the line: a "Browse all →" link, a range. */
  readonly actions?: ReactNode;
  /** The heading's id, for `aria-labelledby` on the section it heads and for in-page links. */
  readonly id?: string;
  /** For the count's digits; `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * The heading over a group of cards on a dashboard or a page (v3 §2.13, G3):
 * the title in `title2`, an optional count and qualifier, a hairline that
 * fades out across the rest of the line, then any actions.
 *
 * Server-safe. The hairline is decoration (`aria-hidden`); the heading is a
 * real `h2`/`h3`, so the page's outline and a screen reader's heading list
 * carry the section. The vertical rhythm — 32 px above, 12 below, 16 above
 * the first one on a page — lives in the stylesheet, so a page lays out
 * sections by placing headers and nothing else.
 */
export function SectionHeader({ title, level = 2, count, sub, actions, id, locale, className, ref, ...rest }: SectionHeaderProps): ReactNode {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div {...rest} ref={ref} className={cx('itsm-SectionHeader', className)} data-level={level}>
      <Heading className="itsm-SectionHeader__title" {...(id ? { id } : {})}>
        {title}
        {count === undefined ? null : <Count value={count} size="md" className="itsm-SectionHeader__count" {...(locale ? { locale } : {})} />}
      </Heading>
      {sub ? <p className="itsm-SectionHeader__sub">{sub}</p> : null}
      <span className="itsm-SectionHeader__rule" aria-hidden="true" />
      {actions ? <div className="itsm-SectionHeader__actions">{actions}</div> : null}
    </div>
  );
}
