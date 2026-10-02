'use client';

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { lazyModule, useIntentLoader } from '../shell/lazy.js';
import { cx } from './cx.js';

/** What an InfoTip says: an optional title, the explanation, and where the number comes from. */
export interface InfoTipContent {
  /** A short heading in the bubble: "Backlog". */
  readonly title?: string;
  /** The explanation, one or two plain sentences. */
  readonly body: string;
  /** Where the figure comes from, under a rule: "Open tickets in your teams, now". */
  readonly source?: string;
}

export interface InfoTipTriggerProps extends InfoTipContent {
  /** The button's accessible name, naming what it explains: "About Backlog". */
  readonly label: string;
  /** Which side of the button the bubble prefers; it flips when there is no room. `top` by default. */
  readonly side?: 'top' | 'bottom';
  readonly className?: string;
}

export interface InfoTipButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type' | 'aria-label'> {
  readonly label: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * The ⓘ button itself: 24 × 24, ghost, a 14 px `info` glyph in `text.muted`.
 * Shared by the lazy trigger below and by `InfoTip` once it has loaded, so the
 * button looks the same before and after the popover arrives.
 */
export function InfoTipButton({ label, className, ref, ...rest }: InfoTipButtonProps): ReactNode {
  return (
    <button {...rest} ref={ref} type="button" className={cx('itsm-InfoTip__trigger', className)} aria-label={label}>
      <Icon name="info" size={14} className="itsm-InfoTip__glyph" />
    </button>
  );
}

const infoTipModule = lazyModule(() => import('../overlays/InfoTip.js'));

/**
 * An ⓘ that explains a number or a heading when asked: a **toggletip**, not a
 * tooltip. It opens on a click or Enter — never on hover alone, because a
 * tooltip is never the only carrier of an explanation (v2 rule) and hover does
 * not exist on a phone — and Escape closes it and puts focus back on the
 * button.
 *
 * About 0.3 kB in a page's first load. The bubble is a Radix popover, which
 * the root entry must not carry (`index.ts` rule 1), so the button drawn first
 * is a plain one and `@itsm/ui/overlays`' `InfoTip` is fetched on the first
 * sign of intent — the pointer arriving, focus, a press. A press made while it
 * is on its way is remembered and opens the bubble when it lands.
 *
 * A client island: a server component (a `StatCard`, a `Card` head) renders
 * it with plain string props.
 */
export function InfoTipTrigger({ label, title, body, source, side = 'top', className }: InfoTipTriggerProps): ReactNode {
  const loader = useIntentLoader(infoTipModule);
  const InfoTip = loader.loaded?.InfoTip;
  if (!InfoTip) {
    return <InfoTipButton {...loader.intentProps} label={label} className={className} aria-haspopup="dialog" aria-expanded={false} />;
  }
  return (
    <InfoTip
      label={label}
      body={body}
      side={side}
      {...(title === undefined ? {} : { title })}
      {...(source === undefined ? {} : { source })}
      trigger={<InfoTipButton label={label} className={className} ref={loader.triggerRef} />}
      open={loader.open}
      onOpenChange={loader.setOpen}
    />
  );
}
