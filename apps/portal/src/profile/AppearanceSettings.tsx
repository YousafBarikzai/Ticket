'use client';

import type { ReactNode } from 'react';
import { RadioGroup, Switch } from '@itsm/ui';
import { useTheme, type Prefs } from '@itsm/ui/theme';

/**
 * Appearance on this device (SPEC §3.5, §6.3 `/profile`): Automatic, Light
 * or Dark as three pictures of the page, and *Increase contrast* — the same
 * two choices as the avatar menu, drawn larger here. Both take effect at
 * once and are kept in this browser only (`itsm-prefs`), so there is nothing
 * to save and no toast.
 *
 * *Increase contrast* follows the device until it is touched: it reads as on
 * while the device asks for more contrast, and a press pins it either way.
 *
 * Each picture is the design system's own theme applied to a miniature
 * (`data-itsm-theme` on the swatch), so it shows the real colours in every
 * theme the page itself is in.
 */

type Appearance = Prefs['appearance'];

function Swatch({ theme }: { readonly theme: 'apple' | 'apple-dark' }): ReactNode {
  return (
    <span className="app-Swatch__pane" data-itsm-theme={theme} aria-hidden="true">
      <span className="app-Swatch__bar" />
      <span className="app-Swatch__card">
        <span className="app-Swatch__line" />
        <span className="app-Swatch__line app-Swatch__line--short" />
      </span>
    </span>
  );
}

function Preview({ appearance }: { readonly appearance: Appearance }): ReactNode {
  return (
    <span className="app-Swatch" data-appearance={appearance}>
      {appearance === 'dark' ? <Swatch theme="apple-dark" /> : <Swatch theme="apple" />}
      {appearance === 'system' ? <Swatch theme="apple-dark" /> : null}
    </span>
  );
}

const OPTIONS: readonly { readonly value: Appearance; readonly label: string; readonly description: string }[] = [
  { value: 'system', label: 'Automatic', description: 'Follows your device' },
  { value: 'light', label: 'Light', description: 'Always light' },
  { value: 'dark', label: 'Dark', description: 'Always dark' },
];

export function AppearanceSettings(): ReactNode {
  const { prefs, setPrefs, resolvedTheme } = useTheme();
  const contrastOn = prefs.contrast === 'more' || (prefs.contrast === 'system' && resolvedTheme.startsWith('high-contrast'));
  return (
    <div className="app-Profile__group app-Appearance">
      <div className="app-Profile__row">
        <RadioGroup
          variant="cards"
          columns={3}
          label="Appearance"
          labelHidden
          hint="On this device only."
          className="app-Appearance__choice"
          options={OPTIONS.map((option) => ({ ...option, icon: <Preview appearance={option.value} /> }))}
          value={prefs.appearance}
          onChange={(value) => setPrefs({ appearance: value })}
        />
      </div>
      <div className="app-Profile__row">
        <Switch
          layout="row"
          label="Increase contrast"
          description="Stronger text and edges. Follows your device until you change it."
          checked={contrastOn}
          onChange={(on) => setPrefs({ contrast: on ? 'more' : 'standard' })}
        />
      </div>
    </div>
  );
}
