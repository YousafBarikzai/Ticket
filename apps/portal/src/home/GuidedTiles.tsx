'use client';

import type { ReactNode } from 'react';
import { Tile, TileGrid } from '@itsm/ui';
import { FOCUS_HOME_SEARCH } from './events.js';

/**
 * Three ways in for somebody who would rather pick than type (SPEC §6.3,
 * X-34): *Access & accounts* and *Devices & equipment* open the matching
 * part of Services (the section of the first service named that way, else
 * Services searched for the word — never a dead end), and *Something else?*
 * puts them back in the search, where anything can be described.
 */

export interface GuidedTilesProps {
  readonly accessHref: string;
  readonly devicesHref: string;
}

export function GuidedTiles({ accessHref, devicesHref }: GuidedTilesProps): ReactNode {
  return (
    <TileGrid columns={3} className="app-Home__tiles">
      <Tile title="Access & accounts" description="Passwords, sign-in and permissions" icon="key" href={accessHref} />
      <Tile title="Devices & equipment" description="Laptops, phones, screens and accessories" icon="assets" href={devicesHref} />
      <Tile
        title="Something else?"
        description="Describe it and we’ll find the right place"
        icon="help"
        onClick={() => window.dispatchEvent(new Event(FOCUS_HOME_SEARCH))}
      />
    </TileGrid>
  );
}
