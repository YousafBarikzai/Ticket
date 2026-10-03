'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import { createContext, useContext, type ReactNode } from 'react';

/*
 * The person's areas, for anything inside the frame that links across them:
 * the account menu's Switch area group, the Help menu's "Knowledge base ·
 * Help Portal", a page's "Open in Service Desk". The layout builds the model
 * on the server (`currentAreas()`), the frame mounts the provider once, and
 * a page reads it with `useAreas()` and hands it to `crossAreaHref` — so no
 * page reads an origin itself (A2 §3.6). Plain data: nothing in it is a
 * function, so it crosses the server/client boundary as it is.
 */

const AreasContext = createContext<AreaModel | null>(null);

export function AreasProvider({ value, children }: { readonly value: AreaModel | null; readonly children: ReactNode }): ReactNode {
  return <AreasContext value={value}>{children}</AreasContext>;
}

/** The frame's areas, or `null` outside a frame. */
export function useAreas(): AreaModel | null {
  return useContext(AreasContext);
}
