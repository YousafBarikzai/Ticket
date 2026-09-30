'use client';

import { useEffect, useState } from 'react';
import { newerCursor, stackKey, stepStack, type AuditQuery } from './presentation.js';

/**
 * *Newer* for a list the API only pages one way (D13).
 *
 * The cursors this tab has visited for these filters live in
 * `sessionStorage` (per tab, gone when it closes — a cursor is a position in
 * a list, not something to keep). On every page the stack is stepped — cut
 * back when the cursor is already in it, pushed when it is new — and the
 * cursor before this one is where Newer goes.
 *
 * Unknown until after hydration (the server has no `sessionStorage`), so the
 * first render says "not known" and Newer appears a moment later; a pasted
 * link to an older page, with no stack behind it, keeps *Newest* only.
 * Storage that throws (a private window, blocked site data) is the same as
 * an empty stack.
 */
export function useCursorStack(query: AuditQuery, cursor: string | null): { readonly newer: string | null | undefined } {
  const key = stackKey(query);
  const [newer, setNewer] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let stack: (string | null)[] = [];
    try {
      const raw = window.sessionStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) stack = parsed.filter((entry): entry is string | null => entry === null || typeof entry === 'string');
    } catch {
      stack = [];
    }
    const next = stepStack(stack, cursor);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Without storage there is no Newer; Newest still works.
    }
    setNewer(newerCursor(next, cursor));
  }, [key, cursor]);

  return { newer };
}
