'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { cx } from '../web/cx.js';
import { isFocusable } from './focus-trap.js';

export interface RegionProps extends Omit<HTMLAttributes<HTMLElement>, 'id' | 'children'> {
  readonly id: string;
  /** The landmark's accessible name, also what a screen reader announces when F6 arrives. */
  readonly label: string;
  readonly as?: 'nav' | 'section' | 'article' | 'aside';
  readonly className?: string;
  readonly children: ReactNode;
}

/** The registry of F6 regions, for the provider and the panes that move focus between them. */
export interface Regions {
  /** Focuses the next registered region in document order, wrapping. */
  focusNext(): void;
  focusPrevious(): void;
  /** Focuses the region with this id, if it is registered and visible. */
  focus(id: string): boolean;
}

/*
 * The registry: module-level, because there is one keyboard. A region
 * registers its element on mount; the one F6 listener exists while any region
 * does. Each region also remembers where focus last was inside it, so F6 back
 * to the ticket list lands on the row the person left, not on the list's
 * outer edge.
 */

const regions = new Set<HTMLElement>();
const lastFocus = new WeakMap<HTMLElement, HTMLElement>();

/** Whether a region can take focus now: on the page, not hidden, not inert, not behind `aria-hidden`. */
function available(region: HTMLElement): boolean {
  return region.isConnected && isFocusable(region);
}

/** Registered regions that can take focus, in document order. */
function ordered(): HTMLElement[] {
  return [...regions].filter(available).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** The innermost registered region holding `element`. */
function regionOf(element: Element | null, list: readonly HTMLElement[]): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const region of list) {
    if (element && region.contains(element) && (!found || found.contains(region))) found = region;
  }
  return found;
}

function enter(region: HTMLElement): void {
  const remembered = lastFocus.get(region);
  if (remembered && remembered !== region && region.contains(remembered) && isFocusable(remembered)) {
    remembered.focus();
    return;
  }
  region.focus();
}

function cycle(direction: 1 | -1): boolean {
  const list = ordered();
  if (list.length === 0) return false;
  const current = regionOf(document.activeElement, list);
  const index = current ? list.indexOf(current) : direction === 1 ? -1 : list.length;
  enter(list[(index + direction + list.length) % list.length]!);
  return true;
}

/** A modal dialog owns the keyboard: F6 must not carry focus out of it to the page behind. */
function modalOpen(): boolean {
  const active = document.activeElement;
  return active?.closest('[aria-modal="true"], [role="alertdialog"], [role="dialog"]:not([aria-modal="false"])') != null && regionOf(active, ordered()) === null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'F6' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (modalOpen()) return;
  if (cycle(event.shiftKey ? -1 : 1)) event.preventDefault();
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  for (const region of regions) if (region !== target && region.contains(target)) lastFocus.set(region, target);
}

/** Adds an element to the F6 cycle until the returned function is called. */
export function registerRegion(element: HTMLElement): () => void {
  regions.add(element);
  if (regions.size === 1) {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
  }
  return () => {
    regions.delete(element);
    if (regions.size > 0) return;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocusIn);
  };
}

/**
 * Registers an element the caller renders itself — a `SplitView` pane, a
 * non-modal sheet — as an F6 region. The element needs an accessible name and
 * `tabIndex={-1}`; `<Region>` does both for the common case.
 */
export function useRegion(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    return registerRegion(element);
  }, [ref, enabled]);
}

/**
 * A landmark that F6 and Shift+F6 cycle through (X-65): the sidebar, the list
 * pane, the conversation, the inspector. `tabIndex={-1}` so it can take focus
 * without joining the tab order, and a name so a screen reader says where
 * focus arrived ("Tickets, region").
 */
export function Region({ id, label, as: Tag = 'section', className, children, ...rest }: RegionProps): ReactNode {
  const ref = useRef<HTMLElement>(null);
  useRegion(ref);
  return (
    <Tag {...rest} ref={ref as never} id={id} aria-label={label} tabIndex={-1} className={cx('itsm-Region', className)} data-itsm-region="">
      {children}
    </Tag>
  );
}

const api: Regions = {
  focusNext: () => void cycle(1),
  focusPrevious: () => void cycle(-1),
  focus(id: string): boolean {
    const region = ordered().find((candidate) => candidate.id === id);
    if (!region) return false;
    enter(region);
    return true;
  },
};

/**
 * Moves focus between regions from code — the workbench's Escape that leaves
 * the conversation for the list, a "Skip to reply" that is really a region
 * jump.
 */
export function useRegions(): Regions {
  return api;
}
