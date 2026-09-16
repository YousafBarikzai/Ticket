'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { announce } from '../a11y/announcer.js';
import { useFocusTrap } from '../a11y/focus-trap.js';
import { scrollIntoViewIfPossible } from '../a11y/motion.js';
import { useStableId } from '../a11y/ids.js';

export interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** Section heading, e.g. "Tickets", "Navigation", "Admin". */
  readonly group?: string;
  /** Extra words the item should match — synonyms, ticket keys, old menu names. */
  readonly keywords?: readonly string[];
  /** Shown at the end of the row, e.g. "⌘K". Display only; the shortcut itself is bound by the app. */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly commands: readonly CommandItem[];
  readonly placeholder?: string;
  readonly emptyMessage?: string;
  readonly label?: string;
}

/** Ranked, not merely filtered: a prefix match on the label beats a hit in a keyword. */
export function rankCommands(commands: readonly CommandItem[], query: string): readonly CommandItem[] {
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
      else if (label.includes(needle)) score = 60;
      else if (keywords.some((keyword) => keyword.startsWith(needle))) score = 40;
      else if (keywords.some((keyword) => keyword.includes(needle))) score = 30;
      else if (description.includes(needle)) score = 20;
      return { command, score };
    })
    .filter((entry) => entry.score > 0);

  // Stable within a score so the list does not reshuffle as the user types.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.command);
}

/**
 * The workbench's keyboard-first entry point: a modal combobox over a flat
 * command list.
 *
 * DOM focus never leaves the text field; the highlighted row is published with
 * `aria-activedescendant`, which is what lets the user keep typing while
 * arrowing. Escape closes, Enter runs, and focus returns to whatever was
 * focused when the palette opened.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Type a command or search…',
  emptyMessage = 'No matching commands',
  label = 'Command palette',
}: CommandPaletteProps): ReactNode {
  const baseId = useStableId('itsm-command');
  const listboxId = `${baseId}-listbox`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  useFocusTrap(containerRef, open, { initialFocus: () => inputRef.current });

  // A palette that remembers the last search is a palette that opens showing
  // the wrong thing.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    announce(
      results.length === 0 ? emptyMessage : `${results.length} command${results.length === 1 ? '' : 's'} available`,
    );
  }, [open, results.length, emptyMessage]);

  useEffect(() => {
    if (!open) return;
    scrollIntoViewIfPossible(listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`));
  }, [open, activeIndex]);

  const move = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (results.length === 0) return 0;
        let next = current;
        for (let attempt = 0; attempt < results.length; attempt += 1) {
          next = (next + delta + results.length) % results.length;
          if (!results[next]?.disabled) return next;
        }
        return current;
      });
    },
    [results],
  );

  const run = useCallback(
    (item: CommandItem | undefined) => {
      if (!item || item.disabled) return;
      // Close first: the command may move focus itself, and a trap that is
      // still active would drag it straight back.
      onClose();
      item.run();
    },
    [onClose],
  );

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
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(results.length - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        run(results[activeIndex]);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  };

  if (!open || typeof document === 'undefined') return null;

  let lastGroup: string | undefined;

  return createPortal(
    <div
      className="itsm-CommandPalette__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={label} className="itsm-CommandPalette">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          className="itsm-CommandPalette__input"
          placeholder={placeholder}
          aria-label={label}
          aria-expanded
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={results[activeIndex] ? `${baseId}-o${activeIndex}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul ref={listRef} id={listboxId} role="listbox" aria-label={label} className="itsm-CommandPalette__list">
          {results.length === 0 ? (
            <li className="itsm-CommandPalette__empty" role="presentation">
              {emptyMessage}
            </li>
          ) : null}
          {results.map((item, index) => {
            const heading = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading ? (
                  <div className="itsm-CommandPalette__group" role="presentation">
                    {heading}
                  </div>
                ) : null}
                <div
                  id={`${baseId}-o${index}`}
                  role="option"
                  data-index={index}
                  data-active={index === activeIndex}
                  aria-selected={index === activeIndex}
                  aria-disabled={item.disabled || undefined}
                  className="itsm-CommandPalette__option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span>
                    {item.label}
                    {item.description ? (
                      <span className="itsm-Combobox__meta" style={{ display: 'block' }}>
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {item.shortcut ? <span className="itsm-CommandPalette__hint">{item.shortcut}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
