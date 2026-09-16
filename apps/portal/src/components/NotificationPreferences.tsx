'use client';

import { useState, type ReactNode } from 'react';
import { FormField, Input, Select, Switch } from '@itsm/ui';
import type { NotificationPreference } from '@itsm/sdk';
import { api } from '../client/api.js';

/**
 * What this person wants to be told about, and how.
 *
 * `/me/notification-preferences` has been served since MOD-11-E1 and nothing
 * has ever called it. This is the screen that does.
 *
 * Two decisions worth writing down.
 *
 * The first: the PUT sends the *whole* record every time, never the field that
 * changed. `preferenceSchema` defaults `enabled` to true and `digestMode` to
 * `immediate`, so a body carrying only `quietHours` would silently switch a
 * muted channel back on and flatten a daily digest — the request would answer
 * 200 and the person would find out from their inbox.
 *
 * The second: only the channels this deployment can actually deliver on get a
 * switch. The schema accepts `push` and `sms`, and the worker registers a
 * transport for neither, so a switch for them would write a row, answer 200 and
 * deliver nothing for as long as it took somebody to notice. Where a preference
 * for one of those already exists it is still shown, read-only, saying so.
 */

/** Channels with a transport behind them (`apps/worker/src/transports.ts`). */
const DELIVERABLE = [
  { channel: 'inapp' as const, label: 'In the portal', description: 'The bell in the top bar. Always the quickest.' },
  { channel: 'email' as const, label: 'Email', description: 'Sent to the address your organisation holds for you.' },
];

const CHANNEL_LABELS: Record<string, string> = {
  inapp: 'In the portal',
  email: 'Email',
  push: 'Push notification',
  sms: 'Text message',
};

const DIGEST_OPTIONS = [
  { value: 'immediate', label: 'As it happens' },
  { value: 'hourly', label: 'Hourly summary' },
  { value: 'daily', label: 'Daily summary' },
];

type Row = {
  enabled: boolean;
  quietHours: { start: string; end: string } | null;
  digestMode: string;
};

const DEFAULT_ROW: Row = { enabled: true, quietHours: null, digestMode: 'immediate' };

function toRows(preferences: readonly NotificationPreference[]): Record<string, Row> {
  const rows: Record<string, Row> = {};
  for (const preference of preferences) {
    rows[preference.channel] = {
      enabled: preference.enabled,
      quietHours: preference.quietHours,
      digestMode: preference.digestMode,
    };
  }
  return rows;
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function NotificationPreferences({
  preferences,
}: {
  readonly preferences: readonly NotificationPreference[];
}): ReactNode {
  const [rows, setRows] = useState<Record<string, Row>>(() => toRows(preferences));
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const rowFor = (channel: string): Row => rows[channel] ?? DEFAULT_ROW;

  async function save(channel: 'inapp' | 'email', next: Row): Promise<void> {
    const previous = rowFor(channel);
    setRows((current) => ({ ...current, [channel]: next }));
    setSaving(channel);
    setError(null);
    setSaved(null);
    try {
      const result = await api.setNotificationPreference({
        channel,
        enabled: next.enabled,
        quietHours: next.quietHours,
        digestMode: next.digestMode as 'immediate' | 'hourly' | 'daily',
      });
      // The server is the record, not the optimistic copy: a value it
      // normalised (or refused to change) shows here rather than drifting.
      setRows((current) => ({
        ...current,
        [channel]: { enabled: result.enabled, quietHours: result.quietHours, digestMode: result.digestMode },
      }));
      setSaved(channel);
    } catch {
      setRows((current) => ({ ...current, [channel]: previous }));
      setError('That did not save. Your settings are unchanged.');
    } finally {
      setSaving(null);
    }
  }

  /** Both ends or neither: half a window is not a window. */
  function setQuietHours(channel: 'inapp' | 'email', part: 'start' | 'end', value: string): void {
    const row = rowFor(channel);
    const window = row.quietHours ?? { start: '18:00', end: '08:00' };
    const next = { ...window, [part]: value };
    setRows((current) => ({ ...current, [channel]: { ...row, quietHours: next } }));
    if (TIME.test(next.start) && TIME.test(next.end)) void save(channel, { ...row, quietHours: next });
  }

  const extras = Object.keys(rows).filter((channel) => !DELIVERABLE.some((entry) => entry.channel === channel));

  return (
    <div className="itsm-Prefs">
      {DELIVERABLE.map(({ channel, label, description }) => {
        const row = rowFor(channel);
        const quiet = row.quietHours;
        return (
          <div className="itsm-Prefs__channel" key={channel}>
            <Switch
              label={label}
              description={description}
              checked={row.enabled}
              disabled={saving === channel}
              onChange={(checked) => void save(channel, { ...row, enabled: checked })}
            />

            {row.enabled ? (
              <div className="itsm-Prefs__detail">
                <FormField label="How often" hint="A summary collects everything into one message.">
                  {(control) => (
                    <Select
                      {...control}
                      options={DIGEST_OPTIONS}
                      value={row.digestMode}
                      disabled={saving === channel}
                      onChange={(event) => void save(channel, { ...row, digestMode: event.target.value })}
                    />
                  )}
                </FormField>

                <Switch
                  label="Quiet hours"
                  description="Anything that arrives in this window waits until it ends."
                  checked={quiet !== null}
                  disabled={saving === channel}
                  onChange={(checked) =>
                    void save(channel, { ...row, quietHours: checked ? { start: '18:00', end: '08:00' } : null })
                  }
                />

                {quiet ? (
                  <div className="itsm-Prefs__window">
                    <FormField label="From">
                      {(control) => (
                        <Input
                          {...control}
                          type="time"
                          value={quiet.start}
                          disabled={saving === channel}
                          onChange={(event) => setQuietHours(channel, 'start', event.target.value)}
                        />
                      )}
                    </FormField>
                    <FormField label="Until">
                      {(control) => (
                        <Input
                          {...control}
                          type="time"
                          value={quiet.end}
                          disabled={saving === channel}
                          onChange={(event) => setQuietHours(channel, 'end', event.target.value)}
                        />
                      )}
                    </FormField>
                  </div>
                ) : null}
              </div>
            ) : null}

            {saved === channel ? (
              <p className="itsm-Prefs__saved" role="status">
                Saved.
              </p>
            ) : null}
          </div>
        );
      })}

      {extras.length > 0 ? (
        <p className="itsm-Prefs__note">
          {extras.map((channel) => CHANNEL_LABELS[channel] ?? channel).join(' and ')}
          {extras.length === 1 ? ' is' : ' are'} set up on your account but this service desk does not send on{' '}
          {extras.length === 1 ? 'that channel' : 'those channels'} yet. Your settings are kept for when it does.
        </p>
      ) : null}

      {error ? (
        <p className="itsm-Prefs__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
