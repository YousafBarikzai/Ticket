'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { formatBadgeCount } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';
import { IconSlot } from '../web/IconSlot.js';

export interface SegmentedOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** Required in `nav` mode: each segment is a link. */
  readonly href?: string;
  readonly count?: number;
}

export interface SegmentedControlProps {
  /** The group's accessible name. */
  readonly label: string;
  readonly options: readonly SegmentedOption[];
  readonly value: string;
  /**
   * `value`: a radio group that selects as focus moves, for local view state
   * (Reply / Internal note). `nav`: links with `aria-current`, for URL scopes
   * (Open / Needs you / All). `commit`: a radio group where arrows move focus
   * and Space or Enter commits, for persisted settings (X-61).
   */
  readonly mode: 'value' | 'nav' | 'commit';
  /** Client only; `value` and `commit` modes. */
  readonly onValueChange?: (value: string) => void;
  readonly size?: 'sm' | 'md';
  readonly fullWidth?: boolean;
  /**
   * When the width runs short (a phone), the segments share it by their words
   * — and, if even that is not enough, wrap onto another row — rather than
   * being cut short in equal parts ("Needs you 1" read as "Needs…"). Where
   * there is room they are equal, as without it. With `fullWidth` the
   * segments also tighten their padding in a narrow container, so four short
   * scopes stay on one row at 320 px.
   */
  readonly wrap?: boolean;
  readonly className?: string;
}

/**
 * Where the thumb sits, measured from the selected segment. Before the first
 * measurement (the server render, the first client render) there is none, and
 * the selected segment draws its own background instead, so the control
 * reads correctly before any script has run and nothing slides in on load.
 */
function useThumb(
  root: RefObject<HTMLElement | null>,
  selectedIndex: number,
  deps: readonly unknown[],
): { readonly ready: boolean; readonly animate: boolean } {
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const thumb = element.querySelector<HTMLElement>(':scope > .itsm-SegmentedControl__thumb');
    const place = (): boolean => {
      const segment = element.querySelectorAll<HTMLElement>('.itsm-SegmentedControl__segment')[selectedIndex];
      if (!thumb || !segment) return false;
      const outer = element.getBoundingClientRect();
      const inner = segment.getBoundingClientRect();
      if (inner.width === 0) return false;
      thumb.style.inlineSize = `${inner.width}px`;
      thumb.style.blockSize = `${inner.height}px`;
      thumb.style.transform = `translate(${inner.left - outer.left - element.clientLeft}px, ${inner.top - outer.top - element.clientTop}px)`;
      return true;
    };
    setReady(place());
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setReady(place()));
    observer.observe(element);
    return () => observer.disconnect();
    // `deps` stand for everything that moves a segment: the options, the size, the width.
  }, [root, selectedIndex, ...deps]);

  // Slides only after the first placement has been painted.
  useEffect(() => {
    if (!ready || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [ready, animate]);

  return { ready, animate };
}

function SegmentBody({ option }: { readonly option: SegmentedOption }): ReactNode {
  return (
    <>
      {option.icon ? <IconSlot icon={option.icon} size="sm" className="itsm-SegmentedControl__icon" /> : null}
      <span className="itsm-SegmentedControl__label" data-text={option.label}>
        {option.label}
      </span>
      {option.count !== undefined ? (
        <>
          <span className="itsm-visually-hidden">, </span>
          <span className="itsm-SegmentedControl__count">{formatBadgeCount(option.count)}</span>
        </>
      ) : null}
    </>
  );
}

/**
 * A row of mutually exclusive segments on a sliding thumb (`fill.secondary`
 * track, raised thumb on the `spring` curve).
 *
 * The three modes are three different promises (X-61). A radio group moves
 * its selection with the arrow keys, which is right when a selection is
 * cheap and private (`value`: which composer tab, which chart) and wrong when
 * it saves a setting or loads a page — every arrow press would save, or
 * navigate. So a persisted setting is `commit` (arrows move focus, Space or
 * Enter chooses) and a scope that lives in the URL is `nav`: real links in a
 * `<nav>`, each its own tab stop, the current one marked `aria-current`, so
 * they open in new tabs, show their address and survive reload.
 */
export function SegmentedControl({
  label,
  options,
  value,
  mode,
  onValueChange,
  size = 'md',
  fullWidth = false,
  wrap = false,
  className,
}: SegmentedControlProps): ReactNode {
  const root = useRef<HTMLElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = Math.max(
    options.findIndex((option) => !option.disabled),
    0,
  );
  // What moves a segment: the labels and counts, the size, the width. A string,
  // so an options array written inline does not re-measure on every render.
  const layoutKey = options
    .map((option) => [option.value, option.label, option.count ?? '', option.icon ?? ''].join('\u0000'))
    .join('\u0001');
  const { ready, animate } = useThumb(root, selectedIndex, [layoutKey, size, fullWidth, wrap]);
  const setRoot = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);
  const Link = useOptionalItsm()?.Link;

  const choose = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled || option.value === value) return;
    onValueChange?.(option.value);
  };

  const roving = useRovingTabIndex({
    count: options.length,
    orientation: 'horizontal',
    loop: true,
    defaultIndex: selectedIndex >= 0 ? selectedIndex : firstEnabled,
    isDisabled: (index) => options[index]?.disabled === true,
    // `value` selects as focus moves; `commit` waits for Space or Enter.
    onMove: mode === 'value' ? choose : undefined,
  });

  // A selection made elsewhere (the URL, another control) moves the tab stop
  // with it — unless somebody is arrowing through the group right now.
  const { setActiveIndex } = roving;
  useEffect(() => {
    if (selectedIndex < 0) return;
    if (root.current?.contains(document.activeElement)) return;
    setActiveIndex(selectedIndex);
  }, [selectedIndex, setActiveIndex]);

  const classes = cx(
    'itsm-SegmentedControl',
    `itsm-SegmentedControl--${size}`,
    fullWidth && 'itsm-SegmentedControl--fullWidth',
    wrap && 'itsm-SegmentedControl--wrap',
    className,
  );
  const state = {
    'data-mode': mode,
    'data-ready': ready ? '' : undefined,
    'data-animate': animate ? '' : undefined,
  };
  const thumb = <span className="itsm-SegmentedControl__thumb" aria-hidden="true" />;

  if (mode === 'nav') {
    return (
      <nav ref={setRoot} aria-label={label} className={classes} {...state}>
        {thumb}
        <ul className="itsm-SegmentedControl__list">
          {options.map((option) => {
            const current = option.value === value;
            if (option.disabled || option.href === undefined) {
              return (
                <li key={option.value}>
                  <span role="link" aria-disabled="true" className="itsm-SegmentedControl__segment" data-selected={current ? '' : undefined}>
                    <SegmentBody option={option} />
                  </span>
                </li>
              );
            }
            const linkProps = {
              href: option.href,
              className: 'itsm-SegmentedControl__segment',
              'aria-current': current ? ('page' as const) : undefined,
              'data-selected': current ? '' : undefined,
            };
            return (
              <li key={option.value}>
                {Link ? (
                  <Link {...linkProps}>
                    <SegmentBody option={option} />
                  </Link>
                ) : (
                  <a {...linkProps}>
                    <SegmentBody option={option} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div ref={setRoot} className={classes} {...state}>
      {thumb}
      <div role="radiogroup" aria-label={label} aria-orientation="horizontal" className="itsm-SegmentedControl__list">
        {options.map((option, index) => {
          const selected = option.value === value;
          const item = roving.getItemProps(index);
          return (
            <button
              key={option.value}
              ref={item.ref}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={option.disabled || undefined}
              tabIndex={item.tabIndex}
              className="itsm-SegmentedControl__segment"
              data-selected={selected ? '' : undefined}
              onFocus={item.onFocus}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  choose(index);
                  return;
                }
                item.onKeyDown(event);
              }}
              onClick={() => {
                choose(index);
                roving.setActiveIndex(index);
              }}
            >
              <SegmentBody option={option} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
