'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { disclosureStorageKey } from './disclosure-keys.js';

function read(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === 'open' ? true : value === 'closed' ? false : null;
  } catch {
    return null;
  }
}

function write(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? 'open' : 'closed');
  } catch {
    // Blocked or full storage: the disclosure still works, it just forgets.
  }
}

/**
 * The client half of `Disclosure`'s `persistKey`: after hydration it opens or
 * closes the enclosing `<details>` the way the person left it, then records
 * every toggle. It renders one empty, hidden element and nothing else.
 *
 * A separate client module so that `Disclosure` itself stays server-safe and
 * a disclosure without a key ships no JavaScript at all. The remembered state
 * is applied after hydration — the server cannot read this device's storage —
 * so a disclosure somebody closed may be seen open for a frame; that is the
 * price of not keeping a cookie per disclosure.
 */
export function DisclosureMemory({ persistKey }: { readonly persistKey: string }): ReactNode {
  const marker = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const details = marker.current?.closest('details');
    if (!details) return undefined;
    const key = disclosureStorageKey(persistKey);
    const remembered = read(key);
    if (remembered !== null && remembered !== details.open) details.open = remembered;
    const onToggle = (): void => write(key, details.open);
    details.addEventListener('toggle', onToggle);
    return () => details.removeEventListener('toggle', onToggle);
  }, [persistKey]);

  return <span ref={marker} hidden className="itsm-Disclosure__memory" />;
}
