'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Drafts kept on this device: what somebody had typed into a form, saved
 * every few seconds so that a closed tab, a crash or a dead battery costs
 * them seconds of typing rather than the whole request (SPEC §4.4, MOD-02).
 *
 * One `localStorage` entry per draft, holding the form's version beside the
 * value: a draft written for version 3 of a catalogue form is not poured into
 * version 4, whose questions may have changed meaning. Every storage access
 * is guarded — a private window, a full quota or a blocked site throws, and
 * losing a draft is better than losing the page.
 *
 * Server-side, cross-device drafts need an API that does not exist
 * (`/drafts`); this is the device-local half, honestly labelled as such.
 */

interface DraftEnvelope<T> {
  readonly version: string | null;
  readonly savedAt: string;
  readonly value: T;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored draft, or `null` when there is none or it cannot be read. A corrupt entry is removed. */
export function readDraft<T>(key: string): { readonly version: string | null; readonly savedAt: Date; readonly value: T } | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope<T>> | null;
    const savedAt = typeof parsed?.savedAt === 'string' ? new Date(parsed.savedAt) : null;
    if (!parsed || !('value' in parsed) || !savedAt || Number.isNaN(savedAt.getTime())) {
      store.removeItem(key);
      return null;
    }
    return { version: typeof parsed.version === 'string' ? parsed.version : null, savedAt, value: parsed.value as T };
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // Nothing more to do: the draft is simply not there.
    }
    return null;
  }
}

/** Writes a draft. Returns whether it was stored. */
export function writeDraft<T>(key: string, version: string | null, value: T, savedAt: Date = new Date()): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const envelope: DraftEnvelope<T> = { version, savedAt: savedAt.toISOString(), value };
    store.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // A draft that cannot be removed cannot be read either.
  }
}

export interface UseDraftOptions<T> {
  /** The storage key, unique to the thing being edited (`itsm-draft:form:laptop@3`). Falsy turns drafts off. */
  readonly key: string | null | undefined;
  /** Changes when the form's shape does; a draft saved under another version is discarded, not restored. */
  readonly version?: string;
  /** How long after a change the draft is written. Default 5000. */
  readonly intervalMs?: number;
  /**
   * The current value, for state an application holds itself (catalogue
   * answers, a report sheet). It is saved whenever it changes, at most once
   * per interval. JSON-serialisable.
   */
  readonly value?: T;
  /** Reads the value when it is time to save — the alternative to `value`, used with `touch()`. */
  readonly getValue?: () => T;
  /**
   * Whether a value is not worth keeping. A draft that goes empty is
   * removed. Defaults to "the same as the value the page opened with".
   */
  readonly isEmpty?: (value: T) => boolean;
  /** Client only. Called once, after mount, with the stored draft. */
  readonly onRestore: (value: T) => void;
}

export interface DraftController {
  /** When the draft was last written, or when the restored one had been. `null` while there is none. */
  readonly savedAt: Date | null;
  /** `restored` after a draft was put back; `outdated` when one was dropped because the form changed. */
  readonly notice: 'restored' | 'outdated' | null;
  /** Something changed: the draft is written within the interval. */
  touch(): void;
  /** Writes a pending change now. */
  flush(): void;
  /** Forgets the draft (the caller puts the form back as it was). */
  discard(): void;
  /** Forgets the draft after the form was sent: there is nothing left to keep. */
  clear(): void;
  /** Hides the notice and keeps the draft. */
  dismissNotice(): void;
}

const DEFAULT_INTERVAL_MS = 5000;

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Keeps a device-local draft of a form: restores it once after mount,
 * writes changes at most once per interval, and writes whatever is pending
 * when the page is hidden or the form goes away.
 *
 * Two ways to feed it. With `value`, it watches the value (an application's
 * own state). With `getValue`, the caller says when something changed by
 * calling `touch()` — that is how `Form` uses it, reading its controls only
 * when a save is due rather than on every keystroke.
 *
 * Restoring happens in an effect, never during render, so the server and the
 * first client render agree; the "Draft restored" notice appears after that.
 */
export function useDraft<T>(options: UseDraftOptions<T>): DraftController {
  const { key, version, intervalMs = DEFAULT_INTERVAL_MS } = options;
  const latest = useRef(options);
  useBrowserLayoutEffect(() => {
    latest.current = options;
  });

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<'restored' | 'outdated' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What is in storage now, as JSON, so an unchanged value is not written again. */
  const stored = useRef<string | null>(null);
  /** The value the page opened with, for the default `isEmpty`. */
  const initial = useRef<string | null>(null);
  if (initial.current === null && options.value !== undefined) initial.current = JSON.stringify(options.value);

  const current = (): T | undefined => {
    const { getValue, value } = latest.current;
    return getValue ? getValue() : value;
  };

  const save = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (!key) return;
    const value = current();
    if (value === undefined) return;
    const json = JSON.stringify(value);
    if (json === stored.current) return;
    const empty = latest.current.isEmpty ? latest.current.isEmpty(value) : json === initial.current;
    if (empty) {
      // Back to nothing worth keeping: an old draft would bring back what
      // they deliberately removed.
      removeDraft(key);
      stored.current = json;
      setSavedAt(null);
      return;
    }
    const now = new Date();
    if (writeDraft(key, version ?? null, value, now)) {
      stored.current = json;
      setSavedAt(now);
    }
    // `current` reads refs only, so it is not a dependency.
  }, [key, version]);

  const touch = useCallback(() => {
    if (!key || timer.current !== null) return;
    timer.current = setTimeout(save, Math.max(0, intervalMs));
  }, [key, intervalMs, save]);

  const flush = useCallback(() => {
    if (timer.current !== null) save();
  }, [save]);

  const forget = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (key) removeDraft(key);
    const value = current();
    stored.current = value === undefined ? null : JSON.stringify(value);
    setSavedAt(null);
    setNotice(null);
  }, [key]);

  // Restore once per key, after mount.
  useEffect(() => {
    if (!key) return;
    const draft = readDraft<T>(key);
    if (!draft) return;
    if (draft.version !== (version ?? null)) {
      removeDraft(key);
      setNotice('outdated');
      return;
    }
    stored.current = JSON.stringify(draft.value);
    setSavedAt(draft.savedAt);
    setNotice('restored');
    latest.current.onRestore(draft.value);
    // A new version is a new key in effect; the callback is read through the ref.
  }, [key, version]);

  // Controlled: a changed value is a change.
  const valueKey = options.value === undefined ? undefined : JSON.stringify(options.value);
  const seenValue = useRef(valueKey);
  useEffect(() => {
    if (valueKey === undefined || valueKey === seenValue.current) return;
    seenValue.current = valueKey;
    touch();
  }, [valueKey, touch]);

  // Whatever is pending is written when the page is hidden or the form goes away.
  useEffect(() => {
    if (!key) return;
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [key, flush]);

  return useMemo<DraftController>(
    () => ({
      savedAt,
      notice,
      touch,
      flush,
      discard: forget,
      clear: forget,
      dismissNotice: () => setNotice(null),
    }),
    [savedAt, notice, touch, flush, forget],
  );
}
