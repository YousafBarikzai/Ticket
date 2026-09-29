'use client';

import type { ReactNode } from 'react';
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
  readonly extras?: { readonly assignToMe?: boolean; readonly unassign?: boolean };
  readonly availability?: Readonly<Record<string, Availability>>;
  readonly className?: string;
}

/**
 * A `Combobox` preset for people: avatars, availability dots, "Assign to me".
 *
 * Stub (SPEC §4.3): renders the selected names; the overlays package builds
 * it on `Combobox`.
 */
export function PersonPicker({ value, className }: PersonPickerProps): ReactNode {
  const people = value === null ? [] : Array.isArray(value) ? value : [value as PersonOption];
  return <span className={cx('itsm-PersonPicker', className)}>{people.map((person) => person.name).join(', ')}</span>;
}
