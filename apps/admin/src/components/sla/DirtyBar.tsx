'use client';

import type { ReactNode } from 'react';
import { Button, type Plural } from '@itsm/ui';

/**
 * "3 changes · Discard · Save targets": the bar that appears only while an
 * in-place editor holds changes that are not saved yet (SPEC §6.1 service
 * levels). Sticky at the bottom of its container and opaque, so it stays in
 * reach over a long grid; the count is announced politely as it changes.
 *
 * Saving can be gated by a state — offline, or a cell that does not read as a
 * duration — and then says why instead of doing nothing (D19).
 */
export function DirtyBar({
  count,
  noun,
  saveLabel,
  pending = false,
  disabledReason,
  onDiscard,
  onSave,
}: {
  readonly count: number;
  readonly noun: Plural;
  readonly saveLabel: string;
  readonly pending?: boolean;
  readonly disabledReason?: string;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}): ReactNode {
  return (
    <div className="app-SlaDirty" role="group" aria-label="Unsaved changes">
      <p className="app-SlaDirty__count" aria-live="polite">
        {count} {count === 1 ? noun.one : noun.other}
      </p>
      <div className="app-SlaDirty__actions">
        <Button variant="ghost" size="sm" onClick={onDiscard} {...(pending ? { disabledReason: 'Saving…' } : {})}>
          Discard
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={pending} {...(disabledReason ? { disabledReason } : {})}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
