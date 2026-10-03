import type { ReactNode } from 'react';
import { UpdatedAt } from './UpdatedAt.js';
import './page.css';

export interface FreshnessProps {
  /** When the page's data was read: the server render's instant (the same one `AsAt` shows). */
  readonly at: string;
  /** Said when a refresh somebody pressed lands: "Command centre updated". */
  readonly announcement?: string;
}

/**
 * "● Updated 1 min ago ↻" at the action end of a dashboard's toolbar (G2).
 *
 * The dot says the page keeps itself fresh (it refreshes on return and every
 * five minutes, `UpdatedAt`); it is decorative, because the words beside it
 * say the same thing to everyone. It is the live dot's colour
 * (`success.border`, as `Badge dotState="live"`) without the badge's pill.
 */
export function Freshness({ at, announcement }: FreshnessProps): ReactNode {
  return (
    <span className="app-Freshness">
      <span className="app-Freshness__dot" aria-hidden="true" />
      <UpdatedAt at={at} {...(announcement ? { announcement } : {})} />
    </span>
  );
}
