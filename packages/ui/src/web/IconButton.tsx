'use client';

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentPropsWithRef,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName, Size } from '../types.js';
import { cx } from './cx.js';
import { IconSlot } from './IconSlot.js';
import { useMergedRefs } from './refs.js';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'type' | 'aria-label'> {
  /**
   * Required, and there is no `children` escape hatch: an icon-only control
   * with no accessible name is the single most common WCAG 4.1.2 failure, so
   * the type system asks for the name rather than a linter catching it later.
   */
  readonly label: string;
  /** A registry icon, or a node. A string that is not a registry name (a legacy glyph) is drawn as text. */
  readonly icon: IconName | ReactNode;
  readonly variant?: 'ghost' | 'secondary' | 'tinted';
  readonly size?: Size;
  /**
   * The label (and shortcut) in a tooltip on hover and keyboard focus.
   * Defaults to the provider's `features.tooltips` — on in admin and the
   * workbench, off in the portal, on outside a provider.
   */
  readonly tooltip?: boolean;
  /** A shortcut in the hotkey notation (`mod+k`, `]`). Announced with `aria-keyshortcuts` and shown in the tooltip; binding it is the caller's job. */
  readonly shortcut?: string;
  /** Makes it a link (the provider's `Link`), for navigation that happens to be an icon. */
  readonly href?: string;
  /** A toggle ("Pin", "Bold"): sets `aria-pressed` and the selected look. */
  readonly pressed?: boolean;
  readonly type?: 'button' | 'submit' | 'reset';
}

const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'lg' } as const;
/** Hover delay before a tooltip shows, and the window in which the next one shows at once (SPEC §4.3). */
const SHOW_DELAY_MS = 500;
const SKIP_DELAY_MS = 300;
/** Time allowed to move the pointer from the button onto its tooltip (WCAG 1.4.13, hoverable). */
const GRACE_MS = 120;

/** The tooltip, fetched on first intent. It is supplementary, so if the fetch fails there is simply no tooltip. */
const LazyTooltip = lazy(() =>
  import('./IconButtonTooltip.js').then(
    (module) => ({ default: module.IconButtonTooltip }),
    () => ({ default: () => null }),
  ),
);

/* -------------------------------------------------------------------------
 * Page-wide tooltip memory: one tooltip at a time, and the skip delay.
 * ---------------------------------------------------------------------- */

let lastClosedAt = 0;
/** The open tooltip's closer, as its button's ref object (stable across renders, unlike the function in it). */
let openTooltip: { readonly current: () => void } | null = null;
let lastNavigationKeyAt = 0;
let keyWatcherInstalled = false;

const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F6']);

/**
 * Remembers when focus was last moved from the keyboard. A tooltip opens on
 * focus only then: a dialog that focuses its close button as it opens, or a
 * menu handing focus back to its trigger, is the page moving focus, and a
 * bubble popping up over it is noise.
 */
function watchNavigationKeys(doc: Document): void {
  if (keyWatcherInstalled) return;
  keyWatcherInstalled = true;
  doc.addEventListener(
    'keydown',
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) lastNavigationKeyAt = Date.now();
    },
    { capture: true, passive: true },
  );
}

function focusedByKeyboard(element: HTMLElement): boolean {
  if (Date.now() - lastNavigationKeyAt > 1000) return false;
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

type Phase = 'closed' | 'waiting' | 'open' | 'suppressed';

/**
 * A square button that is only an icon.
 *
 * Min 28 px (24 in compact density), with a 44 px hit area on touch screens
 * that does not change the layout. It changes colour under the pointer but
 * never scales: it is a toolbar control, not a call to action.
 *
 * The tooltip is loaded the first time it is wanted and rendered beside the
 * button rather than around it, so the button is never remounted under the
 * pointer or the focus (see `AnchoredBubble`).
 */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  tooltip,
  shortcut,
  href,
  pressed,
  type = 'button',
  className,
  ref,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  ...rest
}: IconButtonProps): ReactNode {
  const itsm = useOptionalItsm();
  const tooltips = tooltip ?? itsm?.features.tooltips ?? true;
  const own = useRef<HTMLElement | null>(null);
  const mergedRef = useMergedRefs<HTMLElement>(ref as Ref<HTMLElement> | undefined, own);

  const [wanted, setWanted] = useState(false);
  const [phase, setPhase] = useState<Phase>('closed');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const close = (next: Phase = 'closed'): void => {
    clearTimer();
    setPhase((current) => {
      if (current === 'open') lastClosedAt = Date.now();
      return next;
    });
  };

  const closeSelf = useRef<() => void>(() => undefined);
  closeSelf.current = () => close();

  const open = (): void => {
    clearTimer();
    // One tooltip on the page at a time.
    if (openTooltip && openTooltip !== closeSelf) openTooltip.current();
    openTooltip = closeSelf;
    setWanted(true);
    setPhase('open');
  };

  useEffect(() => {
    if (tooltips) watchNavigationKeys(document);
  }, [tooltips]);

  useEffect(
    () => () => {
      clearTimer();
      if (openTooltip === closeSelf) openTooltip = null;
    },
    [],
  );

  // Escape dismisses without moving focus (WCAG 1.4.13, dismissible).
  useEffect(() => {
    if (phase !== 'open') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close('suppressed');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  const disabled = rest.disabled === true;
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  const intent = {
    onPointerEnter(event: PointerEvent<HTMLElement>): void {
      if (!tooltips || disabled || event.pointerType === 'touch') return;
      setWanted(true);
      if (phase === 'open' || phase === 'suppressed') {
        clearTimer();
        return;
      }
      if (Date.now() - lastClosedAt < SKIP_DELAY_MS) {
        open();
        return;
      }
      clearTimer();
      setPhase('waiting');
      timer.current = setTimeout(open, SHOW_DELAY_MS);
    },
    onPointerLeave(): void {
      if (!tooltips) return;
      if (phase === 'suppressed' || phase === 'waiting') {
        close();
        return;
      }
      if (phase !== 'open') return;
      clearTimer();
      timer.current = setTimeout(() => close(), GRACE_MS);
    },
    onPointerDown(): void {
      // A click is not a question about what the button is.
      if (tooltips && phase !== 'closed') close('suppressed');
    },
    onFocus(event: FocusEvent<HTMLElement>): void {
      // Focus the page moved (a dialog opening onto its close button) neither
      // shows the tooltip nor fetches it.
      if (!tooltips || disabled || !focusedByKeyboard(event.currentTarget)) return;
      open();
    },
    onBlur(): void {
      if (tooltips && phase !== 'closed') close();
    },
  };

  const shared = {
    className: cx('itsm-IconButton', `itsm-IconButton--${variant}`, `itsm-IconButton--${size}`, className),
    'aria-label': label,
    'aria-keyshortcuts': shortcut ? ariaKeyShortcuts(shortcut) : undefined,
    'data-tooltip': phase === 'open' ? 'open' : undefined,
  };
  const glyph = <IconSlot icon={icon} size={ICON_SIZE[size]} className="itsm-IconButton__icon" />;

  const bubble = wanted ? (
    <Suspense fallback={null}>
      <LazyTooltip
        anchorRef={own}
        open={phase === 'open'}
        label={label}
        {...(shortcut ? { shortcut } : {})}
        onPointerEnter={() => clearTimer()}
        onPointerLeave={() => close()}
      />
    </Suspense>
  ) : null;

  if (href !== undefined && !disabled) {
    const Link = itsm?.Link;
    const anchorProps = {
      ...(rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>),
      ...shared,
      ref: mergedRef as Ref<HTMLAnchorElement>,
      'aria-current': rest['aria-current'],
      onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerEnter(event);
        (onPointerEnter as ((event: PointerEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
      },
      onPointerLeave: (event: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerLeave();
        (onPointerLeave as ((event: PointerEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
      },
      onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerDown();
        (onPointerDown as ((event: PointerEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
      },
      onFocus: (event: FocusEvent<HTMLAnchorElement>) => {
        intent.onFocus(event);
        (onFocus as ((event: FocusEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
      },
      onBlur: (event: FocusEvent<HTMLAnchorElement>) => {
        intent.onBlur();
        (onBlur as ((event: FocusEvent<HTMLAnchorElement>) => void) | undefined)?.(event);
      },
    };
    return (
      <>
        {Link ? (
          <Link {...anchorProps} href={href}>
            {glyph}
          </Link>
        ) : (
          <a {...anchorProps} href={href}>
            {glyph}
          </a>
        )}
        {bubble}
      </>
    );
  }

  return (
    <>
      <button
        {...rest}
        {...shared}
        ref={mergedRef as Ref<HTMLButtonElement>}
        type={type}
        aria-pressed={pressed === undefined ? rest['aria-pressed'] : pressed}
        onPointerEnter={(event) => {
          intent.onPointerEnter(event);
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          intent.onPointerLeave();
          onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          intent.onPointerDown();
          onPointerDown?.(event);
        }}
        onFocus={(event) => {
          intent.onFocus(event);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          intent.onBlur();
          onBlur?.(event);
        }}
      >
        {glyph}
      </button>
      {bubble}
    </>
  );
}
