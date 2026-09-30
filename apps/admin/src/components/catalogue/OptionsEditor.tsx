'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton, Input } from '@itsm/ui';
import { newOption, optionProblems, relabelOption, type OptionDraft } from './questions.js';

/**
 * The choices of a dropdown or multi-select (a form's question or a ticket
 * field), one row each: the words a person picks, the value stored beside
 * it, and Move up, Move down and Remove.
 *
 * No text area of one-per-line options any more — a row per option is what
 * lets it warn about the second "Laptop" before it is saved, keep a stored
 * value when the words change, and reorder without retyping. Pasting several
 * lines into a row makes one row per line; Enter in the last row adds the
 * next. Alt+↑/↓ moves the row the focus is in, as everywhere in the console.
 *
 * Values follow the words until the option has been saved; after that they
 * stay put, so answers already given keep their meaning when an option is
 * reworded.
 */
export function OptionsEditor({
  label,
  options,
  onChange,
  readOnly = false,
  showValues = false,
  error,
  id,
}: {
  /** The group's name: "Options for Access level". */
  readonly label: string;
  readonly options: readonly OptionDraft[];
  /** Client only. */
  readonly onChange: (options: OptionDraft[]) => void;
  readonly readOnly?: boolean;
  /** Show the stored value under each option (technical keys on). */
  readonly showValues?: boolean;
  readonly error?: string;
  readonly id?: string;
}): ReactNode {
  const list = useRef<HTMLOListElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ id: string; control: string } | null>(null);
  const problems = optionProblems(options);

  useEffect(() => {
    if (!focusTarget) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-option="${focusTarget.id}"]`);
    row?.querySelector<HTMLElement>(`[data-control="${focusTarget.control}"]`)?.focus();
    setFocusTarget(null);
  }, [focusTarget, options]);

  const move = (index: number, by: -1 | 1, control: string): void => {
    const target = index + by;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
    setFocusTarget({ id: moved!.id, control });
  };

  const add = (after: number, labels: readonly string[] = ['']): void => {
    const created = labels.map((text) => newOption(text));
    const next = [...options];
    next.splice(after + 1, 0, ...created);
    onChange(next);
    setFocusTarget({ id: created[created.length - 1]!.id, control: 'label' });
  };

  const remove = (index: number): void => {
    const next = options.filter((_, at) => at !== index);
    onChange(next);
    const neighbour = next[index] ?? next[index - 1];
    if (neighbour) setFocusTarget({ id: neighbour.id, control: 'label' });
    else list.current?.parentElement?.querySelector<HTMLElement>('[data-control="add-option"]')?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number): void => {
    if (readOnly) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const control = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')?.dataset.control ?? 'label';
      move(index, event.key === 'ArrowUp' ? -1 : 1, control);
      return;
    }
    if (event.key === 'Enter' && (event.target as HTMLElement).dataset.control === 'label') {
      // Enter adds the next option rather than submitting the form around it.
      event.preventDefault();
      add(index);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number, option: OptionDraft): void => {
    const pasted = event.clipboardData.getData('text');
    const lines = pasted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return;
    event.preventDefault();
    const [first, ...rest] = lines;
    const next = [...options];
    next[index] = relabelOption(option, option.label ? option.label + first : first!);
    const created = rest.map((text) => newOption(text));
    next.splice(index + 1, 0, ...created);
    onChange(next);
    setFocusTarget({ id: created[created.length - 1]!.id, control: 'label' });
  };

  return (
    <div className="app-Options" id={id} tabIndex={id ? -1 : undefined}>
      <ol className="app-Options__list" ref={list} aria-label={`${label}, ${options.length} ${options.length === 1 ? 'option' : 'options'}`}>
        {options.map((option, index) => {
          const duplicate = problems.duplicateValues.has(option.id) || problems.emptyValues.has(option.id);
          const sameWords = problems.duplicateLabels.has(option.id);
          const empty = problems.emptyLabels.has(option.id);
          const noteId = `${option.id}-note`;
          const note = empty
            ? 'Give this option some words.'
            : duplicate
              ? 'Stored the same way as another option. Reword it.'
              : sameWords
                ? 'Reads the same as another option.'
                : null;
          return (
            <li key={option.id} className="app-Options__row" data-option={option.id} onKeyDown={(event) => onRowKeyDown(event, index)}>
              <span className="app-Options__index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="app-Options__field">
                <Input
                  aria-label={`Option ${index + 1}`}
                  data-control="label"
                  value={option.label}
                  readOnly={readOnly}
                  placeholder={`Option ${index + 1}`}
                  invalid={empty || duplicate}
                  {...(note ? { 'aria-describedby': noteId } : {})}
                  onPaste={(event) => onPaste(event, index, option)}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = relabelOption(option, event.currentTarget.value);
                    onChange(next);
                  }}
                />
                {showValues && option.value ? (
                  <span className="app-Options__value">
                    Stored as <code>{option.value}</code>
                  </span>
                ) : null}
                {note ? (
                  <span className="app-Options__note" id={noteId} data-tone={empty || duplicate ? 'danger' : 'warning'}>
                    {note}
                  </span>
                ) : null}
              </div>
              {readOnly ? null : (
                <span className="app-Options__actions">
                  <IconButton
                    icon="arrow-up"
                    label={`Move option ${index + 1} up`}
                    size="sm"
                    data-control="up"
                    aria-keyshortcuts="Alt+ArrowUp"
                    disabled={index === 0}
                    onClick={() => move(index, -1, 'up')}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={`Move option ${index + 1} down`}
                    size="sm"
                    data-control="down"
                    aria-keyshortcuts="Alt+ArrowDown"
                    disabled={index === options.length - 1}
                    onClick={() => move(index, 1, 'down')}
                  />
                  <IconButton icon="x" label={`Remove option ${index + 1}${option.label ? `, ${option.label}` : ''}`} size="sm" data-control="remove" onClick={() => remove(index)} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {readOnly ? null : (
        <Button variant="ghost" size="sm" iconStart="plus" data-control="add-option" onClick={() => add(options.length - 1)}>
          Add option
        </Button>
      )}
      {error ? (
        <p className="app-FieldError" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
