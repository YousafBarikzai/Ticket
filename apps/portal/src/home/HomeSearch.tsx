'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, Input, Spinner, cx, useHotkey, useItsm, type IconName } from '@itsm/ui';
import { serviceIcon } from '../catalogue/icons.js';
import { articleHref, knowledgeSearchHref, requestHref } from '../client/palette.js';
import { useHelpFlow } from '../components/PortalShell.js';
import type { HelpCan } from '../help/model.js';
import { MIN_QUERY, useSuggestions } from '../help/suggestions.js';
import { highlight } from '../knowledge/highlight.js';
import { requesterState } from '../tickets/presentation.js';
import { FOCUS_HOME_SEARCH } from './events.js';

/**
 * Home's "How can we help?" field (SPEC §6.3, X-34, MOD-02-E1-S1): one box
 * that searches help articles, services and the person's own requests as
 * they type, and always ends with "Report '…' as an issue".
 *
 * An ARIA 1.2 combobox with a grouped listbox: focus stays in the field,
 * ↑/↓ move through the suggestions (`aria-activedescendant`), Enter opens
 * the one chosen — or, with none chosen, every result on `/search?q=` —
 * and Escape closes the list, then clears the field. `/` puts the caret here
 * from anywhere on Home (the portal's one single-key shortcut, D14).
 *
 * On a phone the list would be squeezed between the keyboard and the top
 * bar, so the field opens "How can we help?" full-screen instead, where the
 * same suggestions have room (§6.3: "sheet on phones").
 */

export interface HomeSearchProps {
  readonly can: HelpCan & { readonly createTickets: boolean };
}

/** The phone layout, where the field opens the full-screen flow. */
const PHONE = '(max-width: 47.9375rem)';

function usePhone(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia?.(PHONE);
      query?.addEventListener?.('change', change);
      return () => query?.removeEventListener?.('change', change);
    },
    () => window.matchMedia?.(PHONE).matches ?? false,
    () => false,
  );
}

interface Option {
  readonly id: string;
  readonly group: 'answers' | 'services' | 'requests' | 'report';
  readonly label: string;
  readonly detail?: ReactNode;
  readonly icon: IconName;
  readonly href?: string;
  readonly run?: () => void;
}

const GROUP_TITLES: Record<Exclude<Option['group'], 'report'>, string> = {
  answers: 'Answers',
  services: 'Services',
  requests: 'Your requests',
};

export function HomeSearch({ can }: HomeSearchProps): ReactNode {
  const help = useHelpFlow();
  const { router } = useItsm();
  const phone = usePhone();
  const ids = useId();
  const listboxId = `${ids}-listbox`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const flowOnTap = phone && help.available;
  const found = useSuggestions(text, can, { enabled: !flowOnTap });
  const query = text.trim();

  const options = useMemo<Option[]>(() => {
    const list: Option[] = [];
    if (found.query && query.length >= MIN_QUERY) {
      for (const hit of found.answers) {
        list.push({
          id: `answer:${hit.entityId}`,
          group: 'answers',
          label: hit.title,
          ...(hit.snippet ? { detail: highlight(hit.snippet) } : {}),
          icon: 'knowledge',
          href: articleHref(hit),
        });
      }
      for (const item of found.services) {
        list.push({
          id: `service:${item.key}`,
          group: 'services',
          label: item.name,
          ...(item.shortSummary || item.service ? { detail: item.shortSummary ?? item.service ?? '' } : {}),
          icon: serviceIcon(item.service, item.name, item.shortSummary),
          href: `/catalogue/${encodeURIComponent(item.key)}`,
        });
      }
      for (const ticket of found.requests) {
        list.push({
          id: `request:${ticket.number}`,
          group: 'requests',
          label: ticket.title,
          detail: `${ticket.number} · ${requesterState(ticket.status).label}`,
          icon: 'ticket',
          href: requestHref(ticket.number),
        });
      }
    }
    if (query && help.available) {
      list.push({ id: 'report', group: 'report', label: `Report ‘${query}’ as an issue`, icon: 'compose', run: () => help.open({ step: 'details', text: query }) });
    }
    return list;
  }, [found.query, found.answers, found.services, found.requests, query, help]);

  // A different list starts with nothing chosen: Enter then means "show me everything".
  const signature = options.map((option) => option.id).join('|');
  useEffect(() => setActive(-1), [signature]);

  const showList = open && query !== '' && options.length > 0;
  const optionId = (index: number): string => `${ids}-option-${index}`;

  const focusSearch = (): void => {
    if (flowOnTap) {
      help.open({ step: 'describe' });
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  useHotkey({ keys: '/', essential: true, description: 'Search for help', group: 'Search', handler: focusSearch });

  const focusRef = useRef(focusSearch);
  focusRef.current = focusSearch;
  useEffect(() => {
    const onFocusRequest = (): void => focusRef.current();
    window.addEventListener(FOCUS_HOME_SEARCH, onFocusRequest);
    return () => window.removeEventListener(FOCUS_HOME_SEARCH, onFocusRequest);
  }, []);

  const choose = (option: Option): void => {
    setOpen(false);
    if (option.run) option.run();
    else if (option.href) router.push(option.href);
  };

  /** Enter with nothing chosen: every result, on the page made for them. */
  const submit = (): void => {
    if (!query) return;
    setOpen(false);
    if (can.search) router.push(`/search?q=${encodeURIComponent(query.slice(0, 200))}`);
    else if (can.readKnowledge) router.push(knowledgeSearchHref(query));
    else if (help.available) help.open({ step: 'details', text: query });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (options.length === 0) return;
        event.preventDefault();
        setOpen(true);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => (current === -1 ? (step === 1 ? 0 : options.length - 1) : (current + step + options.length) % options.length));
        return;
      }
      case 'Enter': {
        event.preventDefault();
        const chosen = showList && active >= 0 ? options[active] : undefined;
        if (chosen) choose(chosen);
        else submit();
        return;
      }
      case 'Escape': {
        if (showList) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setActive(-1);
        } else if (text) {
          event.preventDefault();
          event.stopPropagation();
          setText('');
        }
        return;
      }
      default:
    }
  };

  if (flowOnTap) {
    // A button that looks like the field: a tap opens the full-screen flow with room for its results.
    return (
      <div className="app-HomeSearch" role="search" aria-label="How can we help?">
        <button type="button" className="app-HomeSearch__trigger" aria-haspopup="dialog" onClick={() => help.open({ step: 'describe' })}>
          <Icon name="search" size="sm" className="app-HomeSearch__triggerIcon" />
          <span className="app-HomeSearch__placeholder">Describe the problem or search…</span>
        </button>
      </div>
    );
  }

  const groups = (['answers', 'services', 'requests'] as const)
    .map((group) => ({ group, items: options.map((option, index) => ({ option, index })).filter(({ option }) => option.group === group) }))
    .filter(({ items }) => items.length > 0);
  const reportIndex = options.findIndex((option) => option.group === 'report');

  const drawOption = ({ option, index }: { option: Option; index: number }): ReactNode => (
    <div
      key={option.id}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      className={cx('app-HomeSearch__option', option.group === 'report' && 'app-HomeSearch__option--report')}
      // Keeps focus (and the caret) in the field while a pointer chooses.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (index !== active) setActive(index);
      }}
      onClick={() => choose(option)}
    >
      <Icon name={option.icon} size="sm" className="app-HomeSearch__optionIcon" />
      <span className="app-HomeSearch__optionText">
        <span className="app-HomeSearch__optionLabel">{option.label}</span>
        {option.detail ? <span className="app-HomeSearch__optionDetail">{option.detail}</span> : null}
      </span>
      {option.group === 'report' ? <Icon name="arrow-right" size="sm" directional className="app-HomeSearch__optionEnd" /> : null}
    </div>
  );

  return (
    <div
      className="app-HomeSearch"
      role="search"
      aria-label="How can we help?"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={`${ids}-input`} className="itsm-visually-hidden">
        Search for an answer, or describe the problem
      </label>
      <Input
        ref={inputRef}
        id={`${ids}-input`}
        type="search"
        size="lg"
        prefix="search"
        suffix={found.loading && query.length >= MIN_QUERY ? <Spinner size="sm" /> : <></>}
        clearable
        clearLabel="Clear search"
        className="app-HomeSearch__field"
        placeholder="Describe the problem or search…"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-keyshortcuts="/"
        {...(showList && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <div className="app-HomeSearch__panel" hidden={!showList}>
        <div id={listboxId} role="listbox" aria-label="Suggestions" className="app-HomeSearch__listbox">
          {groups.map(({ group, items }) => (
            <div key={group} role="group" aria-labelledby={`${ids}-${group}`} className="app-HomeSearch__group">
              <div id={`${ids}-${group}`} role="presentation" className="app-HomeSearch__groupTitle">
                {GROUP_TITLES[group]}
              </div>
              {items.map(drawOption)}
            </div>
          ))}
          {reportIndex >= 0 ? drawOption({ option: options[reportIndex]!, index: reportIndex }) : null}
        </div>
        {can.search ? (
          <p className="app-HomeSearch__hint" aria-hidden="true">
            Press Enter to see every result
          </p>
        ) : null}
      </div>
    </div>
  );
}
