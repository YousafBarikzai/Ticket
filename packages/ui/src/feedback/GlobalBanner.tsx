'use client';

import { useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { ActionSpec, IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';
import { useMergedRefs } from '../web/refs.js';
import { FeedbackAction } from './actions.js';
import { rememberDismissal, useDismissed } from './dismissal.js';
import { focusNearestOutside, holdsFocus } from './focus.js';
import { toneIcon } from './tone.js';

export interface GlobalBannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'role'> {
  readonly tone: Tone;
  /** A short uppercase label before the title in the tone's text colour: "Major incident". */
  readonly kicker?: string;
  readonly title: string;
  readonly body?: string;
  readonly icon?: IconName;
  readonly action?: ActionSpec;
  /** Client only. Receives the `action`'s `id` when it has no `href` ("Reload" for a new version). */
  readonly onAction?: (id: string) => void;
  /** Remembers the dismissal on this device under this key; without it the banner cannot be dismissed. */
  readonly dismissKey?: string;
  /** How it is announced when it appears; `false` for a banner present on load. */
  readonly live?: 'polite' | 'assertive' | false;
  /**
   * `strong` for the one strip that must not be read past — a major
   * incident: the bar takes the tone's solid colour and the title its text
   * colour. `subtle` (default) for everything else.
   */
  readonly emphasis?: 'subtle' | 'strong';
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * A full-width strip at the top of the content column, for a condition that
 * applies to the whole app rather than one section: a major incident, a
 * session that ended in the background, "Your access changed", a new version,
 * a suspended tenant, "Offline · showing the copy from 10:42".
 *
 * One line where there is room — a 3 px bar in the tone's colour at the
 * start, icon, optional kicker, title, the sentence after it, the action at
 * the end — and wrapping under itself on a phone. It stays until the
 * condition clears; only a banner with `dismissKey` can be closed, and then it
 * stays closed on this device (a banner already dismissed is never rendered,
 * rather than flashing up on the next load).
 *
 * `live` decides how it is announced: `polite` (the default) for one that
 * appears while somebody is working, `assertive` only for something that
 * stops them ("Your session ended"), and `false` for one that was part of the
 * page when it loaded — a live region announcing on load is noise.
 */
export function GlobalBanner({
  tone,
  kicker,
  title,
  body,
  icon,
  action,
  onAction,
  dismissKey,
  live = 'polite',
  emphasis = 'subtle',
  className,
  ref,
  ...rest
}: GlobalBannerProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const dismissedOnDevice = useDismissed(dismissKey);
  const [closed, setClosed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composedRef = useMergedRefs(ref, rootRef);

  if (closed || dismissedOnDevice !== false) return null;

  const dismiss = (): void => {
    const node = rootRef.current;
    if (node && holdsFocus(node)) focusNearestOutside(node);
    setClosed(true);
    if (dismissKey) rememberDismissal(dismissKey);
  };

  return (
    <div
      {...rest}
      ref={composedRef}
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      className={cx('itsm-GlobalBanner', className)}
      data-tone={tone}
      data-emphasis={emphasis}
      data-live={live === false ? undefined : live}
    >
      <div className="itsm-GlobalBanner__inner">
        <Icon name={icon ?? toneIcon[tone]} size="sm" className="itsm-GlobalBanner__icon" />
        <div className="itsm-GlobalBanner__main">
          <p className="itsm-GlobalBanner__text">
            {kicker ? <span className="itsm-GlobalBanner__kicker">{`${kicker} `}</span> : null}
            <span className="itsm-GlobalBanner__title">{title}</span>
            {body ? <span className="itsm-GlobalBanner__body">{` ${body}`}</span> : null}
          </p>
          {action ? (
            <div className="itsm-GlobalBanner__actions">
              <FeedbackAction action={action} onAction={onAction} defaultVariant="secondary" size="sm" />
            </div>
          ) : null}
        </div>
        {dismissKey ? (
          <button type="button" className="itsm-GlobalBanner__dismiss" aria-label={messages.dismiss} onClick={dismiss}>
            <Icon name="x" size="sm" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
