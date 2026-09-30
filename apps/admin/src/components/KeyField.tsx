'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, FormField, Icon, Input } from '@itsm/ui';
import { deriveKey, keyState, type KeyRule, type KeyState } from '../keys.js';

/**
 * The permanent key an object is saved under, shown as it is made from the
 * name (B §2.7; F29): "`order-a-laptop` · will be permanent".
 *
 * A key is forever — it is in URLs, in the API, in other rules that point at
 * this one — and a name is not, so the key is shown *while the name is typed*,
 * in one of four states: fine (and permanent), already used, reserved (`new`
 * and `runs` would collide with a page), or impossible to make from this name
 * ("1st line" has no honest key). *Edit key* opens a field for writing it by
 * hand, checked against the same rule the API enforces (`SLUG_KEY` or
 * `FIELD_KEY`). Once the object exists (`locked`) the key is read-only.
 *
 * Replaces five hand-written copies. The value is submitted with the form as a
 * hidden `name="key"` input, and `onStateChange` lets a form refuse to submit
 * while the key is not `ok`.
 */
export interface KeyFieldProps {
  /** The name or label the key is made from. */
  readonly source: string;
  /** `slug` (kebab-case: rules, services, forms…) or `field` (camelCase: custom fields). */
  readonly rule: KeyRule;
  /** The key, controlled. */
  readonly value: string;
  /** Client only. */
  readonly onChange: (key: string) => void;
  /** Client only: the key's state, whenever it changes. */
  readonly onStateChange?: (state: KeyState) => void;
  /** Keys already used by this kind of object. */
  readonly taken?: readonly string[];
  /** Words refused besides `taken`. Defaults to `new` and `runs` for slug keys. */
  readonly reserved?: readonly string[];
  /** What these keys belong to, for "Already used by another rule". Default "item". */
  readonly noun?: string;
  /** The form field's name. Default `key`. */
  readonly name?: string;
  /** The object exists: its key can no longer change. */
  readonly locked?: boolean;
  readonly className?: string;
}

const RULE_HINT: Readonly<Record<KeyRule, string>> = {
  slug: 'Lower-case letters, numbers and hyphens, starting with a letter; 2 to 63 characters.',
  field: 'Letters and numbers, starting with a lower-case letter; up to 64 characters.',
};

function describe(state: KeyState, key: string, source: string, noun: string, rule: KeyRule): string {
  switch (state) {
    case 'ok':
      return 'will be permanent';
    case 'taken':
      return `already used by another ${noun}`;
    case 'reserved':
      return `“${key}” is reserved — choose another key`;
    case 'invalid':
      return `isn’t a valid key. ${RULE_HINT[rule]}`;
    case 'empty':
      return source.trim() === '' ? 'appears when you type a name' : 'can’t be made from this name — edit the key by hand';
  }
}

export function KeyField({
  source,
  rule,
  value,
  onChange,
  onStateChange,
  taken,
  reserved,
  noun = 'item',
  name = 'key',
  locked = false,
  className,
}: KeyFieldProps): ReactNode {
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState(false);
  const stateId = useId();
  const input = useRef<HTMLInputElement | null>(null);

  // Follow the name until the person takes the key over by hand.
  useEffect(() => {
    if (locked || manual) return;
    const derived = deriveKey(source, rule);
    if (derived !== value) onChange(derived);
  }, [locked, manual, onChange, rule, source, value]);

  const state = keyState(value, { rule, ...(taken ? { taken } : {}), ...(reserved ? { reserved } : {}) });
  const lastState = useRef<KeyState | null>(null);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const ok = state === 'ok';
  const message = locked ? 'set when this was created; it can’t change' : describe(state, value, source, noun, rule);

  return (
    <div className={className ? `app-KeyField ${className}` : 'app-KeyField'} data-state={locked ? 'locked' : state}>
      <input type="hidden" name={name} value={value} />
      <p className="app-KeyField__line">
        <span className="app-KeyField__label">Key</span>{' '}
        {value ? <code className="app-KeyField__key">{value}</code> : <span className="app-KeyField__none">—</span>}{' '}
        <span className="app-KeyField__state" id={stateId} aria-live="polite">
          {!locked ? <Icon name={ok ? 'lock' : state === 'empty' && source.trim() === '' ? 'info' : 'circle-alert'} size="xs" /> : null}
          <span>· {message}</span>
        </span>
        {locked || editing ? null : (
          <Button variant="ghost" size="sm" className="app-KeyField__edit" onClick={() => setEditing(true)}>
            Edit key
          </Button>
        )}
      </p>
      {editing && !locked ? (
        <div className="app-KeyField__editor">
          <FormField label="Key" hint={RULE_HINT[rule]} {...(!ok && value !== '' ? { error: describe(state, value, source, noun, rule) } : {})}>
            <Input
              ref={input}
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => {
                setManual(true);
                onChange(event.target.value.trim());
              }}
            />
          </FormField>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setManual(false);
              setEditing(false);
              onChange(deriveKey(source, rule));
            }}
          >
            Use the key from the name
          </Button>
        </div>
      ) : null}
    </div>
  );
}
