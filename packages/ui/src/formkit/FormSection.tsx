'use client';

import type { ReactNode, Ref } from 'react';
import { useIds } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';

export interface FormSectionProps {
  readonly title: string;
  readonly description?: string;
  /** Default 2: a section of a page form sits under the page's `h1`. Use 3 inside a card or sheet that has its own `h2`. */
  readonly headingLevel?: 2 | 3;
  /**
   * `2` sets the fields out in two columns once the section is wide enough
   * (a container query). A field that holds a text area or a group, or that
   * carries `data-span="full"`, keeps the full width.
   */
  readonly columns?: 1 | 2;
  /** Guidance shown beside the fields on wide screens, and after the description on narrow ones. */
  readonly aside?: ReactNode;
  /** Renders as `<details>`, for settings most people never change. */
  readonly collapsible?: boolean;
  /** With `collapsible`: open at first. */
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * A titled group of fields.
 *
 * A `group` named by its heading, so a screen reader says "Notifications,
 * group" on the way into its first field, which is the context a sighted
 * person gets from the heading above it. Not a `region`: a settings page has
 * a dozen of these, and a dozen landmarks would bury the page's real ones.
 *
 * The layout follows the space the section has rather than the window (a
 * container query): in a sheet or on a phone the heading, description and
 * guidance sit above the fields; on a wide settings page they take a column
 * on the left and the fields a wider one on the right — the arrangement a
 * system settings pane uses, where the description is read once and the
 * controls are what the eye returns to.
 *
 * `collapsible` is progressive disclosure on the native `<details>` element —
 * no JavaScript to open it, announced as expandable everywhere, and opened by
 * the browser's own find-in-page. Its heading stays a heading (inside the
 * `<summary>`, which HTML allows for exactly this), so the section is still
 * in the page's outline while closed.
 */
export function FormSection({
  title,
  description,
  headingLevel = 2,
  columns = 1,
  aside,
  collapsible = false,
  defaultOpen = false,
  children,
  className,
  ref,
}: FormSectionProps): ReactNode {
  const ids = useIds('itsm-form-section', ['title', 'description'] as const);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const hasAside = aside !== undefined && aside !== null && aside !== false;

  // Two wrappers, because a container query sizes an element by its
  // container, never by itself: the section is the container its layout
  // answers to, and the fields column the one its grid of fields does.
  const fields = (
    <div className="itsm-FormSection__fields">
      <div className="itsm-FormSection__grid" data-columns={columns}>
        {children}
      </div>
    </div>
  );

  if (collapsible) {
    return (
      <details
        ref={ref as Ref<HTMLDetailsElement>}
        className={cx('itsm-FormSection', 'itsm-FormSection--collapsible', className)}
        open={defaultOpen || undefined}
      >
        <summary className="itsm-FormSection__summary">
          <Icon name="chevron-right" size="sm" className="itsm-FormSection__chevron" directional />
          <span className="itsm-FormSection__summaryText">
            <Heading id={ids.title} className="itsm-FormSection__title">
              {title}
            </Heading>
            {description ? <span className="itsm-FormSection__description">{description}</span> : null}
          </span>
        </summary>
        <div className="itsm-FormSection__content">
          {hasAside ? <div className="itsm-FormSection__aside">{aside}</div> : null}
          {fields}
        </div>
      </details>
    );
  }

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      role="group"
      aria-labelledby={ids.title}
      className={cx('itsm-FormSection', className)}
      data-aside={hasAside ? '' : undefined}
    >
      <div className="itsm-FormSection__layout">
        <div className="itsm-FormSection__header">
          <Heading id={ids.title} className="itsm-FormSection__title">
            {title}
          </Heading>
          {description ? (
            <p id={ids.description} className="itsm-FormSection__description">
              {description}
            </p>
          ) : null}
          {hasAside ? <div className="itsm-FormSection__aside">{aside}</div> : null}
        </div>
        {fields}
      </div>
    </div>
  );
}
