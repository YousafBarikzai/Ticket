import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { KnownIssuesSource } from '../../../help/known-issues.js';
import { knownIssuesFrom } from '../../../help/model.js';
import { followUrlFor, readStatus } from '../../../help/status.js';
import { HomeHero } from '../../../home/HomeHero.js';
import { greetingFor, parseChannels, todayLabel, updatedLabel } from '../../../home/model.js';
import {
  GoodToKnowSection,
  GoodToKnowSkeleton,
  IncidentBanner,
  Topics,
  TopicsSkeleton,
  YourRequests,
  YourRequestsSkeleton,
} from '../../../home/sections.js';
import { settle } from '../../../home/settle.js';
import { portalCan } from '../../../navigation.js';
import { apiFor, currentApprovals, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import '../../../home/home.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Home' };

/**
 * Home (SPEC §6.3 `/`, X-34, D17): what every member of staff sees first, so
 * it asks one question and answers the next few before they are asked.
 *
 *   1. **The hero** — today's date, a greeting in their own time zone, one
 *      sentence, the "How can we help?" search and *New request*, the page's
 *      one primary action.
 *   2. **An open incident**, when there is one ("VPN is degraded. We're on
 *      it"), so nobody reports what the desk already knows.
 *   3. **Your requests** — one list, what needs them pinned first with its
 *      action right there (Reply · "Yes, it's fixed" / "No" · Review), five
 *      at most, "See all" always.
 *   4. **Three topics** for somebody who would rather pick than type.
 *   5. **Good to know** — service status, popular answers, other ways in.
 *
 * Every read starts at once. The status page is waited for (briefly — it is
 * bounded) because the incident banner sits near the top and should not push
 * the page down after it has drawn; everything else streams into its own
 * section with a skeleton of its own shape, and fails on its own. The
 * approvals come from the frame's call (`cache()`), not a second one.
 */
export default async function HomePage(): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const can = portalCan(heldPermissions(me));
  const api = apiFor(session);
  const now = new Date();

  // Everything starts now; each section waits only for its own.
  const requests = settle(api.myTickets({ statusCategory: 'open,paused,resolved', limit: 20 }));
  const approvals = can.readApprovals ? currentApprovals() : Promise.resolve(null);
  const catalogue = can.readCatalogue ? settle(api.catalogue()) : null;
  const articles = can.readKnowledge ? settle(api.knowledge({ status: 'published', limit: 200 })) : null;
  const status = await readStatus(api, me.tenant?.slug);

  const issues = knownIssuesFrom(status.status);
  const followUrl = followUrlFor(status.status);
  const channels = parseChannels(process.env.PORTAL_CHANNELS);

  return (
    <div className="app-Page app-Home">
      <KnownIssuesSource issues={issues} followUrl={followUrl} />

      <header className="app-Home__hero">
        <p className="app-Home__date">{todayLabel(now, me.locale, me.timeZone)}</p>
        <h1 className="app-Home__greeting" tabIndex={-1}>
          {greetingFor(now, me.timeZone, me.actor.displayName)}
        </h1>
        <p className="app-Home__lede">Search for an answer, or tell us what’s wrong.</p>
        <HomeHero
          can={{ search: can.search, readKnowledge: can.readKnowledge, readCatalogue: can.readCatalogue, createTickets: can.createTickets }}
        />
      </header>

      {issues.length > 0 ? <IncidentBanner issues={issues} followUrl={followUrl} updatedLabel={updatedLabel(issues[0]!.updatedAt, now, me.locale, me.timeZone)} /> : null}

      <div className="app-Home__grid">
        <div className="app-Home__main">
          <Suspense fallback={<YourRequestsSkeleton />}>
            <YourRequests requests={requests} approvals={approvals} />
          </Suspense>
          {catalogue ? (
            <Suspense fallback={<TopicsSkeleton />}>
              <Topics catalogue={catalogue} />
            </Suspense>
          ) : null}
        </div>
        <Suspense fallback={<GoodToKnowSkeleton />}>
          <GoodToKnowSection status={status} articles={articles} channels={channels} canBrowseKnowledge={can.readKnowledge} drawnAt={now.toISOString()} />
        </Suspense>
      </div>
    </div>
  );
}
