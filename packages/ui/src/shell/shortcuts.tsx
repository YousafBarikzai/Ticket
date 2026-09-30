'use client';

import { lazy, Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';

/*
 * One keyboard-shortcuts dialog per page, opened by `?` and by the account
 * menu's "Keyboard shortcuts…" — whichever of the two account menus (sidebar
 * or compact bar) the person used. A module-level switch, like the hotkey
 * registry it lists: there is one keyboard, so there is one list of what it
 * does.
 */

let open = false;
let hosts = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens (or closes) the shortcuts dialog. Returns false when no host is mounted to show it. */
export function setShortcutsDialogOpen(next: boolean): boolean {
  if (open !== next) {
    open = next;
    emit();
  }
  return hosts > 0;
}

/** Whether a `ShortcutsDialogHost` is mounted — a lone account menu mounts its own when not. */
export function hasShortcutsDialogHost(): boolean {
  return hosts > 0;
}

/** For tests: closes the dialog. */
export function resetShortcutsDialog(): void {
  open = false;
  emit();
}

const LazyShortcutsDialog = lazy(() => import('./ShortcutsDialog.js').then((module) => ({ default: module.ShortcutsDialog })));

function useHostRegistration(): void {
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);
}

/**
 * Draws the shortcuts dialog when it is asked for, loading it (it is a Radix
 * dialog) only then, and binds `?` to open it. `AppShell` mounts one.
 */
export function ShortcutsDialogHost({ bindKey = true }: { readonly bindKey?: boolean }): ReactNode {
  useHostRegistration();
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);
  useHotkey({
    keys: '?',
    handler: () => setShortcutsDialogOpen(true),
    description: 'Show keyboard shortcuts',
    group: 'General',
    enabled: bindKey,
  });
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <LazyShortcutsDialog open={isOpen} onOpenChange={(next) => setShortcutsDialogOpen(next)} />
    </Suspense>
  );
}
