'use client';

import { useState, type ReactNode } from 'react';
import { Card, StatusPill, Switch, notify } from '@itsm/ui';
import { useRouter } from 'next/navigation';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';

/**
 * Settings › Modules [Plus] (SPEC §6.1): the parts of the product installed
 * for this desk, each with a switch. A foundation module is always on; a
 * module that others are built on cannot be turned off while they exist, and
 * the row names them instead of offering a switch that the API would refuse.
 * Turning one off asks first — its pages, events and settings stop for
 * everyone.
 */

export interface ModuleView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** False for a foundation module. */
  readonly optional: boolean;
  /** Names of the modules built on this one ("Change management and 2 more"). */
  readonly neededBy: readonly string[];
  /** Names of the modules this one needs that are off. */
  readonly needsOff: readonly string[];
}

/** "A, B and 3 more". */
export function namesText(names: readonly string[], max = 2): string {
  if (names.length <= max) return names.length === 2 ? `${names[0]} and ${names[1]}` : (names[0] ?? '');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

export function ModulesView({ modules }: { readonly modules: readonly ModuleView[] }): ReactNode {
  const optional = modules.filter((module) => module.optional);
  const foundation = modules.filter((module) => !module.optional);
  return (
    <>
      <Card title="Optional modules" titleAs="h2" className="app-SettingsSection" headerDivider>
        <div className="app-SettingsSection__rows">
          {optional.map((module) => (
            <ModuleRow key={module.id} module={module} />
          ))}
        </div>
      </Card>
      <Card title="Foundation" titleAs="h2" subtitle="Always on: every other module is built on these." className="app-SettingsSection" headerDivider>
        <div className="app-SettingsSection__rows">
          {foundation.map((module) => (
            <ModuleRow key={module.id} module={module} />
          ))}
        </div>
      </Card>
    </>
  );
}

function ModuleRow({ module }: { readonly module: ModuleView }): ReactNode {
  const online = useOnline();
  const router = useRouter();
  const [shown, setShown] = useState<{ readonly source: ModuleView; readonly value: boolean }>({ source: module, value: module.enabled });
  if (shown.source !== module) setShown({ source: module, value: module.enabled });
  const save = useMutation((enabled: boolean) => api.tenant.setModuleEnabled(module.id, enabled), { failure: `Couldn’t change ${module.name}` });
  const locked = !module.optional || (module.enabled && module.neededBy.length > 0);

  const write = async (next: boolean): Promise<boolean> => {
    const result = await save.run(next);
    if (!result.ok) return false;
    notify(`${module.name} turned ${next ? 'on' : 'off'}`, {
      tone: 'success',
      undo: async () => {
        await api.tenant.setModuleEnabled(module.id, !next);
        router.refresh();
      },
    });
    return true;
  };

  return (
    <div className="app-SettingRow">
      <div className="app-SettingRow__text">
        <p className="app-SettingRow__label">{module.name}</p>
        {!module.optional ? null : module.enabled && module.neededBy.length > 0 ? (
          <p className="app-SettingRow__note">Can’t be turned off while {namesText(module.neededBy)} {module.neededBy.length === 1 ? 'is' : 'are'} built on it.</p>
        ) : !module.enabled && module.needsOff.length > 0 ? (
          <p className="app-SettingRow__note">Needs {namesText(module.needsOff)}, which {module.needsOff.length === 1 ? 'is' : 'are'} off.</p>
        ) : null}
        <TechnicalKey value={module.id} label="module id" />
      </div>
      <div className="app-SettingRow__control" data-row-control="">
        {locked ? (
          <StatusPill size="sm" tone={module.enabled ? 'success' : 'neutral'} label={module.enabled ? 'On' : 'Off'} srPrefix={module.name} />
        ) : (
          <Switch
            label={module.name}
            labelHidden
            checked={shown.source === module ? shown.value : module.enabled}
            disabled={!online}
            confirm={{
              off: {
                title: `Turn off ${module.name}?`,
                body: 'Its pages, events and settings stop for everyone on this desk until it is turned back on. Nothing it recorded is deleted.',
                confirmLabel: 'Turn off',
                tone: 'danger',
              },
            }}
            onRequestChange={write}
            onChange={(next) => setShown({ source: module, value: next })}
          />
        )}
      </div>
    </div>
  );
}
