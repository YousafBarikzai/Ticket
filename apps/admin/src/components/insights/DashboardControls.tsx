'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FormField, IconButton, notify, Select } from '@itsm/ui';
import { useRoutePending } from '@itsm/ui/shell';

/**
 * A dashboard's own controls: refresh (the server evaluates every widget
 * again, in a transition, so the charts stay until the new ones arrive) and
 * Copy link — the dashboard's address by key, which keeps pointing at it
 * however the list is reordered.
 */
export function DashboardActions({ href, name }: { readonly href: string; readonly name: string }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRoutePending(pending);

  const copy = (): void => {
    const link = new URL(href, window.location.origin).toString();
    const done = (): void => {
      notify(`Link to ${name} copied`);
    };
    if (!navigator.clipboard) {
      notify('Couldn’t copy the link', { tone: 'danger', description: link });
      return;
    }
    void navigator.clipboard.writeText(link).then(done, () => {
      notify('Couldn’t copy the link', { tone: 'danger', description: link });
    });
  };

  return (
    <span className="app-Dashboard__actions">
      <IconButton label={`Refresh ${name}`} icon="refresh-cw" size="sm" aria-busy={pending || undefined} onClick={() => startTransition(() => router.refresh())} />
      <IconButton label="Copy link" icon="link" size="sm" onClick={copy} />
    </span>
  );
}

/** The dashboards as a native select, for a phone, where the list beside the dashboard does not fit. */
export function DashboardPicker({
  options,
  value,
}: {
  readonly options: readonly { readonly value: string; readonly label: string; readonly href: string }[];
  readonly value: string;
}): ReactNode {
  const router = useRouter();
  return (
    <FormField label="Dashboard">
      <Select
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) router.push(next.href);
        }}
      />
    </FormField>
  );
}
