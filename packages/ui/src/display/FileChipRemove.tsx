'use client';

import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';

/**
 * `FileChip`'s remove button, as its own client module: the chip is
 * server-safe and a server component renders it without one, so the handler
 * only ever arrives from a client parent — a composer's attachment list —
 * and only this small piece ships to the browser.
 */
export function FileChipRemove({ name, onRemove }: { readonly name: string; readonly onRemove: () => void }): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  return (
    <button type="button" className="itsm-FileChip__remove" aria-label={`${messages.remove} ${name}`} onClick={onRemove}>
      <Icon name="x" size="xs" />
    </button>
  );
}
