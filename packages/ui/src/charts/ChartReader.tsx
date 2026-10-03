'use client';

import { useId, useRef, useState, type ComponentType, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { cx } from '../web/cx.js';
import type { SeriesStyle } from './common.js';
import type { SeriesSlot } from './scale.js';
import type { ChartTone } from './types.js';

/** One value in a reading: a series at one position, already formatted. */
export interface ReaderRow {
  readonly id: string;
  /** The series name; empty for a chart of one series, whose title already says what it is. */
  readonly label: string;
  readonly value: string;
  readonly slot?: SeriesSlot;
  /** A state's colour for the key (a P1 part, a breached series); wins over `slot`, as on the mark. */
  readonly tone?: ChartTone;
  /** A comparison or forecast series is keyed as its line is drawn. */
  readonly style?: SeriesStyle;
  /** For the crosshair: where the series' marker sits, 0 at the top of the plot and 1 at the bottom. */
  readonly y?: number;
}

/** One position a reader can stop at: a date on a line chart, a bar, a donut segment. */
export interface ReaderPoint {
  readonly key: string;
  /** What the position is: "Tue 3 Sep 2026", "Email". */
  readonly title: string;
  /** Where its tooltip points, as fractions of the plot (x from the left, y from the top). */
  readonly at: readonly [number, number];
  readonly rows: readonly ReaderRow[];
  /** Where Enter goes from this position: the tickets behind a day, a bar or a row. */
  readonly href?: string;
}

export interface ChartReaderProps {
  /** The chart's title: the name of the focusable group. */
  readonly label: string;
  readonly points: readonly ReaderPoint[];
  /** `crosshair` for lines and areas (a hairline and a dot per series); `marks` for bars and segments (the mark lifts). */
  readonly mode: 'crosshair' | 'marks';
  /** The direction the arrow keys move in: along x (← →) or down the rows (↑ ↓ as well). */
  readonly axis?: 'x' | 'y';
  /** Whether a pointer anywhere in the plot reads the nearest position, or only one over a mark. */
  readonly nearest?: boolean;
  /** Where the tooltip sits: beside the anchor (default) or above it. */
  readonly placement?: 'beside' | 'above';
  readonly hint?: string;
  readonly className?: string;
  /** The static plot. Every mark that can be read carries `data-point="<index>"`. */
  readonly children: ReactNode;
}

/** What the group forwards to the core once it has arrived. */
export interface ReaderHandlers {
  key(event: KeyboardEvent<HTMLDivElement>): void;
  pointer(event: PointerEvent<HTMLDivElement>): void;
  leave(): void;
  blur(event: FocusEvent<HTMLDivElement>): void;
}

/** What the core is handed by the island it lives in. */
export interface ReaderCoreProps extends ChartReaderProps {
  /** The focusable group: the core reads its box and marks its marks. */
  readonly root: RefObject<HTMLDivElement | null>;
  /** The core puts its handlers here; the group calls them from then on. */
  readonly handlers: { current: ReaderHandlers | null };
  /** Keys pressed before the core arrived, oldest first, for it to replay. */
  readonly queued: string[];
  /** Writes the polite readout, which the island holds so it exists before anything is said. */
  readonly say: (words: string) => void;
}

/** The core's module, fetched once for every chart on the page. A failed fetch is forgotten, so the next intent tries again. */
let core: Promise<{ readonly ReaderCore: ComponentType<ReaderCoreProps> }> | undefined;

/**
 * The client layer over a static chart (A8 §5, v2 X-69), split in two so a
 * page pays for hover only when someone hovers.
 *
 * This island is what ships with the page (≤ 800 B): the one tab stop — a
 * `group` named by the chart, `aria-roledescription="chart"`, described by
 * "Use ← → to read values" — and the polite live region, empty until someone
 * reads. On the first sign of intent (the pointer arriving, focus, a key) it
 * fetches `reader-core.tsx`, which does the reading: hit-testing, the
 * crosshair, the tooltip, the arrow keys, Enter to follow a position's link.
 * Until it lands the chart is complete without it (the caption and the
 * "View as table" twin carry every value), and the keys pressed meanwhile
 * are kept, up to eight, and replayed in order, so a keyboard user hears the
 * first reading without pressing again.
 *
 * `data-reader` says where it is: `idle`, `loading`, `ready`.
 */
export function ChartReader(props: ChartReaderProps): ReactNode {
  const { label, axis = 'x', hint, className, children } = props;
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef<ReaderHandlers | null>(null);
  const queued = useRef<string[]>([]);
  // `null` until there is intent, then `0` while the core is on its way, then the core.
  const [Core, setCore] = useState<ComponentType<ReaderCoreProps> | 0 | null>(null);
  const [readout, setReadout] = useState('');

  const load = (): void => {
    if (Core !== null) return;
    setCore(0);
    (core ??= import('./reader-core.js')).then(
      (module) => setCore(() => module.ReaderCore),
      () => {
        core = undefined;
        setCore(null);
      },
    );
  };
  const pointer = (event: PointerEvent<HTMLDivElement>): void => (handlers.current ? handlers.current.pointer(event) : load());

  return (
    <div
      ref={root}
      className={cx('itsm-ChartReader', className)}
      role="group"
      aria-roledescription="chart"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      data-reader={Core ? 'ready' : Core === 0 ? 'loading' : 'idle'}
      onFocus={load}
      onPointerEnter={load}
      onPointerMove={pointer}
      onPointerDown={pointer}
      onPointerLeave={() => handlers.current?.leave()}
      onBlur={(event) => handlers.current?.blur(event)}
      onKeyDown={(event) => {
        if (handlers.current) return handlers.current.key(event);
        // Only the reading keys, and ↑ ↓ only where they read: elsewhere they scroll the page.
        if (!(event.altKey || event.ctrlKey || event.metaKey) && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(event.key) && (axis === 'y' || !/Up|Do/.test(event.key))) {
          event.preventDefault();
          if (queued.current.length < 8) queued.current.push(event.key);
        }
        load();
      }}
    >
      {children}
      {/* Hidden: it is the group's description, and browse mode should not read it a second time as content. */}
      <span id={hintId} hidden>
        {hint ?? `Use ${axis === 'y' ? '↑ ↓' : '← →'} to read values`}
      </span>
      <span className="itsm-visually-hidden" aria-live="polite" aria-atomic="true">
        {readout}
      </span>
      {Core ? <Core {...props} root={root} handlers={handlers} queued={queued.current} say={setReadout} /> : null}
    </div>
  );
}
