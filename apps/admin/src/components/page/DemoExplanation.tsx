import type { ReactNode } from 'react';
import { demoDisabledSentence, type DemoFeature } from '@itsm/contracts/demo';

/**
 * The body of the "Turned off in the demo" pill's popover (`ViewOnly demo`):
 * A3's sentence for the feature, from the copy register.
 *
 * Its own module so `ViewOnly`, which is on nearly every page's first load,
 * fetches the copy register together with the popover — on the first press —
 * rather than with the page.
 */
export default function DemoExplanation({ feature }: { readonly feature: DemoFeature }): ReactNode {
  return <p className="itsm-PageHeader__viewOnlyText">{demoDisabledSentence(feature)}</p>;
}
