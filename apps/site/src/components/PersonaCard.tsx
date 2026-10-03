import type { ReactNode } from 'react';
import { AREAS } from '@itsm/contracts/areas';
import type { DemoPersona } from '@itsm/contracts/demo';
import { Avatar, Icon, VisuallyHidden } from '@itsm/ui';
import { PERSONA_LINK_PREFIX, PERSONA_TRY_LINE, UNAVAILABLE } from '../landing/roles-content.js';

export interface PersonaCardProps {
  readonly persona: DemoPersona;
  /** `demoHref(config, persona.key)`; null when this deployment lacks the area's origin. */
  readonly href: string | null;
}

/**
 * One demo role on the chooser (A5 §6.5): avatar, role, name, "{title} ·
 * {area}" and what to try.
 *
 * A plain `<a>` with `rel="nofollow"` and never `noreferrer`: the app
 * auto-submits only when the Referer is the site (D22). `data-persona` is
 * what the layout's click listener reads to remember the role for "Continue
 * the demo". Without an origin the card is text saying so, never a link to
 * nowhere.
 */
export function PersonaCard({ persona, href }: PersonaCardProps): ReactNode {
  const body = (
    <>
      <Avatar name={persona.name} initials={persona.initials} size={44} decorative />
      <span className="app-PersonaCard__text">
        {href ? <VisuallyHidden>{`${PERSONA_LINK_PREFIX} `}</VisuallyHidden> : null}
        <span className="app-PersonaCard__role">{persona.button}</span>{' '}
        <span className="app-PersonaCard__name">{persona.name}</span>{' '}
        <span className="app-PersonaCard__meta">{`${persona.title} · ${AREAS[persona.area].name}`}</span>{' '}
        <span className="app-PersonaCard__try">{href ? PERSONA_TRY_LINE[persona.key] : UNAVAILABLE}</span>
      </span>
      {href ? <Icon name="chevron-right" size="sm" className="app-PersonaCard__chevron" /> : null}
    </>
  );
  return href ? (
    <a className="app-PersonaCard" href={href} rel="nofollow" data-persona={persona.key}>
      {body}
    </a>
  ) : (
    <div className="app-PersonaCard" data-unavailable="">
      {body}
    </div>
  );
}
