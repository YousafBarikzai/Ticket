import { Fragment, type HTMLAttributes, type ReactNode } from 'react';
import { describeShortcut, isPlatformNeutral, parseShortcut, type ShortcutDescription } from '../a11y/keys.js';
import { cx } from './cx.js';

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** A shortcut in the hotkey notation: `mod+k`, `g m`, `?`, `shift+j`. */
  readonly keys: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * A keyboard shortcut, drawn as key caps: ⌘ K on a Mac, Ctrl K elsewhere,
 * G then M for a chord.
 *
 * Server-safe, and deliberately free of platform detection: when the two
 * platforms read differently it renders both sets and the stylesheet shows
 * one through `[data-itsm-os]`, which the pre-paint script sets before first
 * paint. Reading the platform here instead would render "Ctrl" on the server
 * and "⌘" in the browser — a hydration mismatch on every page with a hint.
 * The hidden set is `display: none`, so a screen reader hears only the one on
 * screen.
 *
 * The caps are hidden from assistive technology and a sentence stands in for
 * them — "Command K", "G, then M" — because "⌘" is read as "place of interest
 * sign", if at all. Inside a control that already announces its shortcut
 * (`aria-keyshortcuts`), pass `aria-hidden` to silence the hint.
 *
 * The caps are small raised keys in `text.muted` (v3 §2.14). On a dark
 * tooltip or a navy surface the stylesheet draws them from the text colour
 * around them instead, so one hint reads right on a card, in a menu, on a
 * tooltip and in every theme without a prop for each.
 */
export function Kbd({ keys, size = 'md', className, ...rest }: KbdProps): ReactNode {
  const shortcut = parseShortcut(keys);
  const classes = cx('itsm-Kbd', className);
  // An unreadable shortcut is shown as written rather than dropped: the hint
  // is still true, only undecorated.
  if (shortcut.length === 0) {
    return (
      <kbd {...rest} className={classes} data-size={size}>
        {keys}
      </kbd>
    );
  }
  return (
    <kbd {...rest} className={classes} data-size={size}>
      {isPlatformNeutral(shortcut) ? (
        <KeySet description={describeShortcut(shortcut, 'other')} />
      ) : (
        <>
          <KeySet platform="apple" description={describeShortcut(shortcut, 'apple')} />
          <KeySet platform="other" description={describeShortcut(shortcut, 'other')} />
        </>
      )}
    </kbd>
  );
}

function KeySet({ platform, description }: { readonly platform?: 'apple' | 'other'; readonly description: ShortcutDescription }): ReactNode {
  return (
    <span className="itsm-Kbd__set" data-platform={platform}>
      <span className="itsm-Kbd__keys" aria-hidden="true">
        {description.steps.map((caps, step) => (
          <Fragment key={step}>
            {step > 0 ? <span className="itsm-Kbd__then">then</span> : null}
            {caps.map((cap, index) => (
              <kbd key={index} className="itsm-Kbd__key">
                {cap}
              </kbd>
            ))}
          </Fragment>
        ))}
      </span>
      <span className="itsm-visually-hidden">{description.spoken}</span>
    </span>
  );
}
