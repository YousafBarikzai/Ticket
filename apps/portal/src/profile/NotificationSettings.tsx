'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@itsm/sdk';
import { FormField, Select, Switch, TimeField, notify } from '@itsm/ui';
import { api } from '../client/api.js';
import { reportSessionEnded } from '../client/useAction.js';
import { useOnline } from './online.js';
import {
  CHANNELS,
  DEFAULT_QUIET,
  DIGEST_OPTIONS,
  inputFor,
  validQuietHours,
  type Channel,
  type ChannelSetting,
  type DigestMode,
} from './model.js';

/**
 * How this person is told about things (SPEC §6.3 `/profile`): the bell and
 * email, each on or off, as it happens or collected into a summary, with
 * quiet hours. Every change saves itself — one shared "Saved" toast, however
 * many changes in a row — and a change that did not save is put back and
 * said so. Quiet hours save once both ends are real times.
 *
 * The whole record goes every time (`inputFor`): the API defaults whatever a
 * body leaves out, and a partial one would quietly switch a muted channel
 * back on.
 */

export interface NotificationSettingsProps {
  readonly initial: Record<Channel, ChannelSetting>;
  /** Where email goes, when the directory said. */
  readonly email: string | null;
  /** "London": whose clock quiet hours are read on. */
  readonly zonePlace: string;
  /** Channels set on the account that nothing here can send on ("Push notifications"). */
  readonly others: readonly string[];
}

const SAVED_TOAST = 'profile-saved';

export function NotificationSettings({ initial, email, zonePlace, others }: NotificationSettingsProps): ReactNode {
  const online = useOnline();
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState<ReadonlySet<Channel>>(() => new Set());
  // Quiet-hour times as typed, until both ends make a window worth saving.
  const [drafts, setDrafts] = useState<Partial<Record<Channel, { readonly start: string | null; readonly end: string | null }>>>({});
  // The record each channel's next save builds on: the last one the server answered, or the one on its way.
  const latest = useRef(initial);

  async function save(channel: Channel, next: ChannelSetting): Promise<boolean> {
    const previous = latest.current[channel];
    latest.current = { ...latest.current, [channel]: next };
    setSettings((current) => ({ ...current, [channel]: next }));
    setSaving((current) => new Set(current).add(channel));
    try {
      const saved = await api.setNotificationPreference(inputFor(channel, next));
      // The server is the record, not the optimistic copy: what it kept is what shows.
      const kept: ChannelSetting = {
        enabled: saved.enabled,
        digestMode: (DIGEST_OPTIONS.some((option) => option.value === saved.digestMode) ? saved.digestMode : 'immediate') as DigestMode,
        quietHours: saved.quietHours,
      };
      latest.current = { ...latest.current, [channel]: kept };
      setSettings((current) => ({ ...current, [channel]: kept }));
      notify('Saved', { tone: 'success', id: SAVED_TOAST });
      return true;
    } catch (error) {
      latest.current = { ...latest.current, [channel]: previous };
      setSettings((current) => ({ ...current, [channel]: previous }));
      setDrafts((current) => ({ ...current, [channel]: undefined }));
      if (error instanceof ApiError && error.status === 401) reportSessionEnded('action');
      else {
        notify('Couldn’t save that change', {
          tone: 'danger',
          id: SAVED_TOAST,
          description: 'Your notification settings are as they were. Check your connection, then try again.',
        });
      }
      return false;
    } finally {
      setSaving((current) => {
        const rest = new Set(current);
        rest.delete(channel);
        return rest;
      });
    }
  }

  function setQuiet(channel: Channel, part: 'start' | 'end', value: string | null): void {
    const setting = latest.current[channel];
    const base = drafts[channel] ?? setting.quietHours ?? DEFAULT_QUIET;
    const window = { ...base, [part]: value };
    setDrafts((current) => ({ ...current, [channel]: window }));
    if (validQuietHours(window.start, window.end)) {
      void save(channel, { ...setting, quietHours: { start: window.start!, end: window.end! } }).then((ok) => {
        if (ok) setDrafts((current) => ({ ...current, [channel]: undefined }));
      });
    }
  }

  return (
    <div className="app-Profile__group app-Notifications">
      {!online ? (
        <p className="app-Profile__note" role="status">
          You’re offline. These settings can be changed once you’re back.
        </p>
      ) : null}
      {CHANNELS.map(({ channel, label, description }) => {
        const setting = settings[channel];
        const busy = saving.has(channel) || !online;
        const draft = drafts[channel];
        const quiet = draft ?? setting.quietHours;
        const incomplete = draft !== undefined && !validQuietHours(draft.start, draft.end);
        const blurb = channel === 'email' && email ? `Sent to ${email}.` : description;
        return (
          <div key={channel} role="group" aria-label={label} className="app-Profile__row app-Notifications__channel" data-channel={channel}>
            <Switch
              layout="row"
              label={label}
              description={blurb}
              checked={setting.enabled}
              disabled={!online}
              onChange={() => undefined}
              onRequestChange={(on) => save(channel, { ...latest.current[channel], enabled: on })}
            />
            {setting.enabled ? (
              <div className="app-Notifications__detail">
                <FormField label="How often" layout="inline">
                  <Select
                    options={DIGEST_OPTIONS}
                    value={setting.digestMode}
                    disabled={busy}
                    onChange={(event) => void save(channel, { ...latest.current[channel], digestMode: event.target.value as DigestMode })}
                  />
                </FormField>
                <Switch
                  layout="row"
                  label="Quiet hours"
                  description={`Anything that arrives in this window waits until it ends. Your time (${zonePlace}).`}
                  checked={setting.quietHours !== null}
                  disabled={!online}
                  onChange={() => undefined}
                  onRequestChange={async (on) => {
                    setDrafts((current) => ({ ...current, [channel]: undefined }));
                    return save(channel, { ...latest.current[channel], quietHours: on ? { ...DEFAULT_QUIET } : null });
                  }}
                />
                {quiet ? (
                  <div className="app-Notifications__window" role="group" aria-label={`Quiet hours for ${label.toLowerCase()}`}>
                    <FormField label="From">
                      <TimeField value={quiet.start} disabled={busy} onChange={(value) => setQuiet(channel, 'start', value)} />
                    </FormField>
                    <FormField
                      label="Until"
                      {...(incomplete ? { error: 'Choose two different times to set the window. Nothing is saved until then.' } : {})}
                    >
                      <TimeField value={quiet.end} disabled={busy} onChange={(value) => setQuiet(channel, 'end', value)} />
                    </FormField>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {others.length > 0 ? (
        <p className="app-Profile__note">
          {others.join(' and ')} {others.length === 1 ? 'is' : 'are'} set up on your account, but this service desk doesn’t
          send {others.length === 1 ? 'those' : 'them'} yet. Your settings are kept for when it does.
        </p>
      ) : null}
    </div>
  );
}
