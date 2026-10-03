import type { ReactNode } from 'react';
import type { AreaDefinition } from '@itsm/contracts/areas';
import { Icon, IconTile, VisuallyHidden } from '@itsm/ui';
import { AREA_LINK_PREFIX, UNAVAILABLE } from '../landing/roles-content.js';

export interface AreaRowProps {
  readonly area: AreaDefinition;
  /** `workAccountHref(config, area.id)`; null when this deployment lacks the area's origin. */
  readonly href: string | null;
}

/**
 * One work-account sign-in on the chooser (A5 §6.4): a plain `<a>` to that
 * app's `/api/session/login?account=1&redirectTo=%2Fresume`, so the choice
 * made here is final and a real sign-in clears any demo cookie (D22).
 *
 * The accessible name reads "Sign in to Service Desk — Work tickets, queues
 * and SLAs": the prefix and the dash are visually hidden, the parts are not.
 */
export function AreaRow({ area, href }: AreaRowProps): ReactNode {
  const body = (
    <>
      <IconTile icon={area.icon} size={40} />
      <span className="app-AreaRow__text">
        {href ? <VisuallyHidden>{`${AREA_LINK_PREFIX} `}</VisuallyHidden> : null}
        <span className="app-AreaRow__name">{area.name}</span>
        <VisuallyHidden>{' — '}</VisuallyHidden>
        <span className="app-AreaRow__description">{href ? area.description : UNAVAILABLE}</span>
      </span>
      {href ? <Icon name="chevron-right" size="sm" className="app-AreaRow__chevron" /> : null}
    </>
  );
  return href ? (
    <a className="app-AreaRow" href={href} data-area={area.id}>
      {body}
    </a>
  ) : (
    <div className="app-AreaRow" data-area={area.id} data-unavailable="">
      {body}
    </div>
  );
}
