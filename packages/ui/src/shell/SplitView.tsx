'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';
import { useStableId } from '../a11y/ids.js';
import { useRegion } from '../a11y/regions.js';
import { cx } from '../web/cx.js';
import { usePathnameSafe } from './location.js';

export interface SplitPane {
  readonly id: string;
  /** The pane's landmark name; also what F6 lands on. */
  readonly label: string;
  readonly as?: 'section' | 'article' | 'aside';
  /** Pixel bounds and starting width. A pane without `defaultSize` is fluid: it takes the rest. */
  readonly min: number;
  readonly max?: number;
  readonly defaultSize?: number;
  /** The separator's Enter collapses and restores it. */
  readonly collapsible?: boolean;
  readonly children: ReactNode;
}

export interface SplitViewProps {
  readonly panes: readonly SplitPane[];
  /** Remembers pane widths on this device, and scroll positions for this tab. */
  readonly persistKey?: string;
  readonly className?: string;
}

/** Arrow-key step, and the larger one with Shift. */
const STEP = 16;
const BIG_STEP = 64;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type Sizes = Readonly<Record<string, number>>;

function clamp(value: number, pane: SplitPane): number {
  const max = pane.max ?? Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(pane.min, value)));
}

function defaultSizes(panes: readonly SplitPane[]): Sizes {
  const sizes: Record<string, number> = {};
  for (const pane of panes) if (pane.defaultSize !== undefined) sizes[pane.id] = clamp(pane.defaultSize, pane);
  return sizes;
}

function readSizes(key: string | undefined, panes: readonly SplitPane[]): Sizes {
  const sizes: Record<string, number> = { ...defaultSizes(panes) };
  if (!key) return sizes;
  try {
    const raw = window.localStorage.getItem(`itsm-split:${key}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const pane of panes) {
        const value = (parsed as Record<string, unknown>)[pane.id];
        if (pane.defaultSize !== undefined && typeof value === 'number' && Number.isFinite(value)) sizes[pane.id] = clamp(value, pane);
      }
    }
  } catch {
    // Blocked storage: the defaults stand.
  }
  return sizes;
}

function writeSizes(key: string | undefined, sizes: Sizes): void {
  if (!key) return;
  try {
    window.localStorage.setItem(`itsm-split:${key}`, JSON.stringify(sizes));
  } catch {
    // Kept for this page only.
  }
}

/**
 * Which pane a separator resizes: the fixed-width pane before it, or — when
 * that one is fluid — the fixed-width pane after it (then dragging towards
 * it makes it smaller). `sign` is +1 when moving the separator towards the
 * inline end grows the pane.
 */
function controlledBy(panes: readonly SplitPane[], index: number): { readonly pane: SplitPane; readonly sign: 1 | -1 } | null {
  const before = panes[index];
  const after = panes[index + 1];
  if (before?.defaultSize !== undefined) return { pane: before, sign: 1 };
  if (after?.defaultSize !== undefined) return { pane: after, sign: -1 };
  return null;
}

function scrollKey(persistKey: string | undefined, paneId: string, view: string): string {
  return `itsm-split-scroll:${persistKey ?? 'split'}:${paneId}:${view}`;
}

function Pane({
  pane,
  size,
  collapsed,
  persistKey,
  view,
}: {
  readonly pane: SplitPane;
  readonly size: number | undefined;
  readonly collapsed: boolean;
  readonly persistKey: string | undefined;
  readonly view: string;
}): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  useRegion(ref, !collapsed);
  const Tag = pane.as ?? 'section';

  // Back to where this pane was for this view (a list returned to from a
  // ticket opens at the row the person left, X-§1.1). Session storage: a new
  // tab starts at the top, as a new tab should.
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    try {
      const stored = window.sessionStorage.getItem(scrollKey(persistKey, pane.id, view));
      element.scrollTop = stored ? Number(stored) || 0 : 0;
    } catch {
      // Nothing to restore.
    }
  }, [persistKey, pane.id, view]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const onScroll = (event: UIEvent<HTMLElement>): void => {
    const top = event.currentTarget.scrollTop;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(scrollKey(persistKey, pane.id, view), String(Math.round(top)));
      } catch {
        // Not remembered.
      }
    }, 120);
  };

  return (
    <Tag
      ref={ref as RefObject<HTMLElement>}
      id={pane.id}
      aria-label={pane.label}
      tabIndex={-1}
      className="itsm-SplitView__pane itsm-Region"
      data-fluid={pane.defaultSize === undefined || undefined}
      data-collapsed={collapsed || undefined}
      style={pane.defaultSize === undefined ? { minInlineSize: pane.min } : { inlineSize: size, minInlineSize: pane.min }}
      onScroll={onScroll}
    >
      {pane.children}
    </Tag>
  );
}

/**
 * Side-by-side panes that the person can resize — the workbench's list,
 * conversation and details — each scrolling on its own, each an F6 region
 * named for what it holds.
 *
 * The separators are real controls: `role="separator"` with the controlled
 * pane's width as `aria-valuenow`, ← and → (Shift for bigger steps, mirrored
 * right to left), Home and End for the bounds, Enter to collapse a
 * collapsible pane, and a double-click to put it back to its default. A drag
 * does the same with the pointer (never the only way, WCAG 2.5.7).
 *
 * Widths are remembered on this device (`persistKey`); each pane's scroll
 * position is remembered for this tab and this view, so coming back to a
 * list lands where the person left it.
 */
export function SplitView({ panes, persistKey, className }: SplitViewProps): ReactNode {
  const baseId = useStableId('itsm-split');
  const view = usePathnameSafe();
  const [sizes, setSizes] = useState<Sizes>(() => defaultSizes(panes));
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({});
  const drag = useRef<{ readonly index: number; readonly x: number; readonly start: number; readonly id: number } | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  // Stored widths arrive after hydration; the server and the first client
  // render use the defaults, so the markup agrees.
  const paneKey = panes.map((pane) => `${pane.id}:${pane.min}:${pane.max ?? ''}:${pane.defaultSize ?? ''}`).join('|');
  useEffect(() => {
    setSizes(readSizes(persistKey, panes));
    // `paneKey` stands for the panes' geometry; their children change every render.
  }, [persistKey, paneKey]);

  const resize = useCallback(
    (pane: SplitPane, next: number) => {
      setSizes((current) => {
        const value = clamp(next, pane);
        if (current[pane.id] === value) return current;
        const updated = { ...current, [pane.id]: value };
        writeSizes(persistKey, updated);
        return updated;
      });
    },
    [persistKey],
  );

  const direction = (): 1 | -1 => (root.current && getComputedStyle(root.current).direction === 'rtl' ? -1 : 1);

  const onSeparatorKeyDown = (index: number, event: KeyboardEvent<HTMLDivElement>): void => {
    const control = controlledBy(panes, index);
    if (!control) return;
    const { pane, sign } = control;
    const current = sizes[pane.id] ?? pane.defaultSize ?? pane.min;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const towardsEnd = direction();
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        if (collapsed[pane.id]) return;
        resize(pane, current + step * sign * towardsEnd);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (collapsed[pane.id]) return;
        resize(pane, current - step * sign * towardsEnd);
        break;
      case 'Home':
        event.preventDefault();
        resize(pane, pane.min);
        break;
      case 'End':
        event.preventDefault();
        if (pane.max !== undefined) resize(pane, pane.max);
        break;
      case 'Enter':
        if (!pane.collapsible) return;
        event.preventDefault();
        setCollapsed((state) => ({ ...state, [pane.id]: !state[pane.id] }));
        break;
      default:
        break;
    }
  };

  const onPointerDown = (index: number, event: PointerEvent<HTMLDivElement>): void => {
    const control = controlledBy(panes, index);
    if (!control || event.button !== 0 || collapsed[control.pane.id]) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { index, x: event.clientX, start: sizes[control.pane.id] ?? control.pane.defaultSize ?? control.pane.min, id: event.pointerId };
    event.currentTarget.dataset.dragging = '';
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const control = controlledBy(panes, current.index);
    if (!control) return;
    resize(control.pane, current.start + (event.clientX - current.x) * control.sign * direction());
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  };

  return (
    <div ref={root} className={cx('itsm-SplitView', className)}>
      {panes.map((pane, index) => {
        const control = index < panes.length - 1 ? controlledBy(panes, index) : null;
        const controlledPane = control?.pane;
        const isCollapsed = controlledPane ? collapsed[controlledPane.id] === true : false;
        const value = controlledPane ? (isCollapsed ? 0 : (sizes[controlledPane.id] ?? controlledPane.defaultSize ?? controlledPane.min)) : undefined;
        return (
          <Fragment key={pane.id}>
            <Pane pane={pane} size={sizes[pane.id]} collapsed={collapsed[pane.id] === true} persistKey={persistKey} view={view} />
            {controlledPane ? (
              <div
                role="separator"
                tabIndex={0}
                id={`${baseId}-sep-${index}`}
                className="itsm-SplitView__separator"
                aria-orientation="vertical"
                aria-label={`Resize ${controlledPane.label}`}
                aria-controls={controlledPane.id}
                aria-valuenow={value}
                aria-valuemin={isCollapsed ? 0 : controlledPane.min}
                aria-valuemax={controlledPane.max}
                data-collapsed={isCollapsed || undefined}
                onKeyDown={(event) => onSeparatorKeyDown(index, event)}
                onDoubleClick={() => {
                  if (controlledPane.defaultSize !== undefined) resize(controlledPane, controlledPane.defaultSize);
                  setCollapsed((state) => ({ ...state, [controlledPane.id]: false }));
                }}
                onPointerDown={(event) => onPointerDown(index, event)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
