'use client';

import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { lazyModule, useIntentLoader } from '../shell/lazy.js';
import { ShellLink } from '../shell/ShellLink.js';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';
import type { HeroTone } from './HeroCard.js';

/** One contributor to a verdict: "1 breached: INC-004503 Teams camera not detected". */
export interface HeroWhyItem {
  readonly label: string;
  /** A second line: "Resolution target passed at 15:10". */
  readonly detail?: string;
  readonly tone?: HeroTone;
  /** The ticket, or the filtered view, behind the contributor. */
  readonly href?: string;
}

export interface HeroWhyProps {
  /** The button's words; "Why?" by default. */
  readonly label?: string;
  /** A heading in the popover, naming what it explains: "Why queue health is at risk". Without it the button names it. */
  readonly title?: string;
  readonly items: readonly HeroWhyItem[];
  readonly className?: string;
}

const toneIcon: Readonly<Record<HeroTone, IconName>> = {
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
  info: 'info',
  hold: 'pause',
  neutral: 'circle-dot',
};

const popoverModule = lazyModule(() => import('../overlays/Popover.js'));

function WhyList({ items }: { readonly items: readonly HeroWhyItem[] }): ReactNode {
  return (
    <ul className="itsm-HeroWhy__list">
      {items.map((item, index) => {
        const tone = item.tone ?? 'neutral';
        return (
          <li key={`${index}-${item.label}`} className="itsm-HeroWhy__item" data-tone={tone}>
            <Icon name={toneIcon[tone]} size={14} className="itsm-HeroWhy__icon" />
            <span className="itsm-HeroWhy__text">
              {item.href ? (
                <ShellLink href={item.href} className="itsm-HeroWhy__link">
                  {item.label}
                </ShellLink>
              ) : (
                <span className="itsm-HeroWhy__label">{item.label}</span>
              )}
              {item.detail ? <span className="itsm-HeroWhy__detail">{item.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The "Why?" pill beside a hero's verdict (v3 §2.13, A1 §7.3): a button that
 * opens a small non-modal popover listing what made the verdict, each item
 * linking to the ticket or view behind it.
 *
 * A client island of about 0.8 kB. The popover itself is `@itsm/ui/overlays`'
 * Radix popover, which the root entry must not carry (`index.ts` rule 1), so
 * the pill drawn first is a plain button and the popover module is fetched on
 * the first sign of intent — the pointer arriving, focus, a press — and a
 * press made while it is on its way opens it when it lands (`useIntentLoader`).
 * The Service Desk and Administration already load that module for their
 * menus, so in practice it is there at once.
 *
 * It is a `button` with `aria-expanded`; the popover is a dialog named by its
 * title (or by the button), closed by Escape or a press outside, focus back
 * on the pill. The popover renders outside the hero, so it is the ordinary
 * light popover even over the navy card. With nothing to explain it renders
 * nothing: a pill that opens an empty list is worse than none.
 */
export function HeroWhy({ label = 'Why?', title, items, className }: HeroWhyProps): ReactNode {
  const loader = useIntentLoader(popoverModule);
  if (items.length === 0) return null;
  const Popover = loader.loaded?.Popover;
  const classes = cx('itsm-HeroWhy', className);
  if (!Popover) {
    return (
      <button {...loader.intentProps} type="button" className={classes} aria-haspopup="dialog" aria-expanded={false}>
        {label}
      </button>
    );
  }
  return (
    <Popover
      trigger={
        <button ref={loader.triggerRef} type="button" className={classes}>
          {label}
        </button>
      }
      {...(title === undefined ? {} : { title })}
      side="bottom"
      align="start"
      width="sm"
      open={loader.open}
      onOpenChange={loader.setOpen}
      className="itsm-HeroWhy__popover"
    >
      <WhyList items={items} />
    </Popover>
  );
}
