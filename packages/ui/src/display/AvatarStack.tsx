import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { formatList } from '../format/format.js';
import { Avatar, type AvatarSize } from '../web/Avatar.js';
import { cx } from '../web/cx.js';

export interface AvatarStackPerson {
  readonly name: string;
  readonly initials?: string;
}

export interface AvatarStackProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'role'> {
  readonly people: readonly AvatarStackPerson[];
  /** Avatars drawn before the rest become "+2". Default 3. */
  readonly max?: number;
  /** Default `sm` (24 px). */
  readonly size?: AvatarSize;
  /** What the people are, spoken first: "Assignees: Ada Lovelace and Grace Hopper". */
  readonly label?: string;
  /** The locale the list of names is joined in ("A, B and C"). `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * Overlapping avatars with a "+2" overflow. Server-safe.
 *
 * Every name is in the accessible name, not only the ones drawn. When some
 * are hidden behind "+2", the stack is the summary of a native `<details>`:
 * tapping or clicking it — or Enter and Space on a keyboard — shows the whole
 * list as text beneath it, which works with no JavaScript and on a touch
 * screen, where a hover tooltip never would. When everybody fits, there is
 * nothing to reveal and the stack is one image named by the list.
 */
export function AvatarStack({
  people,
  max = 3,
  size = 'sm',
  label,
  locale = 'en-GB',
  className,
  ref,
  ...rest
}: AvatarStackProps): ReactNode {
  const limit = Math.max(1, Math.floor(max));
  // Showing "+1" in place of the one avatar it hides saves nothing.
  const shown = people.length > limit + 1 ? people.slice(0, limit) : people;
  const hidden = people.length - shown.length;
  const names = formatList(
    people.map((person) => person.name),
    { locale },
  );
  const spoken = label ? `${label}: ${names}` : names;

  const avatars = (
    <>
      {shown.map((person, index) => (
        <Avatar
          key={`${person.name}-${index}`}
          name={person.name}
          {...(person.initials ? { initials: person.initials } : {})}
          size={size}
          decorative
          className="itsm-AvatarStack__avatar"
        />
      ))}
      {hidden > 0 ? (
        <span className="itsm-AvatarStack__more" data-size={size} aria-hidden="true">
          +{hidden}
        </span>
      ) : null}
    </>
  );

  if (hidden === 0) {
    return (
      <span
        {...rest}
        ref={ref as Ref<HTMLSpanElement>}
        className={cx('itsm-AvatarStack', className)}
        data-size={size}
        role="img"
        aria-label={spoken}
        title={names}
      >
        {avatars}
      </span>
    );
  }

  return (
    <details {...rest} ref={ref as Ref<HTMLDetailsElement>} className={cx('itsm-AvatarStack', className)} data-size={size}>
      <summary className="itsm-AvatarStack__summary" aria-label={spoken} title={names}>
        {avatars}
      </summary>
      <ul className="itsm-AvatarStack__list">
        {people.map((person, index) => (
          <li key={`${person.name}-${index}`} className="itsm-AvatarStack__person">
            <Avatar name={person.name} {...(person.initials ? { initials: person.initials } : {})} size="xs" decorative />
            {person.name}
          </li>
        ))}
      </ul>
    </details>
  );
}
