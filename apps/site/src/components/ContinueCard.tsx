import type { ReactNode } from 'react';
import type { DemoPersona } from '@itsm/contracts/demo';
import { Icon } from '@itsm/ui';
import { CONTINUE } from '../landing/roles-content.js';

export interface ContinueCardProps {
  readonly persona: DemoPersona;
  /** `demoHref(config, persona.key, '/resume')`; no card at all without it. */
  readonly href: string | null;
}

/**
 * "Continue the demo" for one persona (A5 §6.6), server-rendered **hidden**.
 *
 * The site cannot know whether a demo session is live (the app's cookie is
 * host-only), so every persona gets a hidden card and `HINT_READ` unhides the
 * one the visitor's stored hint names before first paint.
 * `suppressHydrationWarning` covers exactly that removed `hidden`. The link
 * goes through the app's `/demo` with `redirectTo=/resume`: a live session
 * returns where it was, an expired one starts afresh. "Forget" sits outside
 * the link, so the two are separate tab stops; the layout's listener handles
 * it (`[data-forget]`).
 */
export function ContinueCard({ persona, href }: ContinueCardProps): ReactNode {
  if (!href) return null;
  return (
    <div className="app-ContinueCard" data-continue={persona.key} hidden suppressHydrationWarning>
      <a className="app-ContinueCard__link" href={href} rel="nofollow" data-persona={persona.key}>
        <Icon name="history" size="md" className="app-ContinueCard__icon" />
        <span className="app-ContinueCard__text">
          <span className="app-ContinueCard__title">{CONTINUE.title}</span>{' '}
          <span className="app-ContinueCard__line">{CONTINUE.line(persona)}</span>
        </span>
      </a>
      <button type="button" className="app-ContinueCard__forget" data-forget="" aria-label={CONTINUE.forgetLabel}>
        {CONTINUE.forget}
      </button>
    </div>
  );
}
