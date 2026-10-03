'use client';

import type { ReactNode } from 'react';
import { FrameRoot, type AppShellFrameProps } from './frame.js';
import { TopNavFrame } from './TopNavFrame.js';

/** `AppShell variant="topnav"`'s props, without the sidebar frame's own slots. */
export type TopNavShellProps = Omit<AppShellFrameProps, 'variant' | 'sidebarAction' | 'sidebarHeaderExtra' | 'footerExtra' | 'help' | 'context'>;

/**
 * The top-nav frame on its own: exactly what `<AppShell variant="topnav">`
 * draws — the same markup, classes and behaviour — without the sidebar, its
 * top bar, the rail, the navigation sheet or the pre-redesign frame in the
 * module graph. `AppShell` has to carry every variant because it chooses at
 * run time; an app that only ever draws this one (the Help Portal, whose
 * first load is budgeted) imports this and saves the rest.
 */
export function TopNavShell(props: TopNavShellProps): ReactNode {
  const frame: AppShellFrameProps = { ...props, variant: 'topnav' };
  return <FrameRoot props={frame} frame={(page, mainId, areas) => <TopNavFrame props={frame} page={page} mainId={mainId} areas={areas} />} />;
}
