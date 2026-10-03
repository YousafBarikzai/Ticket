import type { ReactNode } from 'react';
import { IconTile } from '@itsm/ui';
import type { FeatureCard as FeatureCardContent } from '../landing/content.js';
import { Shot } from './Shot.js';
import { TryItBox } from './Spotlight.js';

export interface FeatureCardProps {
  readonly card: FeatureCardContent;
  /** False while the demo is off or the route the instruction needs is not in this build (H4). */
  readonly showTryIt: boolean;
}

/**
 * One of the six feature cards under the spotlights (A5 §4.5): a tile, a
 * title, a sentence and a "Try it", with the screen's picture bleeding off the
 * card's corner. The card is not a link: what to do is in the "Try it", and the
 * role links that start the demo are in the hero and the final band.
 */
export function FeatureCard({ card, showTryIt }: FeatureCardProps): ReactNode {
  const titleId = `card-${card.id}`;
  return (
    <article className="app-Card" aria-labelledby={titleId}>
      <div className="app-Card__text">
        <IconTile icon={card.icon} size={40} className="app-Card__tile" />
        <h3 id={titleId} className="app-Card__title">
          {card.title}
        </h3>
        <p className="app-Card__body">{card.body}</p>
        {showTryIt ? <TryItBox tryIt={card.tryIt} compact /> : null}
      </div>
      <div className="app-Card__shot">
        <Shot id={card.shot} variant="card" />
      </div>
    </article>
  );
}
