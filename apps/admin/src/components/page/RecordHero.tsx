import type { ReactNode } from 'react';
import { IconTile, StatusPill, type IconName, type StatusPillProps } from '@itsm/ui';
import './page.css';

export interface RecordHeroProps {
  /** The record's kind, as a registry icon: `workflow`, `file-text`. Decorative. */
  readonly icon: IconName;
  /** The record's name, in the page's one `<h1>`. */
  readonly title: string;
  /** Its state: "Draft", "Published", "Paused". */
  readonly status?: StatusPillProps;
  /** "Version 4 · changed by Jordan Lee 2 h ago". */
  readonly meta?: string;
  /** Save draft · Publish: the one primary last. */
  readonly actions?: ReactNode;
  /** Anything that belongs beside the record's name rather than under it: a counter, a link out. */
  readonly aside?: ReactNode;
  readonly className?: string;
}

/**
 * The first row of a record or builder page (T3, A7 §2.2): an `IconTile` 40,
 * the record's name as the page's visible `<h1>` in the `recordTitle` style
 * (Jakarta 600 22/28, §2.7, X-m8), its status, a meta line and the actions.
 *
 * The top bar carries the section ("‹ Rules", `barTitle="section"`), so this
 * `<h1>` is the record's own name and the only one on the page. A server
 * component.
 */
export function RecordHero({ icon, title, status, meta, actions, aside, className }: RecordHeroProps): ReactNode {
  return (
    <section aria-labelledby="record-hero-title" className={className ? `app-RecordHero ${className}` : 'app-RecordHero'}>
      <IconTile icon={icon} size={40} tone="accent" className="app-RecordHero__icon" />
      <div className="app-RecordHero__body">
        <div className="app-RecordHero__heading">
          <h1 id="record-hero-title" className="app-RecordHero__title">
            {title}
          </h1>
          {status ? <StatusPill {...status} /> : null}
        </div>
        {meta ? <p className="app-RecordHero__meta">{meta}</p> : null}
      </div>
      {aside ? <div className="app-RecordHero__aside">{aside}</div> : null}
      {actions ? <div className="app-RecordHero__actions">{actions}</div> : null}
    </section>
  );
}
