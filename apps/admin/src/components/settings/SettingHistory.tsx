'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, EmptyState, ProblemState, SkeletonList, StatusPill, useItsm, type Problem } from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { formatDateTime } from '@itsm/ui/format';
import type { SettingVersionRow } from '@itsm/sdk';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { valueText } from '../../settings/catalogue.js';
import type { SettingItem } from './types.js';

/**
 * A setting's history (`?open=setting:<key>`, SPEC §6.1): every version with
 * its value in words, who published it, when, and the note they left —
 * newest first — and **Restore** on an older one after a confirmation. A
 * restore publishes the old value as a new version, so the history stays one
 * line and the restore can itself be undone.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly problem: Problem }
  | { readonly state: 'ready'; readonly versions: readonly SettingVersionRow[]; readonly names: ReadonlyMap<string, string> };

export function SettingHistory({ items, canManage }: { readonly items: readonly SettingItem[]; readonly canManage: boolean }): ReactNode {
  const drawer = useDrawer('setting');
  const item = drawer.key ? (items.find((entry) => entry.key === drawer.key) ?? null) : null;
  return (
    <Sheet
      open={drawer.key !== null}
      onOpenChange={(open) => {
        if (!open) drawer.close();
      }}
      size="md"
      title={item ? item.label : 'Setting history'}
      {...(item ? { description: 'Every version, newest first.' } : {})}
    >
      {drawer.key === null ? null : item ? (
        <HistoryBody key={`${item.key}:${String(item.value)}`} item={item} canManage={canManage} />
      ) : (
        <EmptyState size="sm" title="That setting no longer exists" description="It may have been removed in an update." action={{ id: 'close', label: 'Close', variant: 'secondary' }} onAction={() => drawer.close()} />
      )}
    </Sheet>
  );
}

function HistoryBody({ item, canManage }: { readonly item: SettingItem; readonly canManage: boolean }): ReactNode {
  const { locale, timeZone } = useItsm();
  const online = useOnline();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [restoring, setRestoring] = useState<SettingVersionRow | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    api.tenant
      .settingVersions(item.key)
      .then(async (versions) => {
        const ids = [...new Set(versions.map((version) => version.publishedBy).filter((id): id is string => Boolean(id)))];
        const names = new Map<string, string>();
        if (ids.length > 0) {
          try {
            for (const person of await api.tenant.users({ ids, limit: Math.min(200, ids.length) })) names.set(person.id, person.displayName || person.email);
          } catch {
            // Names are a courtesy: without directory access the versions still read "by someone".
          }
        }
        if (live) setLoad({ state: 'ready', versions: [...versions].sort((a, b) => b.version - a.version), names });
      })
      .catch((error: unknown) => {
        if (live) setLoad({ state: 'failed', problem: problemFrom(error) });
      });
    return () => {
      live = false;
    };
  }, [item.key, attempt]);

  const restore = useMutation((version: number) => api.tenant.rollbackSetting(item.key, version, `Restored version ${version}`), {
    success: (result) => `Restored version ${result.restoredFrom} of ${item.label}`,
    failure: `Couldn’t restore ${item.label}`,
    onSuccess: () => setAttempt((n) => n + 1),
  });

  if (load.state === 'loading') return <SkeletonList rows={4} label="Loading the history" />;
  if (load.state === 'failed') return <ProblemState problem={load.problem} size="sm" context="The history" onRetry={() => setAttempt((n) => n + 1)} />;

  const current = load.versions[0]?.version ?? null;
  return (
    <div className="app-SettingHistory">
      <TechnicalKey value={item.key} label="setting key" />
      {load.versions.length === 0 ? (
        <p className="app-SettingHistory__empty">Never changed on this desk. It has always been the default: {valueText(item.key, item.type, item.default)}.</p>
      ) : (
        <ol className="app-SettingHistory__list">
          {load.versions.map((version) => {
            const who = version.publishedBy ? (load.names.get(version.publishedBy) ?? 'someone') : 'the platform';
            const isCurrent = version.version === current;
            return (
              <li key={version.version} className="app-SettingHistory__version">
                <div className="app-SettingHistory__head">
                  <h3 className="app-SettingHistory__title">Version {version.version}</h3>
                  {isCurrent ? <StatusPill size="sm" tone="success" label="In use" /> : null}
                </div>
                <p className="app-SettingHistory__value">{valueText(item.key, item.type, version.value)}</p>
                <p className="app-SettingHistory__meta">
                  By {who} · {formatDateTime(version.publishedAt, { locale, timeZone })}
                </p>
                {version.reason ? <p className="app-SettingHistory__reason">“{version.reason}”</p> : null}
                {canManage && !item.locked && !isCurrent ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    iconStart="history"
                    onClick={() => setRestoring(version)}
                    {...(online ? {} : { disabledReason: OFFLINE })}
                  >
                    Restore version {version.version}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className="app-SettingHistory__default">Default: {valueText(item.key, item.type, item.default)}</p>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
        spec={{
          title: `Restore version ${restoring?.version ?? ''}?`,
          body: restoring
            ? `${item.label} goes back to ${valueText(item.key, item.type, restoring.value).replace(/^./, (first) => first.toLowerCase())}, as a new version. It applies straight away.`
            : '',
          confirmLabel: 'Restore',
        }}
        onConfirm={async () => {
          if (!restoring) return;
          const result = await restore.run(restoring.version);
          if (!result.ok) throw new Error(result.problem.detail ?? 'The version wasn’t restored.');
          setRestoring(null);
        }}
      />
    </div>
  );
}
