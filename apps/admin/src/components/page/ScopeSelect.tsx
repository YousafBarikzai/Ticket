'use client';

import { useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon, Select } from '@itsm/ui';
import { useRoutePending } from '@itsm/ui/shell';
import './page.css';

export interface ScopeOption {
  readonly value: string;
  /** "Whole desk", "My teams", "Service Desk". */
  readonly label: string;
}

export interface ScopeSelectProps {
  /** The scope the page is showing. */
  readonly value: string;
  /** What this person may choose between. One option is a statement, not a choice: it is drawn as a chip. */
  readonly options: readonly ScopeOption[];
  /** The control's name: "Scope". */
  readonly label?: string;
  /** The query parameter that carries it; `scope`. */
  readonly param?: string;
  /** The value that needs no parameter (the page's default), so the address stays clean. */
  readonly defaultValue?: string;
}

/** The page's address for another scope: every other parameter kept, the list's cursor dropped. */
export function scopeHref(path: string, query: string, param: string, value: string, defaultValue?: string): string {
  const params = new URLSearchParams(query);
  params.delete('cursor');
  params.delete('after');
  if (value === defaultValue) params.delete(param);
  else params.set(param, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * Whose numbers the page shows (G2, first in the toolbar; A7 §2.4 rule 8).
 *
 * A team lead's analytics are team-scoped by the API, so for them there is
 * nothing to choose: the scope is a static "My teams" chip that says so.
 * Where there is a choice, it is a native select (the platform's keyboard,
 * type-ahead and phone picker) that moves the page to `?scope=` in a
 * transition, keeping every other parameter.
 */
export function ScopeSelect({ value, options, label = 'Scope', param = 'scope', defaultValue }: ScopeSelectProps): ReactNode {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  useRoutePending(pending);

  if (options.length === 0) return null;
  const current = options.find((option) => option.value === value) ?? options[0]!;
  if (options.length === 1) {
    return (
      <p className="app-Scope" data-static="">
        <Icon name="people" size="xs" />
        <span className="itsm-visually-hidden">{label}: </span>
        <span>{current.label}</span>
      </p>
    );
  }
  return (
    <span className="app-Scope" aria-busy={pending || undefined}>
      <Select
        aria-label={label}
        size="sm"
        value={current.value}
        options={options}
        onChange={(event) => {
          const href = scopeHref(pathname, search?.toString() ?? '', param, event.currentTarget.value, defaultValue);
          startTransition(() => router.replace(href, { scroll: false }));
        }}
      />
    </span>
  );
}
