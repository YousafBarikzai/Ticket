import type { ReactNode } from 'react';

export interface DeviceFrameProps {
  /** The one sentence a screen reader hears for everything inside. */
  readonly label: string;
  /** Said once, after the label: what the numbers are not. */
  readonly caption: string;
  readonly children: ReactNode;
}

/**
 * The navy bezel the hero's live preview sits in (A5 §4.4).
 *
 * The screen is one image to assistive technology (`role="img"` with a
 * written label): twenty chart labels read out one by one would say less than
 * the sentence does. It is also `inert`, so nothing inside takes focus or a
 * click — the preview is a picture of the product, and the way in is the
 * button above it. The caption is visually hidden.
 */
export function DeviceFrame({ label, caption, children }: DeviceFrameProps): ReactNode {
  return (
    <figure className="app-DeviceFrame">
      <div className="app-DeviceFrame__screen" role="img" aria-label={label} inert>
        {children}
      </div>
      <figcaption className="itsm-visually-hidden">{caption}</figcaption>
    </figure>
  );
}
