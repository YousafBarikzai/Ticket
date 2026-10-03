import type { ReactNode } from 'react';
import { demoDisabledSentence, type DemoFeature } from '@itsm/contracts/demo';
import { Button, type ButtonVariant, type IconName } from '@itsm/ui';

export interface DemoLockProps {
  /** The feature the shared demo turns off (`me.demo.disabledFeatures`). */
  readonly feature: DemoFeature;
  /** What the action is called in the full product: "Add credential", "Connect a mailbox". */
  readonly label: string;
  readonly icon?: IconName;
  /** As the control it stands in for: `primary` for a page's primary action. */
  readonly variant?: ButtonVariant;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * A write the shared demo turns off, shown rather than hidden (A7 §2.8, §7.0.2):
 * the button the full product has, disabled, with a lock and A3's sentence as
 * its reason — "This is a shared demo, so connecting to other systems is
 * turned off. Everything else works as in the full product." A visitor
 * learns the feature exists, and why it does nothing here.
 *
 * The sentence is written here, on the server when a server page renders it,
 * so the copy register (`@itsm/contracts/demo`) never has to reach a page's
 * first load for it. Hidden-not-disabled stays the rule for a missing
 * permission in a real tenant (D19); this is only for the demo's features.
 */
export function DemoLock({ feature, label, icon, variant = 'secondary', size = 'md', className }: DemoLockProps): ReactNode {
  return (
    <Button
      variant={variant}
      size={size}
      disabledReason={demoDisabledSentence(feature)}
      disabledIcon="lock"
      data-demo-feature={feature}
      {...(icon ? { iconStart: icon } : {})}
      {...(className ? { className } : {})}
    >
      {label}
    </Button>
  );
}

/** A7 §2.3's name for the same control. */
export const DemoButton = DemoLock;
