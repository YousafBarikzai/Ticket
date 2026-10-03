'use client';

import { useMemo, type ReactNode } from 'react';
import type { AreaModel } from '@itsm/contracts/areas';
import type { CommandItem, CommandProvider } from '@itsm/ui';
import { areaPersonaLine, CommandPalette } from '@itsm/ui/shell';
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

/**
 * "Switch to Service Desk", "Switch to Administration" (v3 §3.9, A2 §10.3):
 * the listed areas other than this one, with their one-liner — or, in a demo
 * visit, who the person continues as there — and their keywords, so
 * "ticketing" finds the Service Desk. A demo visit also gets the public
 * site's home (D18). The same same-tab links as the switcher's rows: the
 * area's `/resume`, or its `/demo` entry in a demo.
 *
 * Here, in the lazy palette chunk, rather than beside the other providers in
 * `client/palette.ts`, which Home's search also reads — so none of it is in a
 * page's first load.
 */
export function areaItems(areas: AreaModel | undefined, keywords: PortalPaletteDeps['areaKeywords'] = {}): CommandItem[] {
  if (!areas?.visible) return [];
  const items = areas.areas
    .filter((link) => !link.current)
    .map(
      (link): CommandItem => ({
        id: `area:${link.id}`,
        label: `Switch to ${link.name}`,
        description: areaPersonaLine(link) ?? link.description,
        icon: link.icon,
        keywords: ['switch area', 'go to', link.name, ...(keywords[link.id] ?? [])],
        href: link.href,
      }),
    );
  if (areas.demo && areas.home) {
    items.push({ id: 'area:home', label: areas.home.label, icon: 'home', keywords: ['website', 'demo', 'leave'], href: areas.home.href });
  }
  return items;
}

/**
 * The portal's providers with the frame's own parts: the Switch area group
 * straight after "Go to", and — in a demo visit — *End demo* where *Sign out*
 * was (v3 §3.7), the same form either way.
 */
export function paletteProviders(deps: PortalPaletteDeps): CommandProvider[] {
  const providers = portalCommandProviders(deps);
  const switching = areaItems(deps.areas, deps.areaKeywords);
  if (switching.length > 0) {
    const after = providers.findLastIndex((provider) => provider.group === 'Go to');
    providers.splice(after + 1, 0, { id: 'areas', group: 'Switch area', items: switching });
  }
  if (!deps.areas?.demo) return providers;
  return providers.map((provider) =>
    provider.id === 'account'
      ? {
          ...provider,
          items: (provider.items ?? []).map((item) =>
            item.id === 'account:sign-out' ? { ...item, label: 'End demo', keywords: ['sign out', 'log out', 'leave', 'exit'] } : item,
          ),
        }
      : provider,
  );
}

export default function PortalPalette({ open, onOpenChange, deps }: PortalPaletteProps): ReactNode {
  const providers = useMemo(() => paletteProviders(deps), [deps]);
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
