import type { AreaLink, AreaModel } from '@itsm/contracts/areas';
import type { ReactNode } from 'react';
import { IconTile } from '../display/IconTile.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';

/** The heading every list of areas carries: the area menu's, the sheet's, the portal Me page's. */
export const SWITCH_AREA_LABEL = 'Switch area';

/**
 * The persona line a demo row carries (D11): who you are here, on the
 * current row, or who you will be there, on the others. `null` outside a
 * demo, where a row needs no persona.
 */
export function areaPersonaLine(link: AreaLink): string | null {
  if (!link.persona) return null;
  return link.current ? `You're ${link.persona.name} · ${link.persona.title}` : `You'll continue as ${link.persona.name}, ${link.persona.title}`;
}

/** An area's name as a sentence uses it: "the Help Portal", "the Service Desk", "Administration". */
export function areaInSentence(name: string): string {
  return name === 'Administration' ? name : `the ${name}`;
}

/**
 * What the leaving veil and its live region say while a cross-area link
 * loads: "Opening the Help Portal as Emma Clarke…" in a demo, "Opening the
 * Service Desk…" otherwise (the hop card's words, v3 §2.15).
 */
export function areaHopText(link: AreaLink): string {
  return `Opening ${areaInSentence(link.name)}${link.persona ? ` as ${link.persona.name}` : ''}…`;
}

export interface AreaListProps {
  readonly model: AreaModel;
  /** The heading's level where it sits: 2 in the navigation sheet (default), 3 inside a page section. */
  readonly headingLevel?: 2 | 3;
  /** The heading's `id`, which names the list. One list per page, so a fixed default serves. */
  readonly headingId?: string;
  readonly className?: string;
}

/**
 * The areas as a plain list of links: the navigation sheet below 1024 px and
 * the Help Portal's Me page (A2 §5.6, §6.4). Server-safe — no hooks, no
 * handlers, no menu library — so the Me page carries no client code for it.
 *
 * A "Switch area" heading names the list; each row is the area's tile, name
 * and one-liner, in a demo the persona line (D11), and on the current row a
 * check, `aria-current="true"` and the words "(current area)". A demo ends
 * with "IT Service Management home" (D18). Rows are same-tab anchors, never
 * the router's link and never `rel="noreferrer"`: a demo hop's `/demo` page
 * reads the Referer (D22). Renders nothing while the person has one area.
 */
export function AreaList({ model, headingLevel = 2, headingId = 'itsm-area-list-heading', className }: AreaListProps): ReactNode {
  if (!model.visible) return null;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={cx('itsm-AreaList', className)}>
      <Heading id={headingId} className="itsm-AreaList__heading">
        {SWITCH_AREA_LABEL}
      </Heading>
      <ul className="itsm-AreaList__list" aria-labelledby={headingId}>
        {model.areas.map((link) => {
          const persona = areaPersonaLine(link);
          return (
            <li key={link.id} className="itsm-AreaList__entry">
              <a className="itsm-AreaList__row" href={link.href} aria-current={link.current ? 'true' : undefined}>
                <IconTile icon={link.icon} size={32} className="itsm-AreaList__tile" />
                <span className="itsm-AreaList__text">
                  <span className="itsm-AreaList__name">
                    {link.name}
                    {link.current ? <span className="itsm-visually-hidden"> (current area)</span> : null}
                  </span>
                  <span className="itsm-AreaList__description">{link.description}</span>
                  {persona ? (
                    <span className="itsm-AreaList__persona">
                      <Icon name="user" size={12} />
                      {persona}
                    </span>
                  ) : null}
                </span>
                {link.current ? <Icon name="check" size="sm" className="itsm-AreaList__check" /> : null}
              </a>
            </li>
          );
        })}
        {model.demo && model.home ? (
          <li className="itsm-AreaList__entry">
            <a className="itsm-AreaList__row itsm-AreaList__row--home" href={model.home.href}>
              <IconTile icon="home" size={32} tone="neutral" className="itsm-AreaList__tile" />
              <span className="itsm-AreaList__text">
                <span className="itsm-AreaList__name">{model.home.label}</span>
              </span>
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
