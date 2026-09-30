'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cachedPages } from '@itsm/pwa';

/**
 * "Available offline": the pages this device kept, read from the service
 * worker's page cache (C §3.12). Only pages somebody actually opened are
 * there — nothing is precached but this one — so the list is honest about
 * its limits, and says so when it is empty.
 *
 * Plain links, not client navigations: with no network the router has
 * nothing to fetch, and a full navigation is what lets the worker answer
 * from its cache.
 */

export interface OfflinePage {
  readonly path: string;
  readonly label: string;
  /** What kind of page, when the label alone does not say: "Request", "Article". */
  readonly kind?: string;
}

const PAGES: Readonly<Record<string, string>> = {
  '/': 'Home',
  '/tickets': 'My requests',
  '/catalogue': 'Services',
  '/knowledge': 'Knowledge',
  '/profile': 'Profile',
  '/approvals': 'Approvals',
  '/report': 'Report an issue',
};

/** `set-up-the-vpn` → "Set up the vpn": an article's key, readable, until its page says its title. */
function words(key: string): string {
  const text = decodeURIComponent(key).replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a cached path is, in words; null for anything that is not a page worth offering. */
export function offlinePage(path: string): OfflinePage | null {
  const url = new URL(path, 'https://portal.invalid');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const known = PAGES[pathname];
  if (known) {
    const filtered = url.search !== '' && pathname !== '/';
    return { path, label: filtered ? `${known} (filtered)` : known };
  }
  const request = /^\/tickets\/([^/]+)$/.exec(pathname);
  if (request) return { path, label: decodeURIComponent(request[1]!), kind: 'Request' };
  const article = /^\/knowledge\/([^/]+)$/.exec(pathname);
  if (article) return { path, label: words(article[1]!), kind: 'Article' };
  const service = /^\/catalogue\/([^/]+)$/.exec(pathname);
  if (service) return { path, label: words(service[1]!), kind: 'Service' };
  return null;
}

export function AvailableOffline(): ReactNode {
  const [pages, setPages] = useState<readonly OfflinePage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void cachedPages().then((paths) => {
      if (cancelled) return;
      setPages(paths.map(offlinePage).filter((page): page is OfflinePage => page !== null));
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
        <p className="app-Offline__empty">Nothing is saved on this device yet. Pages you open are kept for next time.</p>
      ) : (
        <ul className="app-Offline__list">
          {pages.map((page) => (
            <li key={page.path}>
              <a className="app-Offline__link" href={page.path}>
                {page.label}
                {page.kind ? <span className="app-Offline__kind"> · {page.kind}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
