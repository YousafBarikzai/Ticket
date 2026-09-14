/**
 * Focus management for overlays.
 *
 * A modal surface has three obligations (WCAG 2.2 SC 2.1.2 and 2.4.3): focus
 * moves into it when it opens, Tab cannot leave it while it is open, and focus
 * returns to whatever opened it when it closes. Dialog and CommandPalette both
 * depend on this, and so will the mobile action sheets.
 *
 * Visibility is judged from the DOM and computed styles, never from layout
 * metrics such as `offsetParent`: those are zero in a server-rendered tree and
 * in jsdom, which would make the trap behave differently in tests than in a
 * browser — exactly the kind of difference that hides a real bug.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

function isHidden(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    if (node instanceof HTMLElement) {
      if (node.hidden) return true;
      if (node.hasAttribute('inert')) return true;
      if (node.getAttribute('aria-hidden') === 'true') return true;
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function isFocusable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches('[disabled]')) return false;
  return !isHidden(element);
}

/** Every element inside `root` that Tab can reach, in tab order. */
export function getFocusableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isFocusable);
}

export interface FocusTrapOptions {
  /** Where focus lands on activation. Defaults to the first focusable element, then the container. */
  readonly initialFocus?: () => HTMLElement | null;
  /** Where focus returns on deactivation. Defaults to whatever was focused before activation. */
  readonly returnFocus?: () => HTMLElement | null;
  /** Set false where the opener is being removed from the DOM anyway. */
  readonly restoreFocus?: boolean;
}

export interface FocusTrap {
  activate(): void;
  deactivate(): void;
}

/**
 * Creates a trap over `container`. Deliberately does not handle Escape: what
 * dismissal means differs per overlay (a dialog may need to confirm), so the
 * component owns it.
 */
export function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}): FocusTrap {
  const doc = container.ownerDocument;
  let previouslyFocused: HTMLElement | null = null;
  let active = false;

  const focusFirst = (): void => {
    const target = options.initialFocus?.() ?? getFocusableElements(container)[0] ?? container;
    if (target === container && !container.hasAttribute('tabindex')) {
      // An overlay with nothing focusable in it still has to receive focus, or
      // the screen reader stays on the page behind it.
      container.setAttribute('tabindex', '-1');
    }
    target.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !active) return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const current = doc.activeElement;

    if (event.shiftKey && (current === first || !container.contains(current))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (current === last || !container.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!active) return;
    const target = event.target;
    if (target instanceof Node && !container.contains(target)) {
      // Something moved focus out programmatically, or the browser did it
      // because the page behind us was clicked. Pull it back.
      focusFirst();
    }
  };

  return {
    activate(): void {
      if (active) return;
      active = true;
      const current = doc.activeElement;
      previouslyFocused = current instanceof HTMLElement ? current : null;
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('focusin', onFocusIn, true);
      focusFirst();
    },
    deactivate(): void {
      if (!active) return;
      active = false;
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('focusin', onFocusIn, true);
      if (options.restoreFocus === false) return;
      const target = options.returnFocus?.() ?? previouslyFocused;
      // Only restore if the opener is still in the document; otherwise the
      // browser's default (body) is the honest answer.
      if (target && target.isConnected) target.focus();
    },
  };
}

/** The hook form. `active` may flip many times over one mount. */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus, returnFocus, restoreFocus } = options;
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const trap = createFocusTrap(container, { initialFocus, returnFocus, restoreFocus });
    trap.activate();
    return () => trap.deactivate();
  }, [containerRef, active, initialFocus, returnFocus, restoreFocus]);
}
