'use client';

import type { AreaLink, AreaModel } from '@itsm/contracts/areas';
import type { ReactElement, ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { IconTile } from '../display/IconTile.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { SWITCH_AREA_LABEL } from './AreaList.js';
import { lazyModule, useIntentLoader, type IntentTriggerProps } from './lazy.js';

export interface AreaSwitcherProps {
  readonly model: AreaModel;
  /**
   * `card`: the sidebar's Area card (two lines, a tile and ⇕; a 44 px tile
   * with a ⇕ badge in the rail). `compact`: the portal's "Help Portal ⌄" in
   * its top bar, and — icon only — the 32 × 44 control on phone top bars.
   */
  readonly display: 'card' | 'compact';
  readonly className?: string;
}

/** The area menu, fetched on intent: the Radix menu is not in the first load (A2 §13). */
const panelModule = lazyModule(() => import('./AreaMenuPanel.js'));

type TriggerProps = Partial<Omit<IntentTriggerProps, 'ref'>> & {
  readonly ref: IntentTriggerProps['ref'];
  readonly 'aria-haspopup'?: 'menu';
  readonly 'aria-expanded'?: boolean;
};

/** The current area's row; a model always lists it, so the fallback only guards a hand-built one. */
export function currentArea(model: AreaModel): AreaLink {
  return (
    model.areas.find((link) => link.current) ?? {
      id: model.current,
      name: model.current,
      description: '',
      icon: 'inbox',
      href: '/',
      origin: null,
      current: true,
    }
  );
}

/**
 * The way between the product's areas (D7): the top-left control of the
 * Service Desk and Administration, and the visible switcher beside the
 * portal's mark.
 *
 * With one area (`model.visible` false) it is a lockup — the same words, a
 * plain `<div>`, no border, no focus stop — because there is nowhere to go.
 * Otherwise a button named "Switch area. Current: Service Desk" (the visible
 * name inside it, WCAG 2.5.3), described by the area's one-liner, that opens
 * `AreaMenuPanel`. The menu module loads on the first sign of intent —
 * pointer, focus or press — and a press made while it loads opens it
 * (`useIntentLoader`), so the portal's first paint carries no menu library.
 *
 * In the rail the card's own styles draw it as a 44 px tile with a ⇕ badge,
 * and the menu opens to the right.
 */
export function AreaSwitcher({ model, display, className }: AreaSwitcherProps): ReactNode {
  const area = currentArea(model);
  const descriptionId = useStableId('itsm-area-description');
  const loader = useIntentLoader(panelModule);

  const words = (
    <span className="itsm-AreaSwitcher__text">
      <span className="itsm-AreaSwitcher__name">{area.name}</span>
      <span className="itsm-AreaSwitcher__description" id={descriptionId}>
        {area.description}
      </span>
    </span>
  );
  const tile = <IconTile icon={area.icon} size={28} className="itsm-AreaSwitcher__tile" />;

  if (!model.visible) {
    return (
      <div className={cx('itsm-AreaSwitcher', className)} data-display="lockup" data-variant={display}>
        {display === 'card' ? tile : null}
        {words}
      </div>
    );
  }

  const trigger = (props: TriggerProps): ReactElement<{ id?: string }> => (
    <button
      type="button"
      className={cx('itsm-AreaSwitcher', className)}
      data-display={display}
      data-variant={display}
      aria-label={`${SWITCH_AREA_LABEL}. Current: ${area.name}`}
      aria-describedby={descriptionId}
      {...props}
    >
      {display === 'card' ? tile : null}
      {words}
      <Icon name="chevrons-up-down" size={display === 'card' ? 'sm' : 14} className="itsm-AreaSwitcher__chevron" />
    </button>
  );

  const Panel = loader.loaded?.AreaMenuPanel;
  if (!Panel) return trigger({ ...loader.intentProps, 'aria-haspopup': 'menu', 'aria-expanded': false });
  return <Panel model={model} trigger={trigger({ ref: loader.triggerRef })} open={loader.open} onOpenChange={loader.setOpen} triggerElement={loader.triggerElement} />;
}
