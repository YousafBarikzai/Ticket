'use client';

import { useState, type ReactNode } from 'react';
import { Avatar, IconButton } from '@itsm/ui';

/**
 * A person where a table or drawer used to print a UUID (F8): initials and a
 * name, from `server/people.ts`'s `resolvePeople`.
 *
 * Someone the directory could not name — deactivated, in another
 * organisation, or out of this person's reach — reads "Unknown person" with
 * the short id beside it and a copy button for the full one, so an
 * administrator can still find them; never a blank, never a raw UUID as the
 * only text.
 */

/** A person as the server resolved them. Serialisable: a server page passes these to client tables. */
export interface PersonRef {
  readonly id: string;
  /** Their display name, or null when the directory did not answer for this id. */
  readonly name: string | null;
  readonly email?: string;
  /** A supplier or a customer's contact, from the directory (A3). */
  readonly external?: boolean;
}

/** The first eight characters of a UUID: enough to tell two apart, short enough to read out. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

export interface PersonCellProps {
  /** The resolved person, or just an id when nothing resolved it. */
  readonly person: PersonRef | string | null;
  /** Shown when there is no person at all: "Unassigned", "Nobody". Default "—". */
  readonly empty?: string;
  /** Show the email under the name. */
  readonly detail?: boolean;
  readonly size?: 'xs' | 'sm' | 'md';
  readonly className?: string;
}

export function PersonCell({ person, empty = '—', detail = false, size = 'sm', className }: PersonCellProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const classes = className ? `app-Person ${className}` : 'app-Person';

  if (person === null || person === '') {
    return (
      <span className={classes} data-empty="">
        <span className="app-Person__empty">{empty}</span>
      </span>
    );
  }

  const ref: PersonRef = typeof person === 'string' ? { id: person, name: null } : person;

  if (ref.name === null) {
    const copy = (): void => {
      void navigator.clipboard?.writeText(ref.id).then(
        () => setCopied(true),
        () => undefined,
      );
    };
    return (
      <span className={classes} data-unknown="">
        <Avatar name="?" initials="?" size={size} decorative kind="person" />
        <span className="app-Person__text">
          <span className="app-Person__name">Unknown person</span>
          <code className="app-Person__id" title={ref.id}>
            {shortId(ref.id)}
          </code>
        </span>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied the person’s id' : 'Copy the person’s id'} variant="ghost" size="sm" onClick={copy} />
      </span>
    );
  }

  return (
    <span className={classes}>
      <Avatar name={ref.name} size={size} decorative />
      <span className="app-Person__text">
        <span className="app-Person__name">{ref.name}</span>
        {detail && ref.email ? <span className="app-Person__detail">{ref.email}</span> : null}
      </span>
      {ref.external ? <span className="app-Person__external">External</span> : null}
    </span>
  );
}
