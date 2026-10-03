'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { AssignableAttentionProps } from './AssignableAttention.js';

/**
 * The Unassigned urgent tab's list, fetched only where it is drawn.
 *
 * The other tabs are the server-rendered `AttentionList`, which ships no
 * code of its own; this tab's "Assign to me" needs a client parent, and
 * that parent — the list, its row actions and the client SDK's assignment —
 * would otherwise be first-load JavaScript on every Overview, whichever tab
 * is open. So it is its own chunk, loaded through this small module the
 * way the demo bar is (`app/demo/DemoBarSlot.tsx`). `next/dynamic` keeps
 * server rendering, so the rows are in the HTML and nothing moves when the
 * chunk arrives.
 */
const Loaded = dynamic(() => import('./AssignableAttention.js'));

export function AssignSlot(props: AssignableAttentionProps): ReactNode {
  return <Loaded {...props} />;
}
