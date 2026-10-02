import type { ReactNode } from 'react';
import { BrandMark, Icon, type IconName } from '@itsm/ui';
import { siteConfig, type SiteArea } from '../server/config.js';
import { workAccountHref } from '../server/links.js';

/**
 * The holding page (SPEC v3 §15 WP-10): the product's lockup, one sentence and
 * a way to sign in to each area — the smallest page that proves the fourth
 * service end to end (build, budget, image, scan, deploy, smoke test) a wave
 * before the landing page replaces it (WP-50).
 *
 * Rendered per request because its links are runtime configuration: the image
 * is built before Railway has named the hosts, so a page rendered at build
 * time would link to nowhere.
 *
 * Every sign-in is a plain `<a>` to that app's `/api/session/login` with
 * `account=1` (`workAccountHref`): a full navigation through the identity
 * provider, no client code, no prefetch. An area whose origin this deployment
 * does not know is shown as unavailable rather than linked to `undefined`.
 */
export const dynamic = 'force-dynamic';

interface AreaRow {
  readonly id: SiteArea;
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
}

/**
 * The three areas, in their canonical order with their canonical names and
 * descriptions (SPEC §3.1 `AREAS`). Written out here for the one wave before
 * `@itsm/contracts/areas` exists; the landing page and the chooser read them
 * from there.
 */
const AREA_ROWS: readonly AreaRow[] = [
  { id: 'portal', name: 'Help Portal', description: 'Get help, request things and follow your requests', icon: 'life-buoy' },
  { id: 'workbench', name: 'Service Desk', description: 'Work tickets, queues and SLAs', icon: 'inbox' },
  { id: 'admin', name: 'Administration', description: 'Set up rules, SLAs, people and reports', icon: 'settings-2' },
];

export default function HoldingPage(): ReactNode {
  const config = siteConfig();
  return (
    <>
      <main id="main" tabIndex={-1} className="app-Holding">
        <div className="app-Holding__card">
          <div className="app-Holding__lockup">
            <BrandMark size={40} />
            <h1 className="app-Holding__title">IT Service Management</h1>
          </div>
          <p className="app-Holding__lead">
            Give employees one place to ask for help, give your service desk a clear view of every ticket and its SLA, and run it
            all from one console.
          </p>
          <section className="app-Holding__signIn" aria-labelledby="sign-in-title">
            <h2 id="sign-in-title" className="app-Holding__heading">
              Sign in with your work account
            </h2>
            <ul className="app-AreaList">
              {AREA_ROWS.map((area) => {
                const href = workAccountHref(config, area.id);
                const body = (
                  <>
                    <span className="app-AreaList__icon" aria-hidden="true">
                      <Icon name={area.icon} size="md" />
                    </span>
                    <span className="app-AreaList__text">
                      <span className="app-AreaList__name">{area.name}</span>
                      <span className="app-AreaList__description">
                        {href ? area.description : "This part isn't available right now."}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={area.id}>
                    {href ? (
                      <a
                        className="app-AreaList__row"
                        href={href}
                        data-area={area.id}
                        aria-label={`Sign in to ${area.name} — ${area.description}`}
                      >
                        {body}
                        <Icon name="chevron-right" size="sm" className="app-AreaList__chevron" directional />
                      </a>
                    ) : (
                      <span className="app-AreaList__row" data-area={area.id} data-unavailable="">
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="app-Holding__help">No account yet? Ask your IT team to invite you.</p>
          </section>
        </div>
      </main>
      <footer className="app-Holding__footer">
        <p>Powered by VNE Technologies</p>
      </footer>
    </>
  );
}
