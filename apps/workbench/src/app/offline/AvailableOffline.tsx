'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cachedPages } from '@itsm/pwa';
import { VIEWS, viewRefFromPath } from '../../inbox/views.js';

/**
 * "Available offline": the pages this device kept, read from the service
 * worker's page cache (C §2.9). Only pages somebody actually opened are there
 * — nothing is precached but this one — so the list is honest about its
 * limits, and says so when it is empty.
 *
 * Plain links, not client navigations: with no network the router has
 * nothing to fetch, and a full navigation is what lets the worker answer
 * from its cache.
 */

export function offlineLabel(path: string): string | null {
  const url = new URL(path, 'https://workbench.invalid');
  if (url.pathname === '/overview') return 'Overview';
  const ref = viewRefFromPath(url.pathname);
  if (ref?.kind === 'view') {
    const label = VIEWS.find((view) => view.id === ref.id)!.label;
    return url.search ? `${label} (filtered)` : label;
  }
  if (ref?.kind === 'team') return 'A team’s tickets';
  const ticket = /^\/tickets\/([^/]+)\/?$/.exec(url.pathname);
  if (ticket) return decodeURIComponent(ticket[1]!);
  return null;
}

export function AvailableOffline(): ReactNode {
  const [pages, setPages] = useState<readonly { path: string; label: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void cachedPages().then((paths) => {
      if (cancelled) return;
      setPages(
        paths
          .map((path) => ({ path, label: offlineLabel(path) }))
          .filter((page): page is { path: string; label: string } => page.label !== null),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pages === null) return null;
  return (
    <section className="app-Offline" aria-labelledby="offline-heading">
      <h2 id="offline-heading" className="app-Offline__heading">
        Available offline
      </h2>
      {pages.length === 0 ? (
        <p className="app-Offline__empty">Nothing from the Service Desk is saved on this device yet. Pages you open are kept for next time.</p>
      ) : (
        <ul className="app-Offline__list">
          {pages.map((page) => (
            <li key={page.path}>
              <a className="app-Offline__link" href={page.path}>
                {page.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
