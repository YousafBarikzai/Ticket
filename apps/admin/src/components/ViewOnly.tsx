'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Button, Icon } from '@itsm/ui';
import { useTheme } from '@itsm/ui/theme';
import type { DemoFeature } from '@itsm/contracts/demo';
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
 *
 * In the shared demo the reason is different and so are the words (A7 §2.8,
 * A7-S17): with `demo`, the pill reads "Turned off in the demo" with a lock,
 * and its popover gives A3's sentence for the feature — "This is a shared
 * demo, so changing people's roles is turned off. Everything else works as in
 * the full product." — because no administrator could grant it.
 */

const Popover = lazy(() => import('@itsm/ui/overlays').then((module) => ({ default: module.Popover })));
/** The demo sentence, fetched with the popover so the copy register is not part of a page's first load. */
const DemoExplanation = lazy(() => import('./page/DemoExplanation.js'));

interface ViewOnlyBase {
  /** What can be seen: "Business hours", "this rule". */
  readonly label: string;
  readonly className?: string;
}

export type ViewOnlyProps = ViewOnlyBase &
  (
    | {
        /** The permission its changes need, as a key: `sla.policy.manage`. */
        readonly permission: string;
        readonly demo?: undefined;
      }
    | {
        /** The shared demo turns this feature off (`me.demo.disabledFeatures`): the pill says so, with A3's sentence. */
        readonly demo: DemoFeature;
        readonly permission?: string;
      }
  );

/** The pill's words in the shared demo. */
export const DEMO_PILL = 'Turned off in the demo';

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

export function ViewOnly(props: ViewOnlyProps): ReactNode {
  const { label, permission, demo, className } = props;
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
      <Icon name={demo ? 'lock' : 'eye'} size="xs" />
      <span>{demo ? DEMO_PILL : 'View only'}</span>
    </button>
  );
  if (!wanted) return pill;
  return (
    <Suspense fallback={pill}>
      <Popover trigger={pill} title={demo ? DEMO_PILL : 'View only'} width="sm" align="end" open={open} onOpenChange={setOpen}>
        {demo ? <DemoExplanation feature={demo} /> : <Explanation label={label} permission={permission ?? ''} />}
      </Popover>
    </Suspense>
  );
}
