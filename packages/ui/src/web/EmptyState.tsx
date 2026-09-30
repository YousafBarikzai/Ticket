'use client';

import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { FeedbackActions } from '../feedback/actions.js';
import { StateIllustration, type IllustrationTone } from '../feedback/Illustration.js';
import { Icon } from '../icons/Icon.js';
import type { ActionSpec, IconName, Illustration } from '../types.js';
import { cx } from './cx.js';

export type EmptyStateTone = 'empty' | 'search' | 'error' | 'forbidden' | 'success' | 'offline';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'role'> {
  /** What the place is for, or what happened: "No rules yet", "Nothing needs you right now". */
  readonly title: string;
  /** One sentence. A string from a server component; a node (with a link, say) from a client one. */
  readonly description?: ReactNode;
  /** The icon in the tinted circle (`sm`, `md`); the tone's own when not given. */
  readonly icon?: IconName;
  /** The line drawing of a `lg` state; the tone's own when not given. */
  readonly illustration?: Illustration;
  /** `sm` inside cards and tables, `md` (default) for a section, `lg` for a whole page: first run, offline, not found. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** 2 by default; 3 inside a card whose title is the 2. */
  readonly headingLevel?: 2 | 3 | 4;
  /** Why it is empty. Sets the default icon and tint; `error` is announced (`role="alert"`). */
  readonly tone?: EmptyStateTone;
  /** The one thing the person can do about it — hidden, not disabled, when they cannot. */
  readonly action?: ActionSpec | ReactNode;
  readonly secondaryAction?: ActionSpec | ReactNode;
  /** Client only. Receives the `id` of an action spec that has no `href`. */
  readonly onAction?: (id: string) => void;
  /** Anything that belongs under the description: the "Available offline" list of the offline page. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

const toneIcons: Readonly<Record<EmptyStateTone, IconName>> = {
  empty: 'inbox',
  search: 'search',
  error: 'circle-alert',
  forbidden: 'lock',
  success: 'circle-check',
  offline: 'wifi-off',
};

const toneIllustrations: Readonly<Record<EmptyStateTone, Illustration>> = {
  empty: 'inbox',
  search: 'search',
  error: 'error',
  forbidden: 'forbidden',
  success: 'success',
  offline: 'offline',
};

const illustrationTones: Readonly<Record<EmptyStateTone, IllustrationTone | undefined>> = {
  empty: undefined,
  search: undefined,
  error: 'danger',
  forbidden: undefined,
  success: 'success',
  offline: undefined,
};

/**
 * What a place looks like with nothing in it, and why — never a blank area.
 *
 * `sm`/`md`: a 32 px icon in a tinted circle, the title, one sentence and at
 * most one call to action (SPEC §4.10). `lg`: a line illustration for a whole
 * page — first run, offline, not found, forbidden. The tone picks the icon
 * and tint: a quiet grey for "nothing yet" and "no match", green for "all
 * done", red for an error, which is also `role="alert"` because it is news the
 * person did not ask for; an empty list after a deliberate filter is not.
 *
 * A page never returns a bare empty state: the page header's `h1` always
 * renders, and this heading is a 2 (3 inside a card) beneath it.
 */
export function EmptyState({
  title,
  description,
  icon,
  illustration,
  size = 'md',
  headingLevel = 2,
  tone = 'empty',
  action,
  secondaryAction,
  onAction,
  children,
  className,
  ref,
  ...rest
}: EmptyStateProps): ReactNode {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  // A page-sized state gets its drawing unless the caller chose an icon and no
  // drawing; a section-sized one gets its icon unless the caller chose a
  // drawing and no icon.
  const drawing = size === 'lg' ? (illustration ?? (icon ? undefined : toneIllustrations[tone])) : icon ? undefined : illustration;

  return (
    <div
      {...rest}
      ref={ref}
      className={cx('itsm-EmptyState', className)}
      role={tone === 'error' ? 'alert' : undefined}
      data-size={size}
      data-tone={tone}
    >
      {drawing ? (
        <StateIllustration
          name={drawing}
          size={size === 'lg' ? 'lg' : 'sm'}
          {...(illustrationTones[tone] ? { tone: illustrationTones[tone] } : {})}
          className="itsm-EmptyState__illustration"
        />
      ) : (
        <span className="itsm-EmptyState__icon" aria-hidden="true">
          <Icon name={icon ?? toneIcons[tone]} size={size === 'sm' ? 'xl' : '2xl'} />
        </span>
      )}
      <div className="itsm-EmptyState__text">
        <Heading className="itsm-EmptyState__title">{title}</Heading>
        {typeof description === 'string' || typeof description === 'number' ? (
          description === '' ? null : <p className="itsm-EmptyState__body">{description}</p>
        ) : description !== undefined && description !== null && description !== false ? (
          // A node may hold its own paragraphs, which a <p> cannot contain.
          <div className="itsm-EmptyState__body">{description}</div>
        ) : null}
      </div>
      {children !== undefined && children !== null && children !== false ? (
        <div className="itsm-EmptyState__extra">{children}</div>
      ) : null}
      <FeedbackActions
        className="itsm-EmptyState__actions"
        primary={action}
        secondary={secondaryAction}
        onAction={onAction}
        size={size === 'sm' ? 'sm' : 'md'}
        primaryVariant={size === 'sm' ? 'secondary' : 'primary'}
        secondaryVariant={size === 'sm' ? 'ghost' : 'secondary'}
      />
    </div>
  );
}
