'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { Count } from '../display/Count.js';
import { toneIcon } from '../feedback/tone.js';
import { Icon } from '../icons/Icon.js';
import { MD_UP, useMediaQuery } from '../overlays/media.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';
import { IconSlot } from '../web/IconSlot.js';

export interface FilterPillOption {
  readonly value: string;
  readonly label: string;
  /** How many items the filter matches, drawn as a small `Count` and spoken with the label ("New, 9"). `null` or absent draws nothing. */
  readonly count?: number | null;
  /** The source stopped counting at `count` ("999+" from a capped API count): drawn "12+", spoken "12 or more". */
  readonly countCapped?: boolean;
  /** Colours the pill's icon (a 14 px glyph before the label): "Breached" is `danger` with `circle-alert`. */
  readonly tone?: Tone;
  /** The icon before the label; with a `tone` and no icon, the tone's own glyph. */
  readonly icon?: IconName;
  /** Required in `nav` mode: each pill is a link. Ignored in the other modes. */
  readonly href?: string;
  /** Shown, reachable and explained by its label, but cannot be chosen. */
  readonly disabled?: boolean;
}

export interface FilterPillsProps {
  /** The group's accessible name: what the pills filter ("Filter by status"). */
  readonly label: string;
  readonly options: readonly FilterPillOption[];
  /** The current pill (`nav`, `single`) or pills (`toggle`). */
  readonly value: string | readonly string[];
  /**
   * `nav`: links in a `<nav>`, the current one `aria-current="page"`, for
   * filters that live in the URL and load a page. `toggle`: independent
   * `aria-pressed` buttons, any number on ("Mine", "Unassigned"). `single`:
   * a radio group, one pill at a time; the arrow keys move focus and Space,
   * Enter or a click chooses (the `SegmentedControl` `commit` promise, X-61),
   * because choosing reloads a list.
   */
  readonly mode: 'nav' | 'toggle' | 'single';
  /** Client only; `toggle` (the new list of values) and `single` (the chosen value). */
  readonly onValueChange?: (value: string | readonly string[]) => void;
  /** "Showing 16 of 294", after the last pill; it also describes the group. */
  readonly summary?: string;
  /** `md` (default) 28 px pills; `sm` 26 px. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/* -------------------------------------------------------------------------
 * The phone cap: at most two lines, the rest behind "More".
 * ---------------------------------------------------------------------- */

export interface PillOverflowInput {
  /** Each pill's width, in order. */
  readonly widths: readonly number[];
  /** Pills that must stay in view (the current or pressed ones). */
  readonly keep: readonly boolean[];
  /** The "More" button's width. */
  readonly more: number;
  /** The width the pills wrap in. */
  readonly available: number;
  /** The gap between two pills on a line. */
  readonly gap: number;
  /** Lines allowed; two on a phone (X-m13). */
  readonly lines?: number;
}

/** How many lines a row of `widths` wraps onto, filled in order the way `flex-wrap` fills them. */
function linesFor(widths: readonly number[], available: number, gap: number): number {
  let lines = 0;
  let used = 0;
  for (const width of widths) {
    // Half a pixel of slack: measured widths are fractional, and a row that
    // fits to the sub-pixel must not be counted as wrapping.
    if (lines === 0 || used + gap + width > available + 0.5) {
      lines += 1;
      used = width;
    } else {
      used += gap + width;
    }
  }
  return lines;
}

/**
 * Which pills to put behind "More" so the row, "More" included, takes at
 * most `lines` lines: none when everything fits; otherwise pills from the
 * end, never one that must stay in view, until it fits (or nothing more can
 * go). Pure arithmetic over measured widths, so it is tested without a
 * layout engine; with nothing measured (no width) it hides nothing.
 */
export function planPillOverflow({ widths, keep, more, available, gap, lines = 2 }: PillOverflowInput): number[] {
  if (!(available > 0) || widths.length === 0) return [];
  if (linesFor(widths, available, gap) <= lines) return [];
  const hidden = new Set<number>();
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    if (keep[index]) continue;
    hidden.add(index);
    const shown = widths.filter((_, position) => !hidden.has(position));
    if (linesFor([...shown, more], available, gap) <= lines) break;
  }
  return [...hidden].sort((a, b) => a - b);
}

const NONE: readonly string[] = [];
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Measures the row on a phone and returns the values that do not fit on two
 * lines. Every pill stays measurable while it is behind "More" (it is parked
 * out of the flow and out of sight, not removed), so the plan can be redone
 * from real widths whenever the row's box changes size.
 */
function usePhoneOverflow(
  root: { readonly current: HTMLElement | null },
  list: { readonly current: HTMLElement | null },
  options: readonly FilterPillOption[],
  selected: ReadonlySet<string>,
  active: boolean,
): readonly string[] {
  const [plan, setPlan] = useState<readonly string[]>(NONE);
  // Strings, so options or a value written inline do not re-measure on every render.
  const layoutKey = options.map((option) => [option.value, option.label, option.count ?? '', option.icon ?? '', option.tone ?? ''].join('\u0000')).join('\u0001');
  const selectedKey = JSON.stringify([...selected]);

  useIsomorphicLayoutEffect(() => {
    if (!active) {
      setPlan(NONE);
      return;
    }
    const box = root.current;
    const row = list.current;
    if (!box || !row) return;
    const measure = (): void => {
      const items = [...row.querySelectorAll<HTMLElement>(':scope > [data-pill-item]')];
      const more = row.querySelector<HTMLElement>(':scope > [data-pill-more]');
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      const hidden = planPillOverflow({
        widths: items.map((item) => item.getBoundingClientRect().width),
        keep: options.map((option) => selected.has(option.value)),
        more: more?.getBoundingClientRect().width ?? 0,
        available: box.clientWidth,
        gap,
      });
      const values = hidden.map((index) => options[index]?.value).filter((value): value is string => value !== undefined);
      setPlan((current) => (sameValues(current, values) ? current : values));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // The outer box, not the row: the row's own size changes with the plan.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
    // `layoutKey` and `selectedKey` stand for `options` and `selected`.
  }, [active, layoutKey, selectedKey]);

  return active ? plan : NONE;
}

/* -------------------------------------------------------------------------
 * The pills
 * ---------------------------------------------------------------------- */

function PillBody({ option, on, locale }: { readonly option: FilterPillOption; readonly on: boolean; readonly locale: string | undefined }): ReactNode {
  const icon = option.icon ?? (option.tone && option.tone !== 'neutral' ? toneIcon[option.tone] : undefined);
  return (
    <>
      {icon ? <IconSlot icon={icon} size="xs" className="itsm-FilterPills__icon" /> : null}
      <span className="itsm-FilterPills__label" data-text={option.label}>
        {option.label}
      </span>
      {option.count === undefined || option.count === null ? null : (
        <Count value={option.count} capped={option.countCapped} size="sm" tone={on ? 'accent' : 'neutral'} locale={locale} className="itsm-FilterPills__count" />
      )}
    </>
  );
}

/**
 * Counted filter pills — "All 16 · New 4 · In progress 7 · Breached 1" — above
 * a list or a register (v3 §2.14, A1 §7.6).
 *
 * Three modes, three promises: `nav` is links (each a page with its own
 * address, so it opens in a new tab and survives reload), `toggle` is
 * pressed buttons that combine, `single` is a radio group of exclusive
 * filters whose arrows move focus without reloading the list on every press.
 *
 * The row **wraps**; it never scrolls sideways (a filter scrolled out of
 * sight is a filter nobody knows is there). On a phone it takes at most two
 * lines: whatever does not fit goes behind a "More" disclosure at the end of
 * the second line, which shows the rest in place. The current or pressed
 * pills always stay in view, so the row never hides the filter in force, and
 * in `single` mode the arrow keys skip what is behind "More". The cap is
 * worked out after the first client render (the server cannot know the
 * width), so a long row on a phone settles to two lines once the page is
 * interactive.
 *
 * A pill's count is the shared `Count`; the pill is named "New, 9", and a
 * capped count "Unassigned, 99 or more".
 */
export function FilterPills({ label, options, value, mode, onValueChange, summary, size = 'md', className }: FilterPillsProps): ReactNode {
  const itsm = useOptionalItsm();
  const Link = itsm?.Link;
  const locale = itsm?.locale;
  const summaryId = useStableId('itsm-filter-pills-summary');
  const listId = useStableId('itsm-filter-pills');
  const root = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLElement | null>(null);
  const setList = useCallback((node: HTMLElement | null) => {
    list.current = node;
  }, []);

  const values = typeof value === 'string' ? [value] : value;
  // Keyed by content rather than identity, so a value array written inline
  // does not make a new set (and a new measurement) on every render.
  const selectedKey = JSON.stringify(values);
  const selected = useMemo(() => new Set(JSON.parse(selectedKey) as string[]), [selectedKey]);

  const phone = !useMediaQuery(MD_UP, true);
  const [expanded, setExpanded] = useState(false);
  // The first pill "More" revealed, to take focus once it is in view.
  const revealed = useRef<string | null>(null);
  const overflow = usePhoneOverflow(root, list, options, selected, phone);
  const parked = useMemo(() => new Set(expanded ? NONE : overflow), [expanded, overflow]);
  // Once nothing is behind "More" there is nothing to expand.
  useEffect(() => {
    if (overflow.length === 0 && expanded) setExpanded(false);
  }, [overflow, expanded]);
  // The pills "More" shows appear before it, in their own places; focus goes
  // to the first of them (as "Load more" does), or a keyboard or screen-reader
  // user would have to go back to find what they asked to see.
  useIsomorphicLayoutEffect(() => {
    const value = revealed.current;
    revealed.current = null;
    if (!expanded || value === null) return;
    const pill = [...(root.current?.querySelectorAll<HTMLElement>('.itsm-FilterPills__pill[data-value]') ?? [])].find((element) => element.dataset.value === value);
    pill?.focus();
  }, [expanded]);

  const selectedIndex = mode === 'single' ? options.findIndex((option) => selected.has(option.value)) : -1;
  const firstEnabled = Math.max(
    options.findIndex((option) => !option.disabled),
    0,
  );
  const roving = useRovingTabIndex({
    count: options.length,
    orientation: 'horizontal',
    loop: true,
    defaultIndex: selectedIndex >= 0 ? selectedIndex : firstEnabled,
    // A pill behind "More" is out of reach of the arrows until it is shown.
    isDisabled: (index) => {
      const option = options[index];
      return option === undefined || option.disabled === true || parked.has(option.value);
    },
  });

  // A choice made elsewhere (the URL, another control) moves the tab stop with it.
  const { setActiveIndex } = roving;
  useEffect(() => {
    if (mode !== 'single' || selectedIndex < 0) return;
    if (root.current?.contains(document.activeElement)) return;
    setActiveIndex(selectedIndex);
  }, [mode, selectedIndex, setActiveIndex]);

  const choose = (option: FilterPillOption): void => {
    if (option.disabled) return;
    if (mode === 'single') {
      if (!selected.has(option.value)) onValueChange?.(option.value);
      return;
    }
    if (mode === 'toggle') {
      onValueChange?.(selected.has(option.value) ? values.filter((current) => current !== option.value) : [...values, option.value]);
    }
  };

  const describedBy = summary ? summaryId : undefined;
  const showMore = phone && overflow.length > 0;
  const more = phone ? (
    <MoreButton
      key="more"
      controls={listId}
      expanded={expanded}
      hidden={expanded ? 0 : overflow.length}
      parked={!showMore}
      locale={locale}
      onToggle={() => {
        if (!expanded) {
          const reachable = (option: FilterPillOption): boolean => !option.disabled && (mode !== 'nav' || option.href !== undefined);
          revealed.current = options.find((option) => overflow.includes(option.value) && reachable(option))?.value ?? null;
        }
        setExpanded((open) => !open);
      }}
      asListItem={mode === 'nav'}
    />
  ) : null;

  let group: ReactNode;
  if (mode === 'nav') {
    group = (
      <nav aria-label={label} aria-describedby={describedBy} className="itsm-FilterPills__group">
        <ul ref={setList} id={listId} className="itsm-FilterPills__list">
          {options.map((option) => {
            const on = selected.has(option.value);
            const body = <PillBody option={option} on={on} locale={locale} />;
            const item = { className: 'itsm-FilterPills__item', 'data-pill-item': '', 'data-overflow': parked.has(option.value) ? '' : undefined };
            if (option.disabled || option.href === undefined) {
              return (
                <li key={option.value} {...item}>
                  <span role="link" aria-disabled="true" className="itsm-FilterPills__pill" data-value={option.value} data-tone={option.tone} data-on={on ? '' : undefined}>
                    {body}
                  </span>
                </li>
              );
            }
            const linkProps = {
              href: option.href,
              className: 'itsm-FilterPills__pill',
              'data-value': option.value,
              'aria-current': on ? ('page' as const) : undefined,
              'data-tone': option.tone,
              'data-on': on ? '' : undefined,
            };
            return (
              <li key={option.value} {...item}>
                {Link ? <Link {...linkProps}>{body}</Link> : <a {...linkProps}>{body}</a>}
              </li>
            );
          })}
          {more}
        </ul>
      </nav>
    );
  } else {
    group = (
      <div
        ref={setList}
        id={listId}
        role={mode === 'single' ? 'radiogroup' : 'group'}
        aria-label={label}
        aria-describedby={describedBy}
        aria-orientation={mode === 'single' ? 'horizontal' : undefined}
        className="itsm-FilterPills__group itsm-FilterPills__list"
      >
        {options.map((option, index) => {
          const on = selected.has(option.value);
          const isParked = parked.has(option.value);
          const shared = {
            type: 'button' as const,
            className: 'itsm-FilterPills__pill itsm-FilterPills__item',
            'data-value': option.value,
            'data-pill-item': '',
            'data-overflow': isParked ? '' : undefined,
            'data-tone': option.tone,
            'data-on': on ? '' : undefined,
            'aria-disabled': option.disabled || undefined,
          };
          if (mode === 'toggle') {
            return (
              <button key={option.value} {...shared} aria-pressed={on} tabIndex={isParked ? -1 : undefined} onClick={() => choose(option)}>
                <PillBody option={option} on={on} locale={locale} />
              </button>
            );
          }
          const item = roving.getItemProps(index);
          return (
            <button
              key={option.value}
              {...shared}
              ref={item.ref}
              role="radio"
              aria-checked={on}
              tabIndex={item.tabIndex}
              onFocus={item.onFocus}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  choose(option);
                  return;
                }
                item.onKeyDown(event);
              }}
              onClick={() => {
                choose(option);
                if (!option.disabled) roving.setActiveIndex(index);
              }}
            >
              <PillBody option={option} on={on} locale={locale} />
            </button>
          );
        })}
        {more}
      </div>
    );
  }

  return (
    <div ref={root} className={cx('itsm-FilterPills', className)} data-mode={mode} data-size={size} data-capped={showMore && !expanded ? '' : undefined}>
      {group}
      {summary ? (
        <span id={summaryId} className="itsm-FilterPills__summary">
          {summary}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The phone row's "More": a disclosure that shows the pills that did not fit
 * on two lines, in place and in their own order, so each keeps its meaning
 * (a link stays a link, a radio a radio), and moves focus to the first of
 * them. It is always rendered on a phone — parked out of sight when nothing
 * overflows — so its width can be measured before it is needed. Its name is
 * "More filters", with the number it holds back.
 */
function MoreButton({
  controls,
  expanded,
  hidden,
  parked,
  locale,
  onToggle,
  asListItem,
}: {
  readonly controls: string;
  readonly expanded: boolean;
  readonly hidden: number;
  readonly parked: boolean;
  readonly locale: string | undefined;
  readonly onToggle: () => void;
  readonly asListItem: boolean;
}): ReactNode {
  const button = (
    <button
      type="button"
      className={cx('itsm-FilterPills__pill', 'itsm-FilterPills__more', !asListItem && 'itsm-FilterPills__item')}
      aria-expanded={expanded}
      aria-controls={controls}
      tabIndex={parked ? -1 : undefined}
      data-pill-more={asListItem ? undefined : ''}
      data-overflow={!asListItem && parked ? '' : undefined}
      onClick={onToggle}
    >
      <span className="itsm-FilterPills__label">
        More<span className="itsm-visually-hidden"> filters</span>
      </span>
      {hidden > 0 ? <Count value={hidden} size="sm" locale={locale} className="itsm-FilterPills__count" /> : null}
      <Icon name="chevron-down" size="xs" className="itsm-FilterPills__chevron" />
    </button>
  );
  if (!asListItem) return button;
  return (
    <li className="itsm-FilterPills__item" data-pill-more="" data-overflow={parked ? '' : undefined}>
      {button}
    </li>
  );
}
