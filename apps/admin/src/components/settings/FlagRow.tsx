'use client';

import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { StatusPill, Switch, notify, useItsm } from '@itsm/ui';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { anchorId, flagEntry } from '../../settings/catalogue.js';
import { useReachable } from './links.js';
import type { FlagItem } from './types.js';

/**
 * One feature flag as a row (SPEC §6.1 Settings › Features, §6.4 "Feature
 * flags: grouped, true value, optimistic + undo, kill-switch confirm").
 *
 * The switch shows what the tenant actually gets (A1) — the old page showed a
 * value the API never sent, wrote a body the API refused and never cleared
 * its pending state (F3, F30). Now:
 *
 * - An ordinary flag moves **at once** and saves behind it; Undo in the toast
 *   puts it back. A refusal moves it back and says why under the row.
 * - A **kill switch** (`ai.enabled`, `rules.engine.enabled`) asks first when
 *   turning off, and keeps its state — `aria-checked` included — until the
 *   question is answered and the save has landed.
 * - A flag another page owns (triage decisions) is shown, not switched, with
 *   a link to where it is explained.
 * - Without `admin.flag.manage` the row says On or Off in words (D19).
 */
export function FlagRow({ item, canManage, note }: { readonly item: FlagItem; readonly canManage: boolean; readonly note?: string }): ReactNode {
  const { Link } = useItsm();
  const router = useRouter();
  const online = useOnline();
  const labelId = useId();
  const entry = flagEntry(item.key);
  const [error, setError] = useState<string | null>(null);

  // What the switch shows: the one just chosen, until the server renders the
  // row again (a new object each time) — then the server's. Keyed on the row,
  // not the value, so a save undone at once never leaves it stuck (F30).
  const [local, setLocal] = useState<{ readonly source: FlagItem; readonly value: boolean }>({ source: item, value: item.value });
  if (local.source !== item) setLocal({ source: item, value: item.value });
  const shown = local.source === item ? local.value : item.value;

  const save = useMutation((next: boolean) => api.tenant.setFlag(item.key, next), { failure: `Couldn’t change “${item.label}”` });

  const write = async (next: boolean): Promise<boolean> => {
    const before = item.value;
    setError(null);
    const result = await save.run(next);
    if (!result.ok) {
      setError(result.problem.detail ?? result.problem.title ?? 'That wasn’t saved.');
      return false;
    }
    notify(`${item.label} turned ${next ? 'on' : 'off'}`, {
      tone: 'success',
      undo: async () => {
        await api.tenant.setFlag(item.key, before);
        router.refresh();
      },
    });
    return true;
  };

  const managedHref = useReachable(entry.managedAt?.href);
  const writable = canManage && !entry.managedAt;
  const consequence = !shown && entry.offMeans ? entry.offMeans : null;

  return (
    <div className="app-SettingRow app-FlagRow" id={anchorId('flag', item.key)} tabIndex={-1} data-changed={item.changed ? '' : undefined}>
      <div className="app-SettingRow__text">
        <p className="app-SettingRow__label" id={labelId}>
          {item.label}
          {item.changed ? <StatusPill size="sm" tone="neutral" label="Changed" srPrefix="Feature" /> : null}
          {item.expiry ? <StatusPill size="sm" tone="info" icon="hourglass" label={item.expiry} /> : null}
        </p>
        {item.description ? <p className="app-SettingRow__description">{item.description}</p> : null}
        <p className="app-SettingRow__note">
          Default: {item.default ? 'on' : 'off'} · Owner: {item.owner}
        </p>
        {consequence ? <p className="app-FlagRow__consequence">{consequence}</p> : null}
        {note ? <p className="app-FlagRow__consequence">{note}</p> : null}
        <TechnicalKey value={item.key} label="feature key" />
        {error ? (
          <p className="app-SettingRow__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="app-SettingRow__control" data-row-control="">
        {writable ? (
          entry.kill ? (
            <Switch
              label={item.label}
              labelHidden
              checked={shown}
              disabled={!online}
              confirm={{ off: entry.kill }}
              onRequestChange={write}
              onChange={(next) => setLocal({ source: item, value: next })}
            />
          ) : (
            <Switch
              label={item.label}
              labelHidden
              checked={shown}
              disabled={!online || save.pending}
              onChange={(next) => {
                const before = shown;
                setLocal({ source: item, value: next });
                void write(next).then((ok) => {
                  if (!ok) setLocal({ source: item, value: before });
                });
              }}
            />
          )
        ) : (
          <div className="app-SettingRow__readonly">
            <span className="app-SettingRow__value">{shown ? 'On' : 'Off'}</span>
            {entry.managedAt && managedHref ? (
              <Link href={managedHref} className="app-SettingRow__managed">
                Change on {entry.managedAt.label}
              </Link>
            ) : null}
          </div>
        )}
      </div>
      {/* Where a setting row has its ⋯: keeps switches in one column beside setting rows. */}
      <span className="app-SettingRow__more app-SettingRow__spacer" aria-hidden="true" />
    </div>
  );
}
