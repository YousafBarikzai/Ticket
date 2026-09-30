'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useRegion } from '../a11y/regions.js';
import { defaultMessages } from '../provider/messages.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { Dialog } from '../web/Dialog.js';
import { IconButton } from '../web/IconButton.js';
import { useFocusReturn } from './focus-return.js';
import { InertOutside } from './inert.js';
import { MD_UP, useMediaQuery } from './media.js';

export type SheetCloseReason = 'escape' | 'scrim' | 'close-button' | 'swipe';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean, reason?: SheetCloseReason) => void;
  /** `auto` (default): from the end edge at md and up, from the bottom below. */
  readonly side?: 'end' | 'start' | 'bottom' | 'auto';
  /** `sm` 400 px, `md` 560 px (default), `lg` 760 px, `full` the whole width. A bottom sheet opens half-height when `sm`. */
  readonly size?: 'sm' | 'md' | 'lg' | 'full';
  readonly title: string;
  readonly description?: string;
  /** Beside the title: a status pill, one meta item. */
  readonly headerMeta?: ReactNode;
  /** Before the close button: "Open full page", "Copy link". */
  readonly headerActions?: ReactNode;
  /** Sticky and opaque. */
  readonly footer?: ReactNode;
  /**
   * `false` makes it an inspector: a dialog without `aria-modal`, no scrim and
   * no focus trap, closed by Escape, reachable with F6.
   */
  readonly modal?: boolean;
  /** Closing asks "Discard changes?". */
  readonly dirty?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly className?: string;
}

type Snap = 'half' | 'full';

/** Pixels a press may travel and still count as a tap on the grab handle. */
const TAP_SLOP = 6;
/** Travel, as a share of the sheet's height, that commits a swipe. */
const SWIPE_SHARE = 0.25;
/** Speed (px/ms) that commits a swipe however short. */
const FLICK_SPEED = 0.5;

/**
 * The bottom sheet's grab handle: drag down to go from full to half height or
 * to dismiss, drag up to expand, or tap to switch heights — dragging is never
 * the only way (WCAG 2.5.7): the close button dismisses, and the content
 * scrolls at either height. Pointer-only and hidden from assistive
 * technology; nothing it does is unavailable from the keyboard.
 */
function useDragToDismiss(panelRef: RefObject<HTMLElement | null>, snap: Snap, setSnap: (snap: Snap) => void, onSwipeClose: () => void) {
  const drag = useRef<{ readonly y: number; readonly t: number; readonly height: number; readonly id: number } | null>(null);

  const move = (offset: number): void => {
    panelRef.current?.style.setProperty('--_drag', `${offset}px`);
  };

  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>): void {
      if (event.button !== 0 || !panelRef.current) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { y: event.clientY, t: event.timeStamp, height: panelRef.current.getBoundingClientRect().height, id: event.pointerId };
      panelRef.current.dataset.dragging = '';
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>): void {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      // Pulling up past the top gives a little, then resists.
      move(dy < 0 ? dy / 3 : dy);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>): void {
      const start = drag.current;
      drag.current = null;
      const panel = panelRef.current;
      if (!start || !panel) return;
      delete panel.dataset.dragging;
      move(0);
      const dy = event.clientY - start.y;
      const speed = dy / Math.max(1, event.timeStamp - start.t);
      if (Math.abs(dy) < TAP_SLOP) {
        setSnap(snap === 'full' ? 'half' : 'full');
        return;
      }
      if (dy > start.height * SWIPE_SHARE || speed > FLICK_SPEED) {
        if (snap === 'full' && dy < start.height * 0.6) setSnap('half');
        else onSwipeClose();
        return;
      }
      if (dy < -start.height * SWIPE_SHARE || speed < -FLICK_SPEED) setSnap('full');
    },
    onPointerCancel(): void {
      drag.current = null;
      if (panelRef.current) delete panelRef.current.dataset.dragging;
      move(0);
    },
  };
}

/**
 * Keeps a closing non-modal sheet on the page until its exit animation ends
 * (Radix's `Presence` does this for the modal one). No animation — reduced
 * motion, jsdom — and it leaves at once.
 */
function usePresence(open: boolean, ref: RefObject<HTMLElement | null>): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const node = ref.current;
    const name = node ? getComputedStyle(node).animationName : 'none';
    if (!node || !name || name === 'none') {
      setMounted(false);
      return;
    }
    const done = (event: Event): void => {
      if (event.target === node) setMounted(false);
    };
    node.addEventListener('animationend', done);
    node.addEventListener('animationcancel', done);
    // Belt and braces: an animation that never reports must not keep it forever.
    const timer = setTimeout(() => setMounted(false), 600);
    return () => {
      node.removeEventListener('animationend', done);
      node.removeEventListener('animationcancel', done);
      clearTimeout(timer);
    };
  }, [open, mounted, ref]);
  return open || mounted;
}

interface PanelProps {
  readonly side: 'end' | 'start' | 'bottom' | 'auto';
  readonly size: 'sm' | 'md' | 'lg' | 'full';
  readonly snap: Snap;
  readonly bottom: boolean;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly headerMeta?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly footer?: ReactNode;
  readonly closeLabel: string;
  readonly onCloseButton: () => void;
  readonly handle: ReturnType<typeof useDragToDismiss>;
  readonly children: ReactNode;
}

/** What both kinds of sheet draw inside their panel. */
function SheetParts({ bottom, title, description, headerMeta, headerActions, footer, closeLabel, onCloseButton, handle, children }: PanelProps): ReactNode {
  return (
    <>
      {bottom ? <div className="itsm-Sheet__handle" aria-hidden="true" {...handle} /> : null}
      <div className="itsm-Sheet__header">
        <div className="itsm-Sheet__heading">
          <div className="itsm-Sheet__titleRow">
            {title}
            {headerMeta ? <div className="itsm-Sheet__meta">{headerMeta}</div> : null}
          </div>
          {description}
        </div>
        {headerActions ? <div className="itsm-Sheet__actions">{headerActions}</div> : null}
        <IconButton className="itsm-Sheet__close" label={closeLabel} icon="x" size="sm" variant="ghost" onClick={onCloseButton} />
      </div>
      <div className="itsm-Sheet__body">{children}</div>
      {footer ? <div className="itsm-Sheet__footer">{footer}</div> : null}
    </>
  );
}

function panelClass(side: PanelProps['side'], size: PanelProps['size'], className?: string): string {
  return cx('itsm-Sheet', `itsm-Sheet--${side}`, `itsm-Sheet--${size}`, className);
}

/**
 * A panel from a screen edge: details, creation flows, the mobile navigation.
 * Opaque, never glass (D6): `surface.overlay`, radius `3xl`, elevation `xl`,
 * floating one panel-inset off the edges, with a sticky opaque footer.
 *
 * **Modal** (default), on the Radix dialog: scrim, focus trap, the page
 * hidden from assistive technology, scroll lock, Escape as the top layer (a
 * menu opened inside closes first). **Non-modal** (`modal={false}`), the
 * inspector: a dialog that says `aria-modal="false"`, with no scrim and no
 * trap, so the page stays usable beside it; Escape inside it closes it, F6
 * reaches it as a region, and a menu opened inside it still closes first.
 *
 * Every close has a reason, and with `dirty` each one first asks "Discard
 * changes?" (focus on *Keep editing*). Focus returns to the invoker.
 *
 * `side="auto"` comes from the end edge at 768 px and up and rises from the
 * bottom below. A bottom sheet has a grab handle, two heights (50 % and
 * 92 %), swipe-down to dismiss beside the close button, and fills the
 * screen when the viewport is under 500 px tall (X-93). It slides over
 * `slow` on the emphasised curve and leaves over `normal`.
 */
export function Sheet({
  open,
  onOpenChange,
  side = 'auto',
  size = 'md',
  title,
  description,
  headerMeta,
  headerActions,
  footer,
  modal = true,
  dirty = false,
  initialFocusRef,
  children,
  className,
}: SheetProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pendingClose, setPendingClose] = useState<SheetCloseReason | null>(null);
  const [snap, setSnap] = useState<Snap>(size === 'sm' ? 'half' : 'full');
  const mdUp = useMediaQuery(MD_UP, true);
  const bottom = side === 'bottom' || (side === 'auto' && !mdUp);

  // Each opening starts at the size's own height.
  useEffect(() => {
    if (open) setSnap(size === 'sm' ? 'half' : 'full');
  }, [open, size]);

  const requestClose = (reason: SheetCloseReason): void => {
    if (dirty) setPendingClose(reason);
    else onOpenChange(false, reason);
  };
  const handle = useDragToDismiss(panelRef, snap, setSnap, () => requestClose('swipe'));
  const keepEditingRef = useRef<HTMLButtonElement | null>(null);

  const discard = (
    <Dialog
      open={open && pendingClose !== null}
      onClose={() => setPendingClose(null)}
      role="alertdialog"
      size="sm"
      title="Discard changes?"
      initialFocusRef={keepEditingRef}
      footer={
        <>
          <Button ref={keepEditingRef} onClick={() => setPendingClose(null)}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const reason = pendingClose ?? 'close-button';
              setPendingClose(null);
              onOpenChange(false, reason);
            }}
          >
            Discard changes
          </Button>
        </>
      }
    >
      <p className="itsm-Sheet__discard">Your changes to {title} haven’t been saved.</p>
    </Dialog>
  );

  const shared = {
    side,
    size,
    snap,
    bottom,
    headerMeta,
    headerActions,
    footer,
    closeLabel: messages.close,
    onCloseButton: () => requestClose('close-button'),
    handle,
    children,
  };

  if (!modal) {
    return (
      <>
        <InspectorSheet
          {...shared}
          open={open}
          panelRef={panelRef}
          titleText={title}
          descriptionText={description}
          initialFocusRef={initialFocusRef}
          className={className}
          onEscape={() => requestClose('escape')}
        />
        {discard}
      </>
    );
  }

  return (
    <>
      <ModalSheet
        {...shared}
        open={open}
        panelRef={panelRef}
        titleText={title}
        descriptionText={description}
        initialFocusRef={initialFocusRef}
        className={className}
        onEscape={() => requestClose('escape')}
        onScrim={() => requestClose('scrim')}
      />
      {discard}
    </>
  );
}

interface VariantProps extends Omit<PanelProps, 'title' | 'description'> {
  readonly open: boolean;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly titleText: string;
  readonly descriptionText?: string;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly onEscape: () => void;
}

function ModalSheet({ open, panelRef, titleText, descriptionText, initialFocusRef, className, onEscape, onScrim, ...parts }: VariantProps & { readonly onScrim: () => void }): ReactNode {
  useFocusReturn(open, panelRef);
  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="itsm-Sheet__scrim"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && event.button === 0) onScrim();
          }}
        />
        <RadixDialog.Content
          ref={panelRef}
          aria-modal="true"
          className={panelClass(parts.side, parts.size, className)}
          data-snap={parts.bottom ? parts.snap : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (initialFocusRef?.current ?? panelRef.current)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onEscape();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetParts
            {...parts}
            title={<RadixDialog.Title className="itsm-Sheet__title">{titleText}</RadixDialog.Title>}
            description={descriptionText ? <RadixDialog.Description className="itsm-Sheet__description">{descriptionText}</RadixDialog.Description> : null}
          />
        </RadixDialog.Content>
        <InertOutside active={open} />
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function InspectorSheet({ open, panelRef, titleText, descriptionText, initialFocusRef, className, onEscape, ...parts }: VariantProps): ReactNode {
  const id = useId();
  const present = usePresence(open, panelRef);
  useFocusReturn(open, panelRef);
  useRegion(panelRef, present);

  useEffect(() => {
    if (!open) return;
    (initialFocusRef?.current ?? panelRef.current)?.focus({ preventScroll: true });
  }, [open, initialFocusRef, panelRef]);

  if (!present || typeof document === 'undefined') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // A menu or list open inside the sheet handles its own Escape first (it
    // is a Radix layer, listening earlier) and marks the event handled.
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onEscape();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={descriptionText ? `${id}-description` : undefined}
      tabIndex={-1}
      data-state={open ? 'open' : 'closed'}
      data-snap={parts.bottom ? parts.snap : undefined}
      data-itsm-region=""
      className={panelClass(parts.side, parts.size, cx('itsm-Sheet--inspector', className))}
      onKeyDown={onKeyDown}
    >
      <SheetParts
        {...parts}
        title={
          <h2 className="itsm-Sheet__title" id={`${id}-title`}>
            {titleText}
          </h2>
        }
        description={
          descriptionText ? (
            <p className="itsm-Sheet__description" id={`${id}-description`}>
              {descriptionText}
            </p>
          ) : null
        }
      />
    </div>,
    document.body,
  );
}
