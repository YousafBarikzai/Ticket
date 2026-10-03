import type { ReactNode } from 'react';
import { Card, type Problem } from '@itsm/ui';
import './page.css';

/** The longest a headline may run (§7.0.4): one line on a register card at 1440, two at most on a phone. */
export const HEADLINE_MAX = 110;

/**
 * A register's headline as it may be shown (§7.0.4, A7 §2.5): trimmed, no
 * full stop at the end, at most 110 characters (cut at a word, with "…"), and
 * `undefined` when there is nothing to say — an empty headline is omitted,
 * never "0 problems".
 */
export function registerHeadline(text: string | null | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  let line = text.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trimEnd();
  if (line === '') return undefined;
  if (line.length > HEADLINE_MAX) {
    const cut = line.slice(0, HEADLINE_MAX - 1);
    const space = cut.lastIndexOf(' ');
    line = `${(space > HEADLINE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·—-]+$/, '')}…`;
  }
  return line;
}

export interface RegisterCardProps {
  /** The register's name: "Rules", "Configuration items". */
  readonly title: string;
  /** The generated sentence (`registerHeadline` in `server/headlines.ts`): "3 breaching · 10 unassigned". */
  readonly headline?: string | null;
  /** Controls at the end of the header: Group ▾, ⋯. */
  readonly actions?: ReactNode;
  /** The register could not be read: the card says so, and the rest of the page works. */
  readonly problem?: Problem;
  /** The table (DataTable v3), and its Load more. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The card that holds a register's table (G8, A7 §2.2 T2): a `Card` with
 * `bleed`, so the table runs to its edges, titled with the register's name and
 * the headline under it.
 *
 * The table sits in `[data-export-table]`, which is what the toolbar's
 * `ExportMenu` reads for "Download CSV": what is exported is exactly what the
 * person is looking at. A server component.
 */
export function RegisterCard({ title, headline, actions, problem, children, className }: RegisterCardProps): ReactNode {
  const line = registerHeadline(headline);
  return (
    <Card
      title={title}
      bleed
      headerDivider
      {...(line ? { headline: line } : {})}
      {...(actions ? { actions } : {})}
      {...(problem ? { problem } : {})}
      className={className ? `app-RegisterCard ${className}` : 'app-RegisterCard'}
    >
      <div className="app-RegisterCard__table" data-export-table="">
        {children}
      </div>
    </Card>
  );
}
