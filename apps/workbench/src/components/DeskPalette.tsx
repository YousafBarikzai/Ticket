'use client';

import { useMemo, type ReactNode } from 'react';
import { CommandPalette } from '@itsm/ui/shell';
import { deskCommandProviders, searchFallback, type DeskPaletteDeps } from '../client/palette.js';

/**
 * The palette itself, loaded the first time ⌘K is pressed (SPEC §3.7): the
 * dialog and the providers are weight the first paint of every desk page
 * does not need.
 */
export interface DeskPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deps: DeskPaletteDeps;
}

export default function DeskPalette({ open, onOpenChange, deps }: DeskPaletteProps): ReactNode {
  const providers = useMemo(() => deskCommandProviders(deps), [deps]);
  const { canReadTickets } = deps;
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      providers={providers}
      placeholder="Search tickets, people and commands"
      label="Search and commands"
      fallback={(query) => searchFallback(query, canReadTickets)}
    />
  );
}
