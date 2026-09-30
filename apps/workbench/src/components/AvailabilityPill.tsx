'use client';

import dynamic from 'next/dynamic';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityStatus } from '@itsm/sdk';
import { Button, FormField, Input, describeProblem, notify, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { Menu, type MenuItemSpec } from '@itsm/ui/overlays';
import { api } from '../client/api.js';
import { AVAILABILITY_CHOICES, type AvailabilityChoice } from '../client/palette.js';
import { deskKeys } from '../client/query-client.js';
import { problemOf } from '../inbox/presentation.js';

/**
 * "Available / Busy / Away / Off shift", in the sidebar footer (SPEC §5.3).
 *
 * Routing reads this (MOD-20): an agent who is away is skipped when tickets
 * are handed out, so saying so is the difference between a colleague picking
 * up the P1 and the P1 waiting for somebody at lunch. An end time lapses the
 * status back to available by itself — "Away for an hour" needs no second
 * visit.
 *
 * The status is read from the API (`workload.read`) and written with
 * `workload.availability.set`; without the second the pill is not shown at
 * all, and without the first it says "Set availability" rather than guess
 * at a status it cannot see.
 */

const LABEL: Record<string, string> = {
  available: 'Available',
  busy: 'Busy',
  away: 'Away',
  off_shift: 'Off shift',
  left: 'Left',
};

export interface AvailabilityState {
  /** What routing uses now; `null` while unknown. */
  readonly status: AvailabilityStatus | null;
  readonly until: string | null;
  readonly loading: boolean;
  readonly saving: boolean;
  set(status: AvailabilityChoice, until?: Date | null): void;
}

interface Stored {
  readonly status: AvailabilityStatus;
  readonly until: string | null;
}

function known(status: string): AvailabilityStatus {
  return status in LABEL ? (status as AvailabilityStatus) : 'available';
}

/** The person's availability and the one way to change it — shared by the pill and the palette. */
export function useAvailability({ userId, canRead, canSet }: { readonly userId: string | null; readonly canRead: boolean; readonly canSet: boolean }): AvailabilityState {
  const client = useQueryClient();
  const key = deskKeys.availability(userId ?? 'me');

  const query = useQuery({
    queryKey: key,
    enabled: canRead && canSet && userId !== null,
    queryFn: async (): Promise<Stored> => {
      const rows = await api.availability([userId!]);
      const mine = rows.find((row) => row.userId === userId);
      // No row is the default: available, with nothing to lapse.
      return mine ? { status: known(mine.effectiveStatus), until: mine.status === mine.effectiveStatus ? mine.until : null } : { status: 'available', until: null };
    },
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: ({ status, until }: { status: AvailabilityChoice; until: Date | null }) =>
      api.setAvailability({ status, ...(until ? { until: until.toISOString() } : {}) }),
    onSuccess: (result) => {
      client.setQueryData<Stored>(key, { status: known(result.status), until: result.until });
      notify(`You’re ${LABEL[result.status]?.toLowerCase() ?? result.status}`, { tone: 'success', id: 'availability' });
    },
    onError: (error) => {
      const { title, body } = describeProblem(problemOf(error), { context: 'your availability' });
      notify(title, { tone: 'danger', description: body, id: 'availability' });
    },
  });

  const { mutate } = mutation;
  const set = useCallback(
    (status: AvailabilityChoice, until: Date | null = null) => {
      // Available has nothing to lapse back from.
      mutate({ status, until: status === 'available' ? null : until });
    },
    [mutate],
  );

  const pending = mutation.isPending ? mutation.variables : undefined;
  return {
    status: pending?.status ?? query.data?.status ?? null,
    until: pending ? (pending.until?.toISOString() ?? null) : (query.data?.until ?? null),
    loading: query.isLoading,
    saving: mutation.isPending,
    set,
  };
}

/** An hour from now; the end of today, in the browser's clock. */
export function untilPreset(preset: 'hour' | 'today', now: Date = new Date()): Date {
  if (preset === 'hour') return new Date(now.getTime() + 60 * 60_000);
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  return end;
}

/** `YYYY-MM-DDTHH:mm` in local time, for a `datetime-local` field. */
function localInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The custom end-time dialog, fetched the first time it is wanted. */
const LazyDialog = dynamic(() => import('@itsm/ui/overlays').then((module) => module.Dialog), { ssr: false });

function CustomUntil({
  open,
  status,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly status: AvailabilityChoice;
  readonly onClose: () => void;
  readonly onSave: (until: Date) => void;
}): ReactNode {
  const [value, setValue] = useState(() => localInputValue(untilPreset('hour')));
  const [error, setError] = useState<string | undefined>();
  const formId = useId();

  const save = (): void => {
    const chosen = new Date(value);
    if (Number.isNaN(chosen.getTime())) return setError('Enter a date and time.');
    if (chosen.getTime() <= Date.now()) return setError('Choose a time in the future.');
    onSave(chosen);
  };

  if (!open) return null;
  return (
    <LazyDialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`${LABEL[status]} until…`}
      description="Routing treats you as available again after this time."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            Set end time
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FormField label="Until" {...(error ? { error } : {})}>
          <Input
            type="datetime-local"
            value={value}
            min={localInputValue(new Date())}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
          />
        </FormField>
      </form>
    </LazyDialog>
  );
}

export function AvailabilityPill({ availability }: { readonly availability: AvailabilityState }): ReactNode {
  const { locale, timeZone } = useItsm();
  const [custom, setCustom] = useState(false);
  const { status, until, set, loading } = availability;
  const current: AvailabilityChoice = status && status !== 'left' ? status : 'available';

  const untilText = useMemo(() => {
    if (!until) return null;
    const date = new Date(until);
    const today = new Date().toDateString() === date.toDateString();
    return formatDateTime(until, { locale, timeZone, style: today ? 'time' : 'weekdayTime' });
  }, [until, locale, timeZone]);

  const label = status ? LABEL[status] ?? status : loading ? 'Availability' : 'Set availability';
  const spoken = status ? `Availability: ${label}${untilText ? `, until ${untilText}` : ''}` : label;

  const items: MenuItemSpec[] = [
    {
      type: 'radio',
      id: 'status',
      label: 'Status',
      value: status ? current : '',
      items: AVAILABILITY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
      onValueChange: (value) => set(value as AvailabilityChoice),
    },
    ...(status && current !== 'available'
      ? ([
          { type: 'separator' },
          { type: 'label', label: 'Until' },
          { id: 'hour', label: 'For 1 hour', icon: 'timer', onSelect: () => set(current, untilPreset('hour')) },
          { id: 'today', label: 'Until the end of today', icon: 'calendar', onSelect: () => set(current, untilPreset('today')) },
          { id: 'custom', label: 'Choose a time…', icon: 'clock', onSelect: () => setCustom(true) },
          ...(until ? [{ id: 'clear', label: 'No end time', icon: 'x', onSelect: () => set(current, null) } satisfies MenuItemSpec] : []),
        ] satisfies MenuItemSpec[])
      : []),
  ];

  return (
    <>
      <Menu
        label="Availability"
        side="top"
        align="start"
        items={items}
        trigger={
          <button type="button" className="app-Availability" data-status={status ?? 'unknown'} aria-label={spoken}>
            <span className="app-Availability__dot" aria-hidden="true" />
            <span className="app-Availability__label" aria-hidden="true">
              {label}
              {untilText ? <span className="app-Availability__until"> · until {untilText}</span> : null}
            </span>
          </button>
        }
      />
      <CustomUntil
        open={custom}
        status={current}
        onClose={() => setCustom(false)}
        onSave={(chosen) => {
          setCustom(false);
          set(current, chosen);
        }}
      />
    </>
  );
}
