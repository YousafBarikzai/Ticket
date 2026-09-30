/**
 * Where focus goes when the thing holding it is about to disappear: a banner
 * being dismissed, a connection tray closing as its last item is sent.
 *
 * Left alone, focus falls back to `<body>`, and the next Tab starts again from
 * the top of the page — for a keyboard user, dismissing a notice would mean
 * losing their place. So focus moves to the next focusable element after the
 * one going away, in document order, or the one before it at the end of the
 * page; which is where a sighted person's eye goes too.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function usable(element: HTMLElement): boolean {
  return !element.closest('[hidden], [inert], [aria-hidden="true"]');
}

/**
 * Moves focus to the nearest usable focusable element outside `leaving`:
 * the next one after it, else the last one before it. Returns whether it
 * found one. Call it while `leaving` is still in the document.
 */
export function focusNearestOutside(leaving: Element): boolean {
  const candidates = Array.from(leaving.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !leaving.contains(element) && usable(element),
  );
  const after = candidates.find((element) => leaving.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = candidates.reverse().find((element) => leaving.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
  const target = after ?? before;
  if (!target) return false;
  target.focus();
  return target.ownerDocument.activeElement === target;
}

/** Whether focus is currently inside `element`. */
export function holdsFocus(element: Element | null): boolean {
  if (!element) return false;
  const active = element.ownerDocument.activeElement;
  return active !== null && element.contains(active);
}
