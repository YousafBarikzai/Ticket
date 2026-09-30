'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { Size } from '../types.js';
import type { PresenceStatus } from '../web/Avatar.js';
import { Combobox, type ComboboxOption } from '../web/Combobox.js';
import { cx } from '../web/cx.js';

export interface PersonOption {
  readonly id: string;
  readonly name: string;
  /** A second line: e-mail address, team. */
  readonly detail?: string;
  readonly initials?: string;
}

export type Availability = 'available' | 'busy' | 'away' | 'off_shift';

export interface PersonPickerProps {
  readonly value: PersonOption | readonly PersonOption[] | null;
  readonly onChange: (value: PersonOption | PersonOption[] | null) => void;
  readonly multiple?: boolean;
  /** Client only. Injected so the design system never learns about the SDK. */
  readonly loadPeople: (query: string, signal: AbortSignal) => Promise<readonly PersonOption[]>;
  /** "Assign to me" (needs `me`) and "Unassigned" (single choice only), pinned at the top. */
  readonly extras?: { readonly assignToMe?: boolean; readonly unassign?: boolean };
  readonly availability?: Readonly<Record<string, Availability>>;
  /** Who "Assign to me" means: the signed-in person. Without it the extra is not offered. */
  readonly me?: PersonOption;
  readonly id?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly size?: Size;
  readonly className?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
}

/** Presence as the avatar draws it, and in words for the listbox. */
const presence: Readonly<Record<Availability, { readonly status: PresenceStatus; readonly label: string }>> = {
  available: { status: 'online', label: 'Available' },
  busy: { status: 'busy', label: 'Busy' },
  away: { status: 'away', label: 'Away' },
  off_shift: { status: 'offline', label: 'Off shift' },
};

const ASSIGN_TO_ME = '\u0000assign-to-me';
const UNASSIGN = '\u0000unassign';

function toOption(person: PersonOption, availability: Readonly<Record<string, Availability>> | undefined): ComboboxOption<PersonOption> {
  const state = availability?.[person.id];
  return {
    value: person.id,
    label: person.name,
    description: person.detail,
    data: person,
    avatar: {
      name: person.name,
      initials: person.initials,
      status: state ? presence[state].status : undefined,
      statusLabel: state ? presence[state].label.toLowerCase() : undefined,
    },
  };
}

/**
 * A `Combobox` preset for people: avatars with availability dots (spoken
 * after the name — "Jo Smith, busy"), the person's e-mail or team as the
 * second line, and "Assign to me" / "Unassigned" pinned at the top. One or
 * many (`multiple`, as chips). The search is the caller's `loadPeople`,
 * debounced and aborted like every combobox search.
 */
export function PersonPicker({
  value,
  onChange,
  multiple = false,
  loadPeople,
  extras,
  availability,
  me,
  id,
  placeholder,
  disabled,
  required,
  size,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: PersonPickerProps): ReactNode {
  // Read at map time rather than a dependency: presence changes every few
  // seconds and must not restart a search.
  const availabilityRef = useRef(availability);
  availabilityRef.current = availability;

  const loadOptions = useCallback(
    (query: string, signal: AbortSignal) => loadPeople(query, signal).then((people) => people.map((person) => toOption(person, availabilityRef.current))),
    [loadPeople],
  );

  const pinnedOptions = useMemo(() => {
    const pinned: ComboboxOption<PersonOption>[] = [];
    if (extras?.assignToMe && me) {
      pinned.push({ value: ASSIGN_TO_ME, label: 'Assign to me', description: me.name, icon: 'user', data: me });
    }
    if (extras?.unassign && !multiple) pinned.push({ value: UNASSIGN, label: 'Unassigned', icon: 'circle-dashed' });
    return pinned;
  }, [extras?.assignToMe, extras?.unassign, me, multiple]);

  const shared = {
    loadOptions,
    pinnedOptions,
    id,
    placeholder: placeholder ?? (multiple ? 'Add people' : 'Search people'),
    disabled,
    required,
    size,
    className: cx('itsm-PersonPicker', className),
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
  };

  if (multiple) {
    const people = value === null ? [] : Array.isArray(value) ? (value as readonly PersonOption[]) : [value as PersonOption];
    return (
      <Combobox<PersonOption>
        {...shared}
        multiple
        value={people.map((person) => toOption(person, availability))}
        onChange={(options) => {
          const chosen: PersonOption[] = [];
          for (const option of options) {
            const person = option.value === ASSIGN_TO_ME ? me : option.data;
            if (person && !chosen.some((existing) => existing.id === person.id)) chosen.push(person);
          }
          onChange(chosen);
        }}
      />
    );
  }

  const person = value === null ? null : Array.isArray(value) ? ((value as readonly PersonOption[])[0] ?? null) : (value as PersonOption);
  return (
    <Combobox<PersonOption>
      {...shared}
      value={person ? toOption(person, availability) : null}
      onChange={(option) => {
        if (!option || option.value === UNASSIGN) onChange(null);
        else if (option.value === ASSIGN_TO_ME) onChange(me ?? null);
        else onChange(option.data ?? null);
      }}
    />
  );
}
