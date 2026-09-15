'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type FlagRow } from '@itsm/sdk';
import { Switch } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * Feature flags, as switches.
 *
 * A switch rather than a checkbox because the change takes effect immediately
 * rather than on a save — that is what the two roles mean, and using the wrong
 * one tells somebody their change is pending when it is already live for every
 * person on the desk.
 *
 * Failure is shown against the flag that failed and the switch goes back to
 * where it was. A console that leaves a switch in the position somebody moved
 * it to, having failed to save it, is a console that lies about the state of
 * the system it exists to describe.
 */
export function FlagList({ flags, canManage }: { flags: readonly FlagRow[]; canManage: boolean }): ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function toggle(flag: FlagRow, next: boolean): Promise<void> {
    setPending((current) => ({ ...current, [flag.key]: next }));
    setErrors((current) => {
      const { [flag.key]: _removed, ...rest } = current;
      return rest;
    });
    try {
      await api.tenant.setFlag(flag.key, next);
      router.refresh();
    } catch (failure) {
      // Back to where it was, and say why.
      setPending((current) => {
        const { [flag.key]: _reverted, ...rest } = current;
        return rest;
      });
      setErrors((current) => ({
        ...current,
        [flag.key]: failure instanceof ApiError ? failure.message : 'That could not be saved.',
      }));
    }
  }

  return (
    <ul className="itsm-FlagList">
      {flags.map((flag) => (
        <li key={flag.key} className="itsm-FlagList__item">
          <Switch
            label={flag.key}
            description={flag.description ?? undefined}
            checked={pending[flag.key] ?? flag.enabled}
            disabled={!canManage}
            onChange={(next) => void toggle(flag, next)}
          />
          {errors[flag.key] ? (
            <p className="itsm-FlagList__error" role="alert">
              {errors[flag.key]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
