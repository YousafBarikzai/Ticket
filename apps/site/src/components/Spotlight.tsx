import type { ReactNode } from 'react';
import { Avatar, Icon } from '@itsm/ui';
import { EXPLORE, persona, type Spotlight as SpotlightContent, type TryIt } from '../landing/content.js';
import { Shot } from './Shot.js';

/**
 * The "Try it" box under a spotlight or a feature card (A5 §4.5): a pill, the
 * persona to be ("As Alex · Agent", with their avatar) and the instruction.
 * Text only — the role links are elsewhere on the page — so the box adds no
 * link a visitor could follow into the wrong persona.
 */
export function TryItBox({ tryIt, compact = false }: { readonly tryIt: TryIt; readonly compact?: boolean }): ReactNode {
  const who = persona(tryIt.persona);
  return (
    <p className={compact ? 'app-TryIt app-TryIt--compact' : 'app-TryIt'}>
      <span className="app-TryIt__pill">{EXPLORE.tryIt}</span>
      <span className="app-TryIt__who">
        <Avatar name={who.name} initials={who.initials} size={16} decorative />
        {EXPLORE.asPersona(who)}
      </span>
      <span className="app-TryIt__text">{tryIt.text}</span>
    </p>
  );
}

export interface SpotlightProps {
  readonly spotlight: SpotlightContent;
  /** Even rows put the picture first on wide screens, so the page alternates. */
  readonly flipped?: boolean;
  /** False while the demo is off or the route the instruction needs is not in this build (H4). */
  readonly showTryIt: boolean;
}

/**
 * One of the four alternating spotlights (A5 §4.5): a kicker, a title, a
 * paragraph, three points and a "Try it", beside a picture of the screen.
 * An `article` with its title as its name, so a screen reader can move
 * between them.
 */
export function Spotlight({ spotlight, flipped = false, showTryIt }: SpotlightProps): ReactNode {
  const titleId = `spot-${spotlight.id}`;
  return (
    <article className="app-Spot" data-flipped={flipped ? '' : undefined} aria-labelledby={titleId}>
      <div className="app-Spot__text">
        <p className="app-Spot__kicker">
          <Icon name={spotlight.icon} size={16} />
          {spotlight.kicker}
        </p>
        <h3 id={titleId} className="app-Spot__title">
          {spotlight.title}
        </h3>
        <p className="app-Spot__body">{spotlight.body}</p>
        <ul className="app-Spot__points">
          {spotlight.points.map((point) => (
            <li key={point}>
              <Icon name="check" size={16} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        {showTryIt ? <TryItBox tryIt={spotlight.tryIt} /> : null}
      </div>
      <div className="app-Spot__media">
        <div className="app-Spot__frame">
          <Shot id={spotlight.shot} variant="spot" />
        </div>
      </div>
    </article>
  );
}
