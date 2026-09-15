'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, CommandPalette, type CommandItem } from '@itsm/ui';

/**
 * The keyboard-first entry point (doc 14 §1: "keyboard-first").
 *
 * Three bindings, chosen because they are the ones an agent uses without
 * looking: Ctrl/Cmd+K opens the palette, `g` then `q` goes to the queue, and
 * `/` focuses search — the conventions from every other tool people already
 * have open.
 *
 * The listener refuses to fire while the person is typing in a field, which is
 * the bug this shape of feature always ships with: a `/` shortcut that steals
 * the slash out of a URL somebody is pasting into a reply is worse than no
 * shortcut.
 */

function typingInAField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function DeskCommands({ canSearch }: { canSearch: boolean }): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingG, setPendingG] = useState(false);

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'queue',
        label: 'Open the queue',
        group: 'Navigation',
        keywords: ['tickets', 'list', 'g q'],
        shortcut: 'g q',
        run: () => router.push('/queue'),
      },
      {
        id: 'mine',
        label: 'Assigned to me',
        group: 'Navigation',
        keywords: ['my tickets'],
        run: () => router.push('/queue?assignee=me'),
      },
      {
        id: 'unassigned',
        label: 'Unassigned tickets',
        group: 'Navigation',
        keywords: ['nobody', 'unclaimed'],
        run: () => router.push('/queue?assignee=none'),
      },
      ...(canSearch
        ? [
            {
              id: 'search',
              label: 'Search tickets',
              group: 'Navigation',
              keywords: ['find', 'lookup'],
              shortcut: '/',
              run: () => router.push('/queue'),
            } satisfies CommandItem,
          ]
        : []),
    ],
    [router, canSearch],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (typingInAField(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (pendingG) {
        setPendingG(false);
        if (event.key.toLowerCase() === 'q') {
          event.preventDefault();
          router.push('/queue');
        }
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        setPendingG(true);
        // The sequence expires, so a stray `g` does not silently arm a
        // shortcut that fires on whatever the person types next.
        setTimeout(() => setPendingG(false), 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingG, router]);

  return (
    <>
      <Button variant="subtle" size="sm" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K">
        Commands
      </Button>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
    </>
  );
}
