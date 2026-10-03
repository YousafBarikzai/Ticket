import type { ReactNode } from 'react';
import type { DemoPersona } from '@itsm/contracts/demo';
import { Avatar, Icon } from '@itsm/ui';
import { FINAL, UNAVAILABLE } from '../landing/content.js';

export interface RoleButtonProps {
  readonly persona: DemoPersona;
  /** `demoHref(config, persona.key)`, or null when this deployment does not know the area's origin. */
  readonly href: string | null;
}

/**
 * One of the final band's three ways into the demo (A5 §4.7): the role word
 * as a kicker, the persona's name, and "{title} · {area}" — all from the
 * persona table, never typed.
 *
 * A plain `<a rel="nofollow" data-persona>` (never `noreferrer`: the app opens
 * the demo in one click only when the Referer names this site, D22). The
 * accessible name reads as a sentence, "Explore the demo as Employee Emma
 * Clarke Finance Manager · Help Portal", through a visually hidden prefix.
 * Without an origin the button is text saying that part is unavailable,
 * rather than a link to nowhere.
 */
export function RoleButton({ persona, href }: RoleButtonProps): ReactNode {
  const body = (
    <>
      <Avatar name={persona.name} initials={persona.initials} size={36} decorative />
      <span className="app-Role__text">
        <span className="itsm-visually-hidden">{FINAL.rolePrefix} </span>
        <span className="app-Role__kicker itsm-text-kicker">{persona.button}</span>
        <span className="app-Role__name">{persona.name}</span>
        <span className="app-Role__line">{href ? FINAL.roleLine(persona) : UNAVAILABLE}</span>
      </span>
    </>
  );
  if (!href) {
    return (
      <span className="app-Role" data-persona-unavailable={persona.key}>
        {body}
      </span>
    );
  }
  return (
    <a className="app-Role" href={href} rel="nofollow" data-persona={persona.key}>
      {body}
      <Icon name="arrow-right" size={16} className="app-Role__arrow" directional />
    </a>
  );
}
