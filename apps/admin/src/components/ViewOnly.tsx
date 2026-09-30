'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Button, Icon } from '@itsm/ui';
import { useTheme } from '@itsm/ui/theme';
import { permissionLabel } from '../permissions.js';

/**
 * *View only*, for a part of a page rather than the whole (D19, X-47): a
 * drawer, a card, a settings section that this person may read but not
 * change.
 *
 * The page-level pill is `PageHeader`'s `viewOnly`, fed by `viewOnlyFor()`
 * (`permissions.ts`); this is the same pill and the same explanation for the
 * places a page header is not — so "you can see this but not change it" reads
 * identically everywhere. The popover says whose permission is missing, in
 * words, and — for people who turned on *Show technical keys* — the key with
 * Copy. It is fetched when the pill is first pressed.
 *
 * Write controls themselves are hidden, not disabled, for a missing
 * permission; disabled-with-a-reason is only for state (offline, invalid).
 */

const Popover = lazy(() => import('@itsm/ui/overlays').then((module) => ({ default: module.Popover })));

export interface ViewOnlyProps {
  /** What can be seen: "Business hours", "this rule". */
  readonly label: string;
  /** The permission its changes need, as a key: `sla.policy.manage`. */
  readonly permission: string;
  readonly className?: string;
}

function Explanation({ label, permission }: { readonly label: string; readonly permission: string }): ReactNode {
  const { prefs } = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p className="itsm-PageHeader__viewOnlyText">
        You can see {label} but not change {label.startsWith('this') ? 'it' : 'them'}. Ask an administrator for{' '}
        <strong>{permissionLabel(permission)}</strong>.
      </p>
      {prefs.showKeys ? (
        <div className="itsm-PageHeader__viewOnlyKey">
          <code>{permission}</code>
          <Button
            size="sm"
            variant="ghost"
            iconStart={copied ? 'check' : 'copy'}
            onClick={() =>
              void navigator.clipboard?.writeText(permission).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <span className="itsm-visually-hidden" role="status">
            {copied ? 'Copied to the clipboard' : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}

export function ViewOnly({ label, permission, className }: ViewOnlyProps): ReactNode {
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const pill = (
    <button
      type="button"
      className={className ? `itsm-PageHeader__viewOnly ${className}` : 'itsm-PageHeader__viewOnly'}
      aria-haspopup="dialog"
      {...(wanted
        ? {}
        : {
            'aria-expanded': false,
            onClick: () => {
              setWanted(true);
              setOpen(true);
            },
          })}
    >
      <Icon name="eye" size="xs" />
      <span>View only</span>
    </button>
  );
  if (!wanted) return pill;
  return (
    <Suspense fallback={pill}>
      <Popover trigger={pill} title="View only" width="sm" align="end" open={open} onOpenChange={setOpen}>
        <Explanation label={label} permission={permission} />
      </Popover>
    </Suspense>
  );
}
