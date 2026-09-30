'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { useStableId } from '../a11y/ids.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { scrollIntoViewIfPossible } from '../a11y/motion.js';
import { Spinner } from '../feedback/Spinner.js';
import { Icon } from '../icons/Icon.js';
import { useFocusReturn } from '../overlays/focus-return.js';
import { InertOutside } from '../overlays/inert.js';
import { useRegisteredCommands, type CommandItem, type CommandProvider } from '../provider/commands.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { notify } from '../provider/notify.js';
import { useRecents, type RecentItem } from '../provider/recents.js';
import { kindIcon } from '../shell/app-icons.js';
import { cx } from './cx.js';
import { Kbd } from './Kbd.js';

export type { CommandItem, CommandProvider } from '../provider/commands.js';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** @deprecated Use `onOpenChange`. Called when the palette closes. */
  readonly onClose?: () => void;
  /** Where commands come from: static groups, and searches that run as the person types. */
  readonly providers?: readonly CommandProvider[];
  /** @deprecated A flat list; use `providers`. Still shown, grouped by each item's `group`. */
  readonly commands?: readonly CommandItem[];
  readonly placeholder?: string;
  /** The dialog's and the list's name. "Command palette" by default. */
  readonly label?: string;
  /** "No matching commands" by default. */
  readonly emptyMessage?: string;
  /** Client only: an always-actionable row when nothing matches — "Search tickets for 'vpn'". */
  fallback?(query: string): CommandItem | null;
}

/* -------------------------------------------------------------------------
 * Ranking
 * ---------------------------------------------------------------------- */

interface Rankable {
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
}

/**
 * How well `needle` matches as a subsequence of `haystack` — "sttngs" in
 * "Settings" — or 0. Letters that start words and runs of adjacent letters
 * score higher; a match spread across the whole label barely counts, and
 * one spread wider than three characters a letter does not count at all, so
 * a typo finds its command without every long label matching everything.
 */
function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length < 2) return 0;
  let position = -1;
  let first = -1;
  let score = 0;
  for (const letter of needle) {
    if (letter === ' ') continue;
    const found = haystack.indexOf(letter, position + 1);
    if (found < 0) return 0;
    if (first < 0) first = found;
    const wordStart = found === 0 || /[\s\-/·(]/.test(haystack[found - 1] ?? '');
    score += (found === position + 1 ? 3 : 1) + (wordStart ? 2 : 0);
    position = found;
  }
  const span = position - first + 1;
  if (span > Math.max(needle.length * 3, needle.length + 6)) return 0;
  return score;
}

/**
 * Ranked, not merely filtered: a prefix match on the label beats a hit in a
 * keyword, which beats one in the description. When nothing matches as
 * typed, a fuzzy pass over labels and keywords catches typos and
 * abbreviations ("sttngs", "wfrun"). Stable within a score, so the list does
 * not reshuffle as the person types.
 */
export function rankCommands<T extends Rankable>(commands: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;

  const scored = commands
    .map((command) => {
      const label = command.label.toLowerCase();
      const description = command.description?.toLowerCase() ?? '';
      const keywords = (command.keywords ?? []).map((keyword) => keyword.toLowerCase());
      let score = 0;
      if (label === needle) score = 100;
      else if (label.startsWith(needle)) score = 80;
      else if (label.split(/[\s\-/·]+/).some((word) => word.startsWith(needle))) score = 70;
      else if (label.includes(needle)) score = 60;
      else if (keywords.some((keyword) => keyword.startsWith(needle))) score = 40;
      else if (keywords.some((keyword) => keyword.includes(needle))) score = 30;
      else if (description.includes(needle)) score = 20;
      return { command, score };
    })
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    const fuzzy = commands
      .map((command) => ({
        command,
        score: Math.max(fuzzyScore(command.label.toLowerCase(), needle), ...(command.keywords ?? []).map((keyword) => fuzzyScore(keyword.toLowerCase(), needle) - 1)),
      }))
      .filter((entry) => entry.score > 0);
    fuzzy.sort((a, b) => b.score - a.score);
    return fuzzy.map((entry) => entry.command);
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.command);
}

/* -------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------- */

interface Section {
  readonly key: string;
  /** The heading, or none for loose commands. */
  readonly heading?: string;
  readonly items: readonly CommandItem[];
  /** An async provider still searching. */
  readonly pending?: boolean;
}

interface AsyncResult {
  readonly query: string;
  readonly items: readonly CommandItem[];
  readonly status: 'loading' | 'done' | 'error';
}

interface Page {
  readonly id: string;
  readonly title: string;
  readonly items: readonly CommandItem[] | null;
  readonly failed?: boolean;
}

function recentCommand(item: RecentItem): CommandItem {
  return {
    id: `recent:${item.id}`,
    label: item.label,
    ...(item.meta ? { meta: item.meta } : {}),
    icon: kindIcon(item.kind),
    href: item.href,
    group: 'Recent',
  };
}

/** Groups items by heading in order of first appearance, keeping each group's order. */
function groupItems(items: readonly CommandItem[], fallbackHeading: string | undefined, keyPrefix: string, limit?: number): Section[] {
  const groups = new Map<string, CommandItem[]>();
  for (const item of items) {
    const heading = item.group ?? fallbackHeading ?? '';
    const list = groups.get(heading);
    if (list) list.push(item);
    else groups.set(heading, [item]);
  }
  return [...groups.entries()].map(([heading, list]) => ({
    key: `${keyPrefix}:${heading}`,
    ...(heading ? { heading } : {}),
    items: limit !== undefined ? list.slice(0, limit) : list,
  }));
}

/** Drops repeats by id across sections (the first keeps it) and sections left empty. */
function dedupe(sections: readonly Section[]): Section[] {
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const section of sections) {
    const items = section.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    if (items.length > 0 || section.pending) out.push({ ...section, items });
  }
  return out;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** The part of a label the query matched, set in bold. Text content is unchanged. */
function Highlight({ text, query }: { readonly text: string; readonly query: string }): ReactNode {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="itsm-CommandPalette__match">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
}

/* -------------------------------------------------------------------------
 * The palette
 * ---------------------------------------------------------------------- */

/**
 * The keyboard-first way to go anywhere and do anything: ⌘K (Ctrl K)
 * everywhere, even inside a text field.
 *
 * It keeps the tested model of the in-house palette — a modal dialog whose
 * text field is a `combobox` over a `listbox`, DOM focus never leaving the
 * field while `aria-activedescendant` names the highlighted option
 * (`[role=option][data-active]`), ranked results with a fuzzy fallback, and
 * "N commands available" announced — and grows it:
 *
 * - **Providers**: static groups ("Go to", "Create") and searches that run
 *   as the person types (tickets, people, articles), each debounced (≤ 200 ms),
 *   aborted when overtaken, showing the previous results while searching. A
 *   provider whose `match` recognises the query (INC-123) is listed first.
 * - **An empty query** shows *Recent* (this device's) and *Suggested* (the
 *   page's own commands, `useRegisterCommands`) before everything else.
 * - **Nested pages**: a command with `children` opens its own list ("Assign
 *   to…" → people), shown as chips before the field; Backspace in an empty
 *   field, or Escape, goes back a level.
 * - **Never a dead end**: with nothing matching, "No matching commands" and,
 *   when `fallback` is given, an actionable "Search tickets for 'vpn'" row.
 * - Enter runs; ⌘Enter (Ctrl Enter) opens a destination in a new tab.
 *
 * Hosted on Radix Dialog: the page behind is inert, focus goes back to where
 * it was, Escape closes only the innermost layer. `material.popover` (glass
 * at 0.96, solid where transparency is reduced), 640 px wide, 12vh from the
 * top; a full-height sheet on phones.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onClose,
  providers,
  commands,
  placeholder = 'Search or jump to…',
  label = 'Command palette',
  emptyMessage,
  fallback,
}: CommandPaletteProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const empty = emptyMessage ?? messages.noMatchingCommands;
  const baseId = useStableId('itsm-command');
  const listboxId = `${baseId}-listbox`;
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [stack, setStack] = useState<readonly Page[]>([]);
  const [asyncResults, setAsyncResults] = useState<Readonly<Record<string, AsyncResult>>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const recents = useRecents();
  const suggested = useRegisteredCommands();
  useFocusReturn(open, contentRef);

  const page = stack.length > 0 ? stack[stack.length - 1]! : null;
  const trimmed = query.trim();

  const close = useCallback(() => {
    onOpenChange?.(false);
    onClose?.();
  }, [onOpenChange, onClose]);

  // A palette that remembers the last search opens showing the wrong thing.
  // Forgotten before the first paint of each opening, not after it.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveKey(null);
    setStack([]);
    setAsyncResults({});
  }, [open]);

  /* ---- async providers ---- */

  const searchers = useMemo(() => (providers ?? []).filter((provider) => typeof provider.search === 'function'), [providers]);
  // The searches restart when the query or the set of providers changes — not
  // when a parent re-renders with a fresh (but equal) providers array.
  const searchersRef = useRef(searchers);
  searchersRef.current = searchers;
  const searcherKey = searchers.map((provider) => `${provider.id}:${provider.minQuery ?? 1}:${provider.debounceMs ?? 200}:${provider.limit ?? ''}`).join('|');

  useEffect(() => {
    if (!open || page !== null) return;
    const controllers: AbortController[] = [];
    const timers: number[] = [];
    const next: Record<string, AsyncResult> = {};
    for (const provider of searchersRef.current) {
      if (trimmed.length === 0 || trimmed.length < (provider.minQuery ?? 1)) continue;
      next[provider.id] = { query: trimmed, items: [], status: 'loading' };
      const controller = new AbortController();
      controllers.push(controller);
      const delay = Math.min(provider.debounceMs ?? 200, 200);
      timers.push(
        window.setTimeout(() => {
          provider.search!(trimmed, controller.signal).then(
            (items) => {
              if (controller.signal.aborted) return;
              setAsyncResults((current) => ({ ...current, [provider.id]: { query: trimmed, items: items.slice(0, provider.limit ?? items.length), status: 'done' } }));
            },
            () => {
              if (controller.signal.aborted) return;
              setAsyncResults((current) => ({ ...current, [provider.id]: { query: trimmed, items: current[provider.id]?.items ?? [], status: 'error' } }));
            },
          );
        }, delay),
      );
    }
    // Keep what each provider found last while it searches again, so the list
    // does not blink empty on every keystroke.
    setAsyncResults((current) => {
      const merged: Record<string, AsyncResult> = {};
      for (const [id, result] of Object.entries(next)) merged[id] = { ...result, items: current[id]?.items ?? [] };
      return merged;
    });
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    };
  }, [open, page, trimmed, searcherKey]);

  /* ---- what is listed ---- */

  const sections = useMemo<Section[]>(() => {
    if (page) {
      const items = page.items ?? [];
      return dedupe(groupItems(trimmed ? rankCommands(items, trimmed) : items, undefined, `page-${page.id}`));
    }

    const staticProviders = providers ?? [];
    const matching = (provider: CommandProvider): boolean => {
      if (!provider.match || !trimmed) return false;
      provider.match.lastIndex = 0;
      return provider.match.test(trimmed);
    };
    const recentItems = recents.map(recentCommand);

    if (!trimmed) {
      return dedupe([
        { key: 'recent', heading: 'Recent', items: recentItems },
        { key: 'suggested', heading: 'Suggested', items: suggested.map((item) => ({ ...item, group: 'Suggested' })) },
        ...staticProviders.flatMap((provider) => groupItems(provider.items ?? [], provider.group, `static-${provider.id}`)),
        ...groupItems(commands ?? [], undefined, 'commands'),
      ]);
    }

    const pinned: Section[] = [];
    const rest: Section[] = [];
    for (const provider of staticProviders) {
      const ranked = rankCommands(provider.items ?? [], trimmed);
      const groups = groupItems(ranked, provider.group, `static-${provider.id}`, provider.limit);
      (matching(provider) ? pinned : rest).push(...groups);
    }
    const loose = [
      ...groupItems(rankCommands(suggested, trimmed), 'Suggested', 'suggested'),
      ...groupItems(rankCommands(commands ?? [], trimmed), undefined, 'commands'),
      ...groupItems(rankCommands(recentItems, trimmed), 'Recent', 'recent'),
    ];
    const found: Section[] = [];
    for (const provider of searchers) {
      const result = asyncResults[provider.id];
      if (!result) continue;
      const section: Section = { key: `async-${provider.id}`, heading: provider.group, items: result.items, pending: result.status === 'loading' };
      (matching(provider) ? pinned : found).push(section);
    }
    // Loose commands are ranked across groups: the group holding the best
    // match comes first, as the in-house palette always listed them.
    return dedupe([...pinned, ...loose, ...rest, ...found]);
  }, [page, trimmed, providers, recents, suggested, commands, searchers, asyncResults]);

  const pending = sections.some((section) => section.pending) || (page !== null && page.items === null);
  const options = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const fallbackItem = useMemo(() => (options.length === 0 && trimmed && fallback && !page ? fallback(trimmed) : null), [options.length, trimmed, fallback, page]);
  const listed = fallbackItem ? [fallbackItem] : options;
  const failedSearches = !page ? searchers.filter((provider) => asyncResults[provider.id]?.status === 'error') : [];

  // The highlighted option, by id: results arriving from a search do not move
  // the person's place. When it is gone, the first available one.
  const activeIndex = useMemo(() => {
    const kept = activeKey === null ? -1 : listed.findIndex((item) => item.id === activeKey);
    if (kept >= 0) return kept;
    const first = listed.findIndex((item) => !item.disabled);
    return first >= 0 ? first : 0;
  }, [listed, activeKey]);
  const active = listed[activeIndex];

  // Spoken when the count settles — not on every render, which a fallback
  // row rebuilt by an inline function would otherwise cause.
  const fallbackLabel = fallbackItem?.label;
  const pageTitle = page?.title;
  useEffect(() => {
    if (!open || pending) return;
    const where = pageTitle ? `${pageTitle}: ` : '';
    const count = options.length;
    const message =
      count === 0
        ? `${where}${empty}${fallbackLabel ? `. ${fallbackLabel}` : ''}`
        : `${where}${count} command${count === 1 ? '' : 's'} available`;
    announce(message);
  }, [open, pending, options.length, empty, fallbackLabel, pageTitle]);

  useEffect(() => {
    if (!open) return;
    scrollIntoViewIfPossible(listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`));
  }, [open, activeIndex]);

  /* ---- moving and choosing ---- */

  const move = (delta: number): void => {
    if (listed.length === 0) return;
    let next = activeIndex;
    for (let attempt = 0; attempt < listed.length; attempt += 1) {
      next = (next + delta + listed.length) % listed.length;
      if (!listed[next]?.disabled) {
        setActiveKey(listed[next]!.id);
        return;
      }
    }
  };

  const jump = (from: 'start' | 'end'): void => {
    const order = from === 'start' ? listed : [...listed].reverse();
    const target = order.find((item) => !item.disabled);
    if (target) setActiveKey(target.id);
  };

  const openPage = (item: CommandItem): void => {
    const load = item.children!;
    const pageId = item.id;
    setStack((current) => [...current, { id: pageId, title: item.label, items: null }]);
    setQuery('');
    setActiveKey(null);
    const settle = (items: readonly CommandItem[] | null, failed = false): void =>
      setStack((current) => current.map((entry) => (entry.id === pageId && entry.items === null ? { ...entry, items: items ?? [], ...(failed ? { failed } : {}) } : entry)));
    try {
      const result = load();
      if (isPromise(result)) (result as Promise<readonly CommandItem[]>).then((items) => settle(items), () => settle(null, true));
      else settle(result);
    } catch {
      settle(null, true);
    }
  };

  const goBack = (): void => {
    setStack((current) => current.slice(0, -1));
    setQuery('');
    setActiveKey(null);
  };

  const navigate = (href: string): void => {
    if (itsm) itsm.router.push(href);
    else window.location.assign(href);
  };

  const choose = (item: CommandItem | undefined, how: 'default' | 'newTab' = 'default'): void => {
    if (!item || item.disabled) return;
    if (item.children) {
      openPage(item);
      return;
    }
    if (how === 'newTab' && item.href) {
      window.open(item.href, '_blank', 'noopener,noreferrer');
      close();
      return;
    }
    // Close first: the command may move focus itself, and a focus trap that
    // is still active would drag it straight back.
    close();
    if (item.run) {
      const failed = (): void => {
        notify(`Couldn’t ${item.label.charAt(0).toLowerCase()}${item.label.slice(1).replace(/…$/, '')}`, { tone: 'danger' });
      };
      try {
        const result = item.run();
        if (isPromise(result)) result.catch(failed);
      } catch {
        failed();
      }
      return;
    }
    if (item.href) navigate(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        jump('start');
        break;
      case 'End':
        event.preventDefault();
        jump('end');
        break;
      case 'Enter':
        event.preventDefault();
        choose(active, event.metaKey || event.ctrlKey ? 'newTab' : 'default');
        break;
      case 'Backspace':
        if (query === '' && stack.length > 0) {
          event.preventDefault();
          goBack();
        }
        break;
      default:
        break;
    }
  };

  const onScrimPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget && event.button === 0) close();
  };

  if (!open) return null;

  let index = 0;
  const renderOption = (item: CommandItem): ReactNode => {
    const position = index++;
    const isActive = position === activeIndex;
    return (
      <div
        key={item.id}
        id={`${baseId}-o${position}`}
        role="option"
        data-index={position}
        data-active={isActive}
        data-tone={item.tone === 'danger' ? 'danger' : undefined}
        aria-selected={isActive}
        aria-disabled={item.disabled || undefined}
        aria-keyshortcuts={item.shortcut ? ariaKeyShortcuts(item.shortcut) : undefined}
        className="itsm-CommandPalette__option"
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (!isActive && !item.disabled) setActiveKey(item.id);
        }}
        onClick={(event) => choose(item, event.metaKey || event.ctrlKey ? 'newTab' : 'default')}
      >
        {item.icon ? <Icon name={item.icon} size="sm" className="itsm-CommandPalette__icon" /> : null}
        <span className="itsm-CommandPalette__text">
          <span className="itsm-CommandPalette__label">
            <Highlight text={item.label} query={trimmed} />
          </span>
          {item.description ? <span className="itsm-Combobox__meta itsm-CommandPalette__description">{item.description}</span> : null}
        </span>
        {item.meta ? <span className="itsm-CommandPalette__meta">{item.meta}</span> : null}
        {item.shortcut ? <Kbd keys={item.shortcut} size="sm" className="itsm-CommandPalette__hint" aria-hidden /> : null}
        {item.children ? <Icon name="chevron-right" size="sm" directional className="itsm-CommandPalette__chevron" /> : null}
      </div>
    );
  };

  const showEmpty = !pending && options.length === 0 && !(page?.failed === true);

  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="itsm-CommandPalette__scrim" onPointerDown={onScrimPointerDown}>
          <RadixDialog.Content
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            aria-describedby={undefined}
            className="itsm-CommandPalette"
            data-nested={page ? '' : undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              // Always handled here: a nested page goes back a level, the root closes.
              event.preventDefault();
              if (stack.length > 0) goBack();
              else close();
            }}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <RadixDialog.Title className="itsm-visually-hidden">{label}</RadixDialog.Title>
            <div className="itsm-CommandPalette__field">
              {page ? (
                <button type="button" tabIndex={-1} className="itsm-CommandPalette__back" aria-label={messages.back} onClick={goBack}>
                  <Icon name="chevron-left" size="sm" directional />
                </button>
              ) : (
                <Icon name="search" size="md" className="itsm-CommandPalette__searchIcon" />
              )}
              {stack.length > 0 ? (
                <span className="itsm-CommandPalette__crumbs">
                  {stack.map((entry) => (
                    <span key={entry.id} className="itsm-CommandPalette__crumb">
                      {entry.title.replace(/…$/, '')}
                    </span>
                  ))}
                </span>
              ) : null}
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                className="itsm-CommandPalette__input"
                placeholder={page ? `${page.title.replace(/…$/, '')}…` : placeholder}
                aria-label={page ? `${label}: ${page.title.replace(/…$/, '')}` : label}
                aria-expanded
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={active ? `${baseId}-o${activeIndex}` : undefined}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveKey(null);
                }}
                onKeyDown={onKeyDown}
              />
              {pending ? <Spinner size="sm" className="itsm-CommandPalette__spinner" /> : null}
            </div>
            <div ref={listRef} id={listboxId} role="listbox" aria-label={label} className="itsm-CommandPalette__list">
              {fallbackItem
                ? renderOption(fallbackItem)
                : sections.map((section) =>
                    section.heading ? (
                      <div key={section.key} role="group" aria-labelledby={`${baseId}-${section.key}`} className="itsm-CommandPalette__section" aria-busy={section.pending || undefined}>
                        <div id={`${baseId}-${section.key}`} className="itsm-CommandPalette__group">
                          {section.heading}
                        </div>
                        {section.items.map(renderOption)}
                      </div>
                    ) : (
                      <Fragment key={section.key}>{section.items.map(renderOption)}</Fragment>
                    ),
                  )}
            </div>
            {showEmpty ? <div className="itsm-CommandPalette__empty">{empty}</div> : null}
            {page?.failed ? (
              <div className="itsm-CommandPalette__problem" role="alert">
                Couldn’t load {page.title.replace(/…$/, '')}. Press Escape to go back.
              </div>
            ) : null}
            {pending || failedSearches.length > 0 ? (
              <div className="itsm-CommandPalette__status">
                {pending ? 'Searching…' : `Couldn’t search ${failedSearches.map((provider) => provider.group.toLowerCase()).join(' or ')} just now.`}
              </div>
            ) : null}
            <div className={cx('itsm-CommandPalette__footer')} aria-hidden="true">
              <span>
                <Kbd keys="arrowup" size="sm" aria-hidden />
                <Kbd keys="arrowdown" size="sm" aria-hidden /> to move
              </span>
              <span>
                <Kbd keys="enter" size="sm" aria-hidden /> to choose
              </span>
              <span className="itsm-CommandPalette__footerWide">
                <Kbd keys="mod+enter" size="sm" aria-hidden /> new tab
              </span>
              <span>
                <Kbd keys="escape" size="sm" aria-hidden /> {stack.length > 0 ? 'back' : 'to close'}
              </span>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Overlay>
        <InertOutside active={open} />
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
