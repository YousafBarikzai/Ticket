import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { AREAS } from '@itsm/contracts/areas';
import { KnownIssuesSource } from '../../../help/known-issues.js';
import { knownIssuesFrom } from '../../../help/model.js';
import { followUrlFor, readStatus } from '../../../help/status.js';
import { HomeHero } from '../../../home/HomeHero.js';
import { greetingFor, incidentTone, parseChannels, statusSummary, todayLabel, updatedLabel } from '../../../home/model.js';
import { QuickActionsSkeleton } from '../../../home/QuickActions.js';
import { CommonRequestsSkeleton } from '../../../home/CommonRequests.js';
import { RefreshOnReturn } from '../../../home/RefreshOnReturn.js';
import { HomeAsideSection, HomeAsideSkeleton, HomeCommonRequests, HomeQuickActions, YourRequests, YourRequestsSkeleton } from '../../../home/sections.js';
import { settle } from '../../../home/settle.js';
import { StatusStrip } from '../../../home/StatusStrip.js';
import { portalCan } from '../../../navigation.js';
import { apiFor, currentApprovals, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import '../../../home/home.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Home' };

/**
 * Home v3 (v3 §7.2, A6 §6.1; SPEC §6.3, X-34, D17): search-first help, and
 * what is waiting on *you*, in one glance.
 *
 *   1. **The hero**, a light band — the workspace and the area as a kicker,
 *      the greeting in the person's own time zone, today's date and one
 *      sentence, the "How can we help?" search and *New request*, the page's
 *      one primary action; then **four quick actions** with their counts
 *      (Report an issue · Request something · My requests · Approvals).
 *   2. **The status strip** — an open incident ("VPN partial outage. We're on
 *      it"), so nobody reports what the desk already knows; or one calm line
 *      that all is running.
 *   3. **Your requests** as cards, what needs them pinned first with its
 *      action right there and a mini stepper; five at most, "See all" always.
 *   4. **The aside** — popular answers with their views, maintenance coming
 *      up, other ways to reach us.
 *   5. **Common requests** — six things to ask for, then all services.
 *
 * Every read starts at once. The status page is waited for (briefly — it is
 * bounded) because the strip sits near the top and should not push the page
 * down after it has drawn; everything else streams into its own section with
 * a skeleton of its own shape, and fails on its own. The approvals come from
 * the frame's call (`cache()`), not a second one.
 */
export default async function HomePage(): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const can = portalCan(heldPermissions(me));
  const api = apiFor(session);
  const now = new Date();
  const drawnAt = now.toISOString();

  // Everything starts now; each section waits only for its own.
  const requests = settle(api.myTickets({ statusCategory: 'open,paused,resolved', limit: 20 }));
  const approvals = can.readApprovals ? currentApprovals() : Promise.resolve(null);
  const catalogue = can.readCatalogue ? settle(api.catalogue()) : null;
  const articles = can.readKnowledge ? settle(api.knowledge({ status: 'published', limit: 200 })) : null;
  const status = await readStatus(api, me.tenant?.slug);

  const issues = knownIssuesFrom(status.status);
  const followUrl = followUrlFor(status.status);
  const channels = parseChannels(process.env.PORTAL_CHANNELS);
  const workspace = me.demo?.company ?? me.tenant?.name ?? null;
  const checkedLabel = updatedLabel(drawnAt, now, me.locale, me.timeZone);

  return (
    <div className="app-Page app-Home">
      <KnownIssuesSource issues={issues} followUrl={followUrl} />
      <RefreshOnReturn drawnAt={drawnAt} busyTarget="home-status" />

      <header className="app-Home__hero" data-variant="light">
        <p className="app-Home__kicker">{workspace ? `${workspace} · ${AREAS.portal.name}` : AREAS.portal.name}</p>
        <h1 className="app-Home__greeting" tabIndex={-1}>
          {greetingFor(now, me.timeZone, me.actor.displayName)}
        </h1>
        <p className="app-Home__lede">
          <span className="app-Home__date">{todayLabel(now, me.locale, me.timeZone)}</span>
          <span aria-hidden="true"> · </span>
          <span className="app-Home__ask-line">Search for an answer, or tell us what’s wrong.</span>
        </p>
        <HomeHero
          can={{ search: can.search, readKnowledge: can.readKnowledge, readCatalogue: can.readCatalogue, createTickets: can.createTickets }}
        />
        <Suspense fallback={<QuickActionsSkeleton />}>
          <HomeQuickActions
            can={{ createTickets: can.createTickets, readCatalogue: can.readCatalogue, readApprovals: can.readApprovals }}
            requests={requests}
            approvals={approvals}
          />
        </Suspense>
      </header>

      <div id="home-status" className="app-Home__status">
        <StatusStrip
          issues={issues}
          issueTone={issues[0] ? incidentTone(status.status, issues[0].id) : 'high'}
          summary={status.status ? statusSummary(status.status) : null}
          failed={status.failed}
          followUrl={followUrl}
          updatedLabel={issues[0] ? updatedLabel(issues[0].updatedAt, now, me.locale, me.timeZone) : null}
          checkedLabel={checkedLabel}
        />
      </div>

      <div className="app-Home__grid">
        <div className="app-Home__main">
          <Suspense fallback={<YourRequestsSkeleton />}>
            <YourRequests requests={requests} approvals={approvals} drawnAt={drawnAt} />
          </Suspense>
        </div>
        <Suspense fallback={<HomeAsideSkeleton />}>
          <HomeAsideSection
            status={status.status}
            articles={articles}
            channels={channels}
            canBrowseKnowledge={can.readKnowledge}
            drawnAt={drawnAt}
            locale={me.locale}
            timeZone={me.timeZone}
          />
        </Suspense>
      </div>

      {catalogue ? (
        <Suspense fallback={<CommonRequestsSkeleton />}>
          <HomeCommonRequests catalogue={catalogue} />
        </Suspense>
      ) : null}
    </div>
  );
}
