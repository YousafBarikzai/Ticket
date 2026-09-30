'use client';

import { useMemo, type ReactNode } from 'react';
import { CommandPalette } from '@itsm/ui/shell';
import { paletteFallback, portalCommandProviders, type PortalPaletteDeps } from '../client/palette.js';

/**
 * The palette itself, loaded the first time ⌘K or the search button is
 * pressed (SPEC §3.7): the dialog and the searches are weight the first
 * paint of every portal page does not carry.
 */
export interface PortalPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deps: PortalPaletteDeps;
}

export default function PortalPalette({ open, onOpenChange, deps }: PortalPaletteProps): ReactNode {
  const providers = useMemo(() => portalCommandProviders(deps), [deps]);
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      providers={providers}
      placeholder="Search for an answer, a service or a request"
      label="Search"
      fallback={(query) => paletteFallback(query, deps)}
    />
  );
}
