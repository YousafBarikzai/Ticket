'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { announce } from '../a11y/announcer.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { SearchField } from '../controls/SearchField.js';
import { SegmentedControl } from '../controls/SegmentedControl.js';
import { formatCount } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { DateRangePicker, type DatePreset } from '../overlays/DateRangePicker.js';
import { Menu } from '../overlays/Menu.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Plural } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { Input } from '../web/Input.js';
import { FilterChip } from './FilterChip.js';
import { useLatest } from './latest.js';
import { dateKeyOf, describeFilterValue, isFilterActive, normaliseText, type DataTableParamsConfig } from './model.js';
import type { DataTableScope, FilterOption, FilterSpec, FilterValue } from './types.js';
import { useLocalView, useUrlView, type ServerParts } from './view-state.js';

export interface FilterBarSearch {
  readonly value: string;
  readonly placeholder: string;
  readonly shortcut?: '/';
  /** The field's accessible name. Default "Search". */
  readonly label?: string;
  /** Client only. Debounced 200 ms. Not needed with `urlKey`, which writes the search itself. */
  readonly onValueChange?: (value: string) => void;
  /** A spinner while results load. */
  readonly loading?: boolean;
  /** With `urlKey`: the parameter's name before the namespace; `q` by default. */
  readonly param?: string;
  /** With `urlKey`: `server` (default) writes through the router, so a server page reads it; `client` writes without a round trip. */
  readonly mode?: 'client' | 'server';
}

interface FilterBarBaseProps {
  readonly search?: FilterBarSearch;
  readonly scope?: DataTableScope;
  readonly filters: readonly FilterSpec[];
  readonly values: Readonly<Record<string, FilterValue>>;
  /** The table's View menu, placed at the end of the row. */
  readonly viewMenu?: ReactNode;
  readonly resultCount?: { readonly shown: number; readonly hasMore: boolean; readonly noun: Plural };
  /** Words that replace `resultCount`'s, when the count needs saying differently ("12 matches in the 50 loaded"). */
  readonly countText?: string;
  readonly end?: ReactNode;
  /** The group's accessible name. Default "Filters". */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Filter state lives either with a client parent (`onChange`) or in the URL
 * under a namespace (`urlKey`) — one or the other, never both.
 */
export type FilterBarProps = FilterBarBaseProps &
  (
    | { onChange(values: Record<string, FilterValue>): void; readonly urlKey?: never }
    | { readonly urlKey: string; readonly onChange?: never }
  );

/** Options past this many get a search field of their own. */
const SEARCHABLE_OPTIONS = 8;
/** How long after a person changed a filter the new count is still theirs to hear. */
const COUNT_ANNOUNCE_WINDOW_MS = 3_000;

/* -------------------------------------------------------------------------
 * The choices inside a chip
 * ---------------------------------------------------------------------- */

interface OptionListProps {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly multiple: boolean;
  onPick(value: string): void;
  /** Where ↑ from the first option goes: the search field above the list. */
  readonly searchRef?: RefObject<HTMLInputElement | null>;
  readonly listRef?: RefObject<HTMLDivElement | null>;
}

/**
 * A listbox of choices: arrow keys move, Space or Enter (or a click) picks.
 * Selection does not follow focus — arrowing through "Status" must not send
 * the page to the server once per option on the way down.
 */
function OptionList({ label, options, selected, multiple, onPick, searchRef, listRef }: OptionListProps): ReactNode {
  const first = options.findIndex((option) => selected.includes(option.value));
  const roving = useRovingTabIndex({ count: options.length, orientation: 'vertical', loop: false, defaultIndex: Math.max(0, first) });
  if (options.length === 0) return <p className="itsm-FilterBar__none">No matching options</p>;
  return (
    <div ref={listRef} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="itsm-FilterBar__options">
      {options.map((option, index) => {
        const item = roving.getItemProps(index);
        const isSelected = selected.includes(option.value);
        return (
          <div
            key={option.value}
            role="option"
            aria-selected={isSelected}
            className="itsm-FilterBar__option"
            data-tone={option.tone}
            tabIndex={item.tabIndex}
            ref={item.ref}
            onFocus={item.onFocus}
            onClick={() => onPick(option.value)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                onPick(option.value);
                return;
              }
              if (event.key === 'ArrowUp' && index === 0 && searchRef?.current) {
                event.preventDefault();
                searchRef.current.focus();
                return;
              }
              item.onKeyDown(event);
            }}
          >
            <span className="itsm-FilterBar__check" aria-hidden="true">
              {isSelected ? <Icon name="check" size="sm" /> : null}
            </span>
            {option.icon ? <Icon name={option.icon} size="sm" className="itsm-FilterBar__optionIcon" /> : null}
            <span className="itsm-FilterBar__optionLabel">{option.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The search field over a long list of options, or the query of a person search. */
function OptionSearch({ label, value, onChange, inputRef, listRef }: { readonly label: string; readonly value: string; onChange(value: string): void; readonly inputRef: RefObject<HTMLInputElement | null>; readonly listRef: RefObject<HTMLDivElement | null> }): ReactNode {
  return (
    <Input
      ref={inputRef}
      type="search"
      size="sm"
      prefix="search"
      aria-label={label}
      placeholder={label}
      value={value}
      className="itsm-FilterBar__optionSearch"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'ArrowDown') return;
        const target = listRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ?? listRef.current?.querySelector<HTMLElement>('[role="option"]');
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
    />
  );
}

function matching(options: readonly FilterOption[], query: string): readonly FilterOption[] {
  const needle = normaliseText(query.trim());
  return needle ? options.filter((option) => normaliseText(option.label).includes(needle)) : options;
}

/** The choices of a `select`, `multiselect` or `person` filter, searchable when long, loaded as typed when they depend on it. */
function ChoicePanel({
  spec,
  value,
  onChange,
  onDone,
  onLearn,
}: {
  readonly spec: FilterSpec;
  readonly value: FilterValue;
  onChange(value: FilterValue): void;
  onDone(): void;
  onLearn(options: readonly FilterOption[]): void;
}): ReactNode {
  const multiple = spec.type === 'multiselect';
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<readonly FilterOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const latest = useLatest({ loadOptions: spec.loadOptions, onLearn });
  const remote = spec.loadOptions !== undefined;

  // Options that depend on what is typed: loaded 200 ms after typing stops, the last request winning.
  useEffect(() => {
    const load = latest.current.loadOptions;
    if (!load) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      load(query.trim(), controller.signal)
        .then((options) => {
          if (controller.signal.aborted) return;
          setLoaded(options);
          latest.current.onLearn(options);
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, latest]);

  const all = remote ? (loaded ?? spec.options ?? []) : (spec.options ?? []);
  const shown = remote ? all : matching(all, query);
  const selected = Array.isArray(value) ? (value as readonly string[]) : isFilterActive(value) ? [String(value)] : [];
  const searchable = remote || all.length > SEARCHABLE_OPTIONS;
  const searchLabel = spec.type === 'person' ? 'Search people' : `Search ${spec.label.toLowerCase()} options`;

  return (
    <div className="itsm-FilterBar__panel" aria-busy={loading || undefined}>
      {searchable ? <OptionSearch label={searchLabel} value={query} onChange={setQuery} inputRef={searchRef} listRef={listRef} /> : null}
      <OptionList
        label={spec.label}
        options={shown}
        selected={selected}
        multiple={multiple}
        searchRef={searchRef}
        listRef={listRef}
        onPick={(picked) => {
          if (multiple) {
            const next = selected.includes(picked) ? selected.filter((item) => item !== picked) : [...selected, picked];
            // Kept in the options' order, so the chip reads the same whatever order they were ticked in.
            const order = all.map((option) => option.value);
            next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
            onChange(next.length > 0 ? next : null);
            return;
          }
          onChange(selected[0] === picked ? null : picked);
          onDone();
        }}
      />
      {multiple ? (
        <div className="itsm-FilterBar__panelFooter">
          <Button size="sm" variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Free text: typed, then applied with Enter or "Apply". */
function TextPanel({ spec, value, onChange, onDone }: { readonly spec: FilterSpec; readonly value: FilterValue; onChange(value: FilterValue): void; onDone(): void }): ReactNode {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onChange(text.trim() === '' ? null : text.trim());
    onDone();
  };
  return (
    <form className="itsm-FilterBar__panel" onSubmit={submit}>
      <Input size="sm" aria-label={spec.label} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      <div className="itsm-FilterBar__panelFooter">
        <Button size="sm" variant="primary" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}

/** "Today", "Last 7 days", "Last 30 days", as calendar dates where the reader is. */
function datePresets(timeZone: string | undefined): DatePreset[] {
  const today = dateKeyOf(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
  const back = (days: number): string => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  return [
    { label: 'Today', value: { from: today, to: today } },
    { label: 'Last 7 days', value: { from: back(6), to: today } },
    { label: 'Last 30 days', value: { from: back(29), to: today } },
  ];
}

function DatePanel({ spec, value, onChange, timeZone }: { readonly spec: FilterSpec; readonly value: FilterValue; onChange(value: FilterValue): void; readonly timeZone: string | undefined }): ReactNode {
  const presets = useMemo(() => datePresets(timeZone), [timeZone]);
  const range = value && typeof value === 'object' && !Array.isArray(value) ? (value as { from: string; to: string }) : null;
  return (
    <div className="itsm-FilterBar__panel">
      <DateRangePicker label={spec.label} value={range} presets={presets} onChange={(next) => onChange(next && (next.from || next.to) ? next : null)} size="sm" />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The bar
 * ---------------------------------------------------------------------- */

interface FilterBarViewProps extends FilterBarBaseProps {
  onValuesChange(values: Record<string, FilterValue>): void;
}

function FilterBarView({ search, scope, filters, values, onValuesChange, viewMenu, resultCount, countText, end, label = 'Filters', className }: FilterBarViewProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = itsm?.locale;
  const timeZone = itsm?.timeZone;
  /** Unpinned filters added from "+ Filter" and not yet given a value. */
  const [added, setAdded] = useState<readonly string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Labels of options met while searching (a person picked from the directory), for the chip's words. */
  const [known, setKnown] = useState<ReadonlyMap<string, string>>(() => new Map());
  const bar = useRef<HTMLDivElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const lastChange = useRef(0);
  const pendingChip = useRef<string | null>(null);
  const groupLabelId = useId();

  const touched = (): void => {
    lastChange.current = Date.now();
  };
  const setValue = (id: string, value: FilterValue): void => {
    touched();
    onValuesChange({ ...values, [id]: value });
  };
  const focusAddOrBar = (): void => {
    setTimeout(() => {
      const active = typeof document === 'undefined' ? null : document.activeElement;
      if (active && active !== document.body && bar.current?.contains(active)) return;
      (addTrigger.current ?? bar.current?.querySelector<HTMLElement>('button, input, a[href]'))?.focus();
    }, 0);
  };

  const visible = filters.filter((spec) => spec.pinned || isFilterActive(values[spec.id] ?? null) || added.includes(spec.id));
  const addable = filters.filter((spec) => !visible.includes(spec));
  const anyActive = filters.some((spec) => isFilterActive(values[spec.id] ?? null)) || (search?.value ?? '').trim() !== '';

  const clearAll = (): void => {
    touched();
    const cleared: Record<string, FilterValue> = {};
    for (const spec of filters) cleared[spec.id] = null;
    onValuesChange(cleared);
    if (search && search.value !== '') search.onValueChange?.('');
    setAdded([]);
    focusAddOrBar();
  };

  const count = countText ?? (resultCount ? formatCount(resultCount.shown, resultCount.hasMore, resultCount.noun, locale) : undefined);

  // A count changed by a filter the person just set is theirs to hear; one
  // changed by a live update or a load is not (and "50 more loaded" says it).
  const firstCount = useRef(true);
  useEffect(() => {
    if (firstCount.current) {
      firstCount.current = false;
      return;
    }
    if (!count || Date.now() - lastChange.current > COUNT_ANNOUNCE_WINDOW_MS) return;
    const timer = setTimeout(() => announce(count), 400);
    return () => clearTimeout(timer);
  }, [count]);

  /** The chip "+ Filter" just added: focus lands on it as the menu closes, then its options open. */
  const chipFocus: RefObject<HTMLElement | null> = {
    get current(): HTMLElement | null {
      const id = pendingChip.current;
      if (!id || !bar.current) return addTrigger.current;
      const slot = [...bar.current.querySelectorAll<HTMLElement>('[data-filter-id]')].find((element) => element.dataset.filterId === id);
      return slot?.querySelector<HTMLElement>('.itsm-FilterChip__trigger') ?? addTrigger.current;
    },
  } as RefObject<HTMLElement | null>;

  const chip = (spec: FilterSpec): ReactNode => {
    const value = values[spec.id] ?? null;
    const active = isFilterActive(value);
    const valueLabel = describeFilterValue(spec, value, locale, known);
    const clear = (): void => {
      setValue(spec.id, null);
      if (!spec.pinned) {
        setAdded((list) => list.filter((id) => id !== spec.id));
        focusAddOrBar();
      }
    };

    if (spec.type === 'boolean') {
      return (
        <button
          key={spec.id}
          type="button"
          data-filter-id={spec.id}
          className="itsm-FilterBar__toggle"
          aria-pressed={value === true}
          onClick={() => setValue(spec.id, value === true ? null : true)}
        >
          {value === true ? <Icon name="check" size="xs" /> : null}
          {spec.label}
        </button>
      );
    }

    const close = (): void => setOpenId(null);
    let panel: ReactNode;
    switch (spec.type) {
      case 'text':
        panel = <TextPanel spec={spec} value={value} onChange={(next) => setValue(spec.id, next)} onDone={close} />;
        break;
      case 'dateRange':
        panel = <DatePanel spec={spec} value={value} onChange={(next) => setValue(spec.id, next)} timeZone={timeZone} />;
        break;
      default:
        panel = (
          <ChoicePanel
            spec={spec}
            value={value}
            onChange={(next) => setValue(spec.id, next)}
            onDone={close}
            onLearn={(options) =>
              setKnown((map) => {
                const next = new Map(map);
                for (const option of options) next.set(option.value, option.label);
                return next;
              })
            }
          />
        );
    }
    return (
      <span key={spec.id} data-filter-id={spec.id} className="itsm-FilterBar__chipSlot">
        <FilterChip
          label={spec.label}
          valueLabel={valueLabel}
          active={active}
          onClear={clear}
          open={openId === spec.id}
          width={spec.type === 'dateRange' ? 'md' : 'sm'}
          onOpenChange={(open) => {
            setOpenId(open ? spec.id : null);
            // An added filter closed without a value goes back behind "+ Filter".
            if (!open && !spec.pinned && !isFilterActive(values[spec.id] ?? null)) {
              setAdded((list) => list.filter((id) => id !== spec.id));
              focusAddOrBar();
            }
          }}
        >
          {panel}
        </FilterChip>
      </span>
    );
  };

  return (
    <div ref={bar} className={cx('itsm-FilterBar', className)} role="group" aria-labelledby={groupLabelId}>
      <span id={groupLabelId} className="itsm-visually-hidden">
        {label}
      </span>
      <div className="itsm-FilterBar__start">
        {search ? (
          <SearchField
            className="itsm-FilterBar__search"
            size="sm"
            value={search.value}
            label={search.label ?? 'Search'}
            labelHidden
            placeholder={search.placeholder}
            {...(search.shortcut ? { shortcut: search.shortcut } : {})}
            {...(search.loading ? { loading: true } : {})}
            onValueChange={(next) => {
              touched();
              search.onValueChange?.(next);
            }}
          />
        ) : null}
        {/* \`wrap\`: on a phone five scopes share the width by their words, never cut to "Resolve…". */}
        {scope ? <SegmentedControl className="itsm-FilterBar__scope" label={scope.label} mode="nav" size="sm" wrap options={scope.options} value={scope.value} /> : null}
        {visible.map(chip)}
        {addable.length > 0 ? (
          <Menu
            label="Add a filter"
            onCloseFocus={chipFocus}
            items={addable.map((spec) => ({
              id: spec.id,
              label: spec.label,
              onSelect: () => {
                pendingChip.current = spec.id;
                setAdded((list) => [...list, spec.id]);
                // Opened once focus has settled on the new chip, or the menu
                // handing focus back would count as a press outside it.
                setTimeout(() => {
                  pendingChip.current = null;
                  setOpenId(spec.id);
                }, 0);
              },
            }))}
            trigger={
              <Button ref={addTrigger} className="itsm-FilterBar__add" size="sm" variant="ghost" iconStart="plus">
                Filter
              </Button>
            }
          />
        ) : null}
        {anyActive && filters.length > 0 ? (
          <Button className="itsm-FilterBar__clearAll" size="sm" variant="ghost" onClick={clearAll}>
            Clear all
          </Button>
        ) : null}
      </div>
      {count || end || viewMenu ? (
        <div className="itsm-FilterBar__end">
          {count ? <p className="itsm-FilterBar__count">{count}</p> : null}
          {end}
          {viewMenu}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * State: a client parent's, or the URL's
 * ---------------------------------------------------------------------- */

function initialOf(props: FilterBarBaseProps): { q: string; sort: null; filters: Readonly<Record<string, FilterValue>> } {
  return { q: props.search?.value ?? '', sort: null, filters: props.values };
}

/** URL-backed: the bar writes its own parameters, through the router unless a filter says `client`. */
function UrlFilterBar(props: FilterBarBaseProps & { readonly urlKey: string }): ReactNode {
  const { urlKey, filters, search } = props;
  const config = useMemo<DataTableParamsConfig>(
    () => ({ urlKey, searchParam: search?.param ?? 'q', filters }),
    [urlKey, search?.param, filters],
  );
  const server = useMemo<ServerParts>(
    () => ({
      search: (search?.mode ?? 'server') === 'server',
      sort: () => true,
      filter: (id) => (filters.find((spec) => spec.id === id)?.mode ?? 'server') === 'server',
    }),
    [search?.mode, filters],
  );
  const { view, setView, isPending } = useUrlView(config, server);
  return (
    <FilterBarView
      {...props}
      values={view.filters}
      {...(search ? { search: { ...search, value: view.q, loading: search.loading || isPending, onValueChange: (q: string) => setView({ q }) } } : {})}
      onValuesChange={(filterValues) => setView({ filters: filterValues })}
    />
  );
}

/** A `urlKey` bar rendered outside `ItsmProvider` (a test, a story): it keeps its own state rather than failing. */
function LocalFilterBar(props: FilterBarBaseProps): ReactNode {
  const { view, setView } = useLocalView(initialOf(props));
  return (
    <FilterBarView
      {...props}
      values={view.filters}
      {...(props.search ? { search: { ...props.search, value: view.q, onValueChange: (q: string) => setView({ q }) } } : {})}
      onValuesChange={(filterValues) => setView({ filters: filterValues })}
    />
  );
}

/**
 * One row above a list: search, scope, the filter chips, "+ Filter", "Clear
 * all", then the result count, anything the page adds, and the View menu.
 * Every active filter is a visible chip that says its value and can be
 * cleared on its own — none hides in the URL (04 §4). The row wraps to two
 * on a narrow container.
 *
 * Pinned filters always show a chip; the rest sit behind "+ Filter" until
 * they are used, when their chip opens straight away. A chip's options are a
 * listbox (searchable past eight), a person search, a date range with
 * presets, or a text field; a yes/no filter is a toggle capsule instead.
 *
 * With `urlKey` the bar keeps its state in the URL itself: a filter marked
 * `mode: 'client'` is written without a round trip, anything else through
 * the router so the server page renders the matching rows. With `onChange` a
 * client parent holds it.
 *
 * The count is announced when a change the person made alters it — not when
 * a live update or "Load more" does.
 */
export function FilterBar(props: FilterBarProps): ReactNode {
  const itsm = useOptionalItsm();
  if (props.urlKey !== undefined) {
    const { urlKey, onChange: _unused, ...rest } = props;
    void _unused;
    return itsm ? <UrlFilterBar {...rest} urlKey={urlKey} /> : <LocalFilterBar {...rest} />;
  }
  const { onChange, urlKey: _none, ...rest } = props;
  void _none;
  return <FilterBarView {...rest} onValuesChange={onChange} />;
}
