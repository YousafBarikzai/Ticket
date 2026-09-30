'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover } from '../overlays/Popover.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Button } from '../web/Button.js';

export interface ViewOnlyPopoverProps {
  readonly trigger: ReactElement<{ id?: string }>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** What the page shows, as its nav label: "Rules". */
  readonly label: string;
  /** The permission it takes to change it, in words: "Manage rules". */
  readonly permission: string;
  /** The technical key (`rules.rule.manage`), shown to people who asked to see keys. */
  readonly permissionKey?: string;
}

/**
 * What *View only* means, loaded when the pill is first wanted (it is a Radix
 * popover): whose permission is missing, in words, and — for people who
 * turned on *Show technical keys* — the key to quote to an administrator,
 * with a Copy button (X-47).
 */
export function ViewOnlyPopover({ trigger, open, onOpenChange, label, permission, permissionKey }: ViewOnlyPopoverProps): ReactNode {
  const { prefs } = useTheme();
  const [copied, setCopied] = useState(false);
  const showKey = permissionKey !== undefined && prefs.showKeys;

  const copy = (): void => {
    if (!permissionKey) return;
    void navigator.clipboard?.writeText(permissionKey).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <Popover
      trigger={trigger}
      title="View only"
      width="sm"
      align="end"
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
      className="itsm-PageHeader__viewOnlyPopover"
    >
      <p className="itsm-PageHeader__viewOnlyText">
        You can see {label} but not change them. Ask an administrator for <strong>{permission}</strong>.
      </p>
      {showKey ? (
        <div className="itsm-PageHeader__viewOnlyKey">
          <code>{permissionKey}</code>
          <Button size="sm" variant="ghost" onClick={copy} iconStart={<Icon name={copied ? 'check' : 'copy'} size="xs" />}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <span className="itsm-visually-hidden" role="status">
            {copied ? 'Copied to the clipboard' : ''}
          </span>
        </div>
      ) : null}
    </Popover>
  );
}
