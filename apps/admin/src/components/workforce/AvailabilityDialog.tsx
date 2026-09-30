'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, FormField, Input, SegmentedControl, Select } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { Dialog } from '@itsm/ui/overlays';
import { useOnline } from '../../client/live.js';
import { STATUS_LOOK, readLocalDateTime, toLocalInput, untilPresets, type AvailabilityStatus } from './presentation.js';

/** What the dialog sends: the API's `setAvailability` body, less `userId`. */
export interface AvailabilityChoice {
  readonly status: AvailabilityStatus;
  readonly until?: string;
  readonly reason?: string;
}

const CHOICES: readonly AvailabilityStatus[] = ['available', 'busy', 'away', 'off_shift'];

/**
 * Set somebody's availability: the status, and for anything but Available an
 * optional "back at" — in an hour, at the end of today, tomorrow morning, or
 * a time of the person's choosing — and a reason (SPEC §6.1 Workforce › Now).
 *
 * The API refuses an "until" in the past, so the custom time is checked here
 * first and said in words. "Left" is not offered: it takes somebody out of
 * every queue and belongs to deactivating them in People.
 */
export function AvailabilityDialog({
  open,
  onClose,
  who,
  initial,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** "yourself" or the person's name, for the title. */
  readonly who: string;
  readonly initial: AvailabilityStatus;
  /** Resolves when saved; rejects to keep the dialog open. */
  readonly onSubmit: (choice: AvailabilityChoice) => Promise<boolean>;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={who === 'yourself' ? 'Set my availability' : `Set availability for ${who}`} size="sm">
      {open ? <AvailabilityForm self={who === 'yourself'} initial={initial} onCancel={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function AvailabilityForm({
  self,
  initial,
  onCancel,
  onSubmit,
}: {
  readonly self: boolean;
  readonly initial: AvailabilityStatus;
  readonly onCancel: () => void;
  readonly onSubmit: (choice: AvailabilityChoice) => Promise<boolean>;
}): ReactNode {
  const [now] = useState(() => new Date());
  const [zone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  });
  const presets = untilPresets(now);
  const [status, setStatus] = useState<AvailabilityStatus>(CHOICES.includes(initial) ? initial : 'away');
  const [until, setUntil] = useState<string>('none');
  const [custom, setCustom] = useState(() => toLocalInput(presets[2]!.at));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const formId = useId();
  const untilFor = status !== 'available';

  const submit = async (): Promise<void> => {
    let at: Date | null = null;
    if (untilFor && until !== 'none') {
      at = until === 'custom' ? readLocalDateTime(custom, new Date()) : (presets.find((preset) => preset.id === until)?.at ?? null);
      if (!at) {
        setError('Choose a time in the future.');
        return;
      }
    }
    setError(null);
    setBusy(true);
    const ok = await onSubmit({
      status,
      ...(at ? { until: at.toISOString() } : {}),
      ...(untilFor && reason.trim() ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (ok) onCancel();
  };

  return (
    <form
      id={formId}
      className="app-Availability"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <SegmentedControl
        label="Status"
        mode="value"
        fullWidth
        value={status}
        options={CHOICES.map((choice) => ({ value: choice, label: STATUS_LOOK[choice]!.label }))}
        onValueChange={(value) => setStatus(value as AvailabilityStatus)}
      />
      {untilFor ? (
        <>
          <FormField label="Until" hint={self ? 'After this, routing treats you as available again.' : 'After this, routing treats them as available again.'}>
            <Select
              value={until}
              onChange={(event) => setUntil(event.currentTarget.value)}
              options={[
                { value: 'none', label: 'Until it’s changed' },
                ...presets.map((preset) => ({
                  value: preset.id,
                  label: `${preset.label} (${formatDateTime(preset.at, { locale: 'en-GB', timeZone: zone, style: preset.id === 'tomorrow' ? 'weekdayTime' : 'time' })})`,
                })),
                { value: 'custom', label: 'A time I choose…' },
              ]}
            />
          </FormField>
          {until === 'custom' ? (
            <FormField label="Back at" hint="In your time zone." {...(error ? { error } : {})}>
              <Input type="datetime-local" value={custom} onChange={(event) => setCustom(event.currentTarget.value)} />
            </FormField>
          ) : error ? (
            <p className="app-WorkforceFieldError">{error}</p>
          ) : null}
          <FormField label="Reason" optional hint="Shown to the desk, like “At the dentist”.">
            <Input value={reason} maxLength={200} onChange={(event) => setReason(event.currentTarget.value)} />
          </FormField>
        </>
      ) : null}
      <div className="app-WorkforceActions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
          Save
        </Button>
      </div>
    </form>
  );
}
