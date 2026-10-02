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

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'role'> {
  readonly tone: Tone;
  /**
   * A short uppercase label over the title in the tone's text colour: "Major
   * incident", "Sample data" (D6 allows kickers in banners and heroes only).
   */
  readonly kicker?: string;
  readonly title?: string;
  readonly children?: ReactNode;
  /** The tone's icon by default; `false` for none. */
  readonly icon?: IconName | false;
  readonly action?: ActionSpec | ReactNode;
  /** Client only. Receives the `id` of an `action` spec that has no `href`. */
  readonly onAction?: (id: string) => void;
  /** Client only. Shows a close button; the banner hides itself after calling it. */
  readonly onDismiss?: () => void;
  /** Remembers the dismissal on this device under this key (and shows the close button). */
  readonly dismissKey?: string;
  /** `inline` (default) is tinted with the tone; `subtle` is a quiet well with only the icon in colour. */
  readonly variant?: 'inline' | 'subtle';
  /**
   * How it is announced. `polite` (default) is `role="status"`; `assertive`
   * is `role="alert"`, for danger caused by the person's own action and
   * nothing else; `false` for no live region at all.
   */
  readonly live?: 'polite' | 'assertive' | false;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * A section-level notice: "Couldn't load failed deliveries · Retry", "This
 * policy goes live immediately", "Search is in reduced mode", and below
 * 1024 px the major incident above a list (`kicker="Major incident"`).
 * Replaces the drafts' `Callout`.
 *
 * Icon and words together, never colour alone (SPEC §1.1). A status region by
 * default, and an alert only when the caller says the person's own action
 * caused it: an alert interrupts whatever a screen reader is saying, which is
 * right for "Couldn't publish the rule" and wrong for a banner that was on the
 * page when it loaded.
 *
 * Dismissal: with `onDismiss` the banner closes for this page; with
 * `dismissKey` it stays closed on this device, and a banner closed before is
 * never rendered on the next load — it waits for the browser to say so
 * rather than flashing up and vanishing. When the close button had focus,
 * focus moves to the next thing on the page instead of falling back to the
 * top.
 */
export function Banner({
  tone,
  kicker,
  title,
  children,
  icon,
  action,
  onAction,
  onDismiss,
  dismissKey,
  variant = 'inline',
  live = 'polite',
  className,
  ref,
  ...rest
}: BannerProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const dismissedOnDevice = useDismissed(dismissKey);
  const [closed, setClosed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composedRef = useMergedRefs(ref, rootRef);

  if (closed || dismissedOnDevice !== false) return null;

  const dismissible = Boolean(onDismiss || dismissKey);
  const shownIcon = icon === false ? null : (icon ?? toneIcon[tone]);

  const dismiss = (): void => {
    const node = rootRef.current;
    if (node && holdsFocus(node)) focusNearestOutside(node);
    setClosed(true);
    if (dismissKey) rememberDismissal(dismissKey);
    onDismiss?.();
  };

  return (
    <div
      {...rest}
      ref={composedRef}
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      className={cx('itsm-Banner', className)}
      data-tone={tone}
      data-variant={variant}
    >
      {shownIcon ? <Icon name={shownIcon} size="sm" className="itsm-Banner__icon" /> : null}
      <div className="itsm-Banner__main">
        <div className="itsm-Banner__content">
          {kicker ? <p className="itsm-Banner__kicker">{kicker}</p> : null}
          {title ? <p className="itsm-Banner__title">{title}</p> : null}
          {children !== undefined && children !== null && children !== false ? (
            <div className="itsm-Banner__body">{children}</div>
          ) : null}
        </div>
        {action !== undefined && action !== null && action !== false ? (
          <div className="itsm-Banner__actions">
            <FeedbackAction action={action} onAction={onAction} defaultVariant="secondary" size="sm" />
          </div>
        ) : null}
      </div>
      {dismissible ? (
        <button type="button" className="itsm-Banner__dismiss" aria-label={messages.dismiss} onClick={dismiss}>
          <Icon name="x" size="sm" />
        </button>
      ) : null}
    </div>
  );
}
