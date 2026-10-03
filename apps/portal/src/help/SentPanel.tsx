import type { ReactNode } from 'react';
import { HeroCard, Stepper } from '@itsm/ui';
import { NEXT_LABEL, type SentPanelModel } from './sent.js';

/**
 * The success panel of both Help Portal flows (SPEC v3 §7.2, X-M12): a light
 * `HeroCard` — the kicker "Request sent", the number and when we aim to reply
 * as its verdict, one sentence — with "What happens next" beside it as a
 * vertical `Stepper`.
 *
 * Server-only in practice: it is drawn by the `renderSentPanel` action and
 * reaches the browser as finished markup, so neither flow carries the hero's
 * code (`/catalogue/[key]` has no room for it, §10.3). Every part is
 * server-safe (no links, no islands); the flows put their own buttons under
 * it. `id` names the hero, so its heading is `<id>-verdict`.
 */
export function SentPanel({ model, headingLevel, id }: { readonly model: SentPanelModel; readonly headingLevel: 2 | 3; readonly id: string }): ReactNode {
  return (
    <HeroCard
      id={id}
      variant="light"
      kicker={model.kicker}
      verdict={model.verdict}
      narrative={model.narrative}
      headingLevel={headingLevel}
      data-sent=""
      aside={
        <>
          <p className="itsm-HeroCard__asideKicker">{NEXT_LABEL}</p>
          <Stepper label={NEXT_LABEL} orientation="vertical" size="sm" steps={model.steps} />
        </>
      }
    />
  );
}
