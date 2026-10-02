'use client';

import {
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentPropsWithRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { useStableId } from '../a11y/ids.js';
import { Spinner } from '../feedback/Spinner.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { ButtonVariant, IconName, Size } from '../types.js';
import { AnchoredBubble } from './AnchoredBubble.js';
import { cx } from './cx.js';
import { IconSlot } from './IconSlot.js';
import { useMergedRefs } from './refs.js';
import { VisuallyHidden } from './VisuallyHidden.js';

export type { ButtonVariant } from '../types.js';
export type ButtonSize = Size;

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'type'> {
  /**
   * Emphasis, from the one `primary` action on a surface down to `ghost` for
   * toolbars. Default `secondary`. `subtle` is the deprecated name of
   * `tinted`, accepted until the release after this one.
   */
  readonly variant?: ButtonVariant | 'subtle';
  readonly size?: Size;
  /** `capsule` for the few pill-shaped calls to action (the portal's "New request"). */
  readonly shape?: 'rounded' | 'capsule';
  /**
   * Makes the button a link, rendered with the application's `Link` from
   * `ItsmProvider` and styled identically. With `href`, `ref` receives the
   * anchor. A link cannot be disabled, so a disabled or loading button with
   * an `href` renders as a button until it is usable again.
   */
  readonly href?: string;
  /** A destination outside the product: a plain anchor opening a new tab, with the arrow icon and a spoken warning. */
  readonly external?: boolean;
  /** Passed to the application's `Link`. */
  readonly prefetch?: boolean | null;
  readonly iconStart?: IconName | ReactNode;
  readonly iconEnd?: IconName | ReactNode;
  /** Shows a spinner, marks the button busy and swallows clicks, keeping focus and width. */
  readonly loading?: boolean;
  /** What the spinner means, for screen readers. Default "Loading…". */
  readonly loadingLabel?: string;
  readonly fullWidth?: boolean;
  /**
   * Why the action is unavailable right now — a state gate such as "Needs a
   * connection" or "Publish the form first", never a missing permission
   * (D19). The button stays focusable (`aria-disabled`), carries the reason
   * as its description, and a click or tap shows it beside the button for
   * four seconds and says it aloud (X-80). Pointing at it shows it too.
   */
  readonly disabledReason?: string;
  /**
   * `lock` marks an action that is locked rather than merely unavailable —
   * the demo's disabled features (A3) — with a 14 px lock after the label,
   * drawn only while the button is unavailable (`disabledReason`, `disabled`
   * or `aria-disabled`) and in place of `iconEnd`. Decorative: the reason
   * says why.
   */
  readonly disabledIcon?: 'lock';
  /** Defaults to `button`: a button inside a form that submits by accident is a classic data-loss bug. */
  readonly type?: 'button' | 'submit' | 'reset';
}

/** Icon size per button size: a step below the text so the glyph never outweighs the word. */
const ICON_SIZE = { sm: 'xs', md: 'sm', lg: 'md' } as const;
/** How long a tapped reason stays up (SPEC §4.2). */
const REASON_MS = 4000;
/** Hover delay before the reason shows, the same as a tooltip's. */
const HOVER_DELAY_MS = 500;

type ReasonMode = 'hover' | 'focus' | 'pinned';

/**
 * The reason bubble's state: shown on hover (after a delay), on keyboard
 * focus, and pinned for four seconds by a click or tap; Escape and blur put
 * it away.
 */
function useReasonBubble(reason: string | undefined): {
  readonly open: boolean;
  pin(): void;
  hoverStart(event: PointerEvent<HTMLElement>): void;
  hoverEnd(): void;
  focusStart(element: HTMLElement): void;
  close(): void;
} {
  const [mode, setMode] = useState<ReasonMode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => clearTimer, []);

  // The gate lifted while the bubble was up: it has nothing left to explain.
  useEffect(() => {
    if (reason !== undefined) return;
    clearTimer();
    setMode(null);
  }, [reason]);

  useEffect(() => {
    if (mode === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      clearTimer();
      setMode(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  return {
    open: reason !== undefined && mode !== null,
    pin() {
      if (reason === undefined) return;
      clearTimer();
      setMode('pinned');
      timer.current = setTimeout(() => setMode(null), REASON_MS);
      // Said as well as shown: somebody who pressed it with a screen reader
      // heard the description on focus, but may have moved on since.
      announce(reason, { politeness: 'polite' });
    },
    hoverStart(event) {
      // Never on touch: a tap is the click that pins it.
      if (reason === undefined || event.pointerType === 'touch' || mode !== null) return;
      clearTimer();
      timer.current = setTimeout(() => setMode((current) => current ?? 'hover'), HOVER_DELAY_MS);
    },
    hoverEnd() {
      if (mode === 'pinned' || mode === 'focus') return;
      clearTimer();
      setMode(null);
    },
    focusStart(element) {
      if (reason === undefined) return;
      let keyboard = false;
      try {
        keyboard = element.matches(':focus-visible');
      } catch {
        keyboard = false;
      }
      if (keyboard) setMode((current) => current ?? 'focus');
    },
    close() {
      clearTimer();
      setMode(null);
    },
  };
}

/** The attributes only a `<button>` has, taken off before the same props are spread onto an anchor. */
const BUTTON_ONLY = ['form', 'formAction', 'formEncType', 'formMethod', 'formNoValidate', 'formTarget', 'name', 'value'] as const;

/**
 * The product's button.
 *
 * Six variants, one of them (`primary`) per surface. A filled or tinted
 * button gives slightly under the pointer (scale 0.98, none under reduced
 * motion); ghost buttons, like toolbar controls, only change colour.
 *
 * Unavailable comes in two kinds. `disabled` is the native attribute: the
 * control leaves the tab order and says nothing about why — right when the
 * reason is obvious from the form around it. `disabledReason` is the state
 * gate the person cannot see the cause of (offline, "publish the form
 * first"): the button stays focusable and explains itself (X-80). Neither
 * dims the button with opacity, which would drop its text below AA.
 *
 * `loading` keeps focus where it is (a button that disables itself mid-save
 * throws a keyboard user back to the top of the page), keeps its width (the
 * spinner takes the start icon's place, or sits over the label), and swallows
 * clicks.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  shape = 'rounded',
  href,
  external = false,
  prefetch,
  iconStart,
  iconEnd,
  loading = false,
  loadingLabel,
  fullWidth = false,
  disabledReason,
  disabledIcon,
  type = 'button',
  className,
  children,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  disabled,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: ButtonProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const reasonId = useStableId('itsm-button-reason');
  const own = useRef<HTMLElement | null>(null);
  const mergedRef = useMergedRefs<HTMLElement>(ref as Ref<HTMLElement> | undefined, own);

  const reason = disabledReason && disabledReason.trim() !== '' ? disabledReason : undefined;
  const bubble = useReasonBubble(reason);
  const callerInert = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  // Anything that makes the button refuse a click while staying focusable.
  const inert = loading || reason !== undefined || callerInert;
  const tone = variant === 'subtle' ? 'tinted' : variant;
  const iconSize = ICON_SIZE[size];
  const hasLabel = children !== null && children !== undefined && children !== false && children !== '';
  const spinner = loading ? (iconStart ? 'start' : 'overlay') : null;
  // Locked only while it is unavailable; a busy button is not locked, just busy.
  const locked = disabledIcon === 'lock' && !loading && (reason !== undefined || disabled === true || callerInert);
  const endIcon = locked ? undefined : (iconEnd ?? (external && href ? 'external' : undefined));

  const classes = cx(
    'itsm-Button',
    `itsm-Button--${tone}`,
    `itsm-Button--${size}`,
    shape === 'capsule' && 'itsm-Button--capsule',
    fullWidth && 'itsm-Button--fullWidth',
    className,
  );
  const lockState = locked ? { 'data-locked': '' } : {};

  const content = (
    <>
      {spinner === 'start' ? (
        <Spinner size="sm" className="itsm-Button__spinner" />
      ) : (
        <IconSlot icon={iconStart} size={iconSize} className="itsm-Button__icon" />
      )}
      {hasLabel ? <span className="itsm-Button__label">{children}</span> : null}
      <IconSlot icon={endIcon} size={iconSize} className="itsm-Button__icon" />
      {locked ? <IconSlot icon="lock" size="xs" className="itsm-Button__lock" /> : null}
      {spinner === 'overlay' ? <Spinner size="sm" className="itsm-Button__spinner" data-overlay="" /> : null}
      {loading ? <VisuallyHidden>{loadingLabel ?? messages.loading}</VisuallyHidden> : null}
    </>
  );

  // A link while it is usable; a disabled or busy "link" is a button until it is not.
  if (href !== undefined && !inert && !disabled) {
    const anchorProps: Record<string, unknown> = { ...rest };
    for (const key of BUTTON_ONLY) delete anchorProps[key];
    const shared = {
      ...(anchorProps as AnchorHTMLAttributes<HTMLAnchorElement>),
      ref: mergedRef as Ref<HTMLAnchorElement>,
      className: classes,
      'aria-describedby': describedBy,
      onClick: onClick as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onClick'],
      onPointerEnter: onPointerEnter as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onPointerEnter'],
      onPointerLeave: onPointerLeave as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onPointerLeave'],
      onFocus: onFocus as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onFocus'],
      onBlur: onBlur as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onBlur'],
    };
    if (external) {
      return (
        <a {...shared} href={href} target="_blank" rel="noopener noreferrer">
          {content}
          <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
        </a>
      );
    }
    const Link = itsm?.Link;
    if (Link) {
      return (
        <Link {...shared} href={href} {...(prefetch === undefined ? {} : { prefetch })}>
          {content}
        </Link>
      );
    }
    return (
      <a {...shared} href={href}>
        {content}
      </a>
    );
  }

  return (
    <>
      <button
        {...rest}
        ref={mergedRef as Ref<HTMLButtonElement>}
        type={type}
        // A reason keeps the button focusable, so the reason can be reached.
        disabled={reason === undefined ? disabled : undefined}
        aria-disabled={inert || disabled ? true : undefined}
        aria-busy={loading || undefined}
        aria-describedby={reason === undefined ? describedBy : cx(describedBy, reasonId)}
        className={classes}
        {...lockState}
        data-loading={spinner ?? undefined}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (reason !== undefined) {
            // `preventDefault` also stops a submit button submitting its form.
            event.preventDefault();
            bubble.pin();
            return;
          }
          if (inert) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        onPointerEnter={(event: PointerEvent<HTMLButtonElement>) => {
          bubble.hoverStart(event);
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event: PointerEvent<HTMLButtonElement>) => {
          bubble.hoverEnd();
          onPointerLeave?.(event);
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          bubble.focusStart(event.currentTarget);
          onFocus?.(event);
        }}
        onBlur={(event: FocusEvent<HTMLButtonElement>) => {
          bubble.close();
          onBlur?.(event);
        }}
      >
        {content}
      </button>
      {reason !== undefined ? (
        <>
          {/* Hidden, not visually hidden: a description may point at hidden text, and nobody tabs past it twice. */}
          <span id={reasonId} hidden>
            {reason}
          </span>
          <AnchoredBubble anchorRef={own} open={bubble.open} tone="note" side="top">
            {reason}
          </AnchoredBubble>
        </>
      ) : null}
    </>
  );
}
