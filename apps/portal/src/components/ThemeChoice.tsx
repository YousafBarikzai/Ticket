'use client';

import type { ReactNode } from 'react';
import { RadioGroup, useTheme, type ThemeSetting } from '@itsm/ui';

/**
 * Light, dark, or whatever the device says.
 *
 * Four options out of five themes. `light` and `dark` are still in the token
 * layer and still answer to `data-itsm-theme`, because a tenant that pinned one
 * before the Apple palettes landed must keep getting it — but they are not
 * offered here. Asking a person to choose between "Light" and "Light (the
 * older one)" is a question about our release history, not about their eyes.
 *
 * High contrast is offered rather than left to the operating system alone:
 * `prefers-contrast: more` is not expressible on every platform this runs on,
 * and somebody who needs it needs it on all of them.
 */

const OPTIONS: readonly { value: ThemeSetting; label: string; description: string }[] = [
  { value: 'system', label: 'Match my device', description: 'Follows your light or dark setting, and changes when it does.' },
  { value: 'apple', label: 'Light', description: 'Always light, whatever the device is set to.' },
  { value: 'apple-dark', label: 'Dark', description: 'Always dark.' },
  { value: 'high-contrast', label: 'High contrast', description: 'Stronger borders and text, for lower-contrast screens or eyes that need it.' },
];

export function ThemeChoice(): ReactNode {
  const { theme, setTheme } = useTheme();

  // A theme not on this list — one a tenant pinned — leaves the group with no
  // selection rather than quietly claiming one of these is in force.
  const selected = OPTIONS.some((option) => option.value === theme) ? theme : null;

  return (
    <RadioGroup
      label="Appearance"
      hint="Applies on this device only. It takes effect straight away."
      options={OPTIONS}
      value={selected}
      onChange={(value) => setTheme(value)}
    />
  );
}
