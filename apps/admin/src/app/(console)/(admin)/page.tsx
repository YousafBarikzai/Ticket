import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { EmptyState, Icon } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { AppLink } from '../../AppLink.js';
import { Forbidden } from '../../../components/Forbidden.js';
import {
  DeskHealthCard,
  HealthSkeleton,
  IncidentBanners,
  LeadCards,
  LeadSkeleton,
  ListSkeleton,
  OnCallCard,
  RecentChangesCard,
  StatusClause,
  VolumeCard,
  VolumeSkeleton,
} from '../../../components/command-centre/Cards.js';
import { SETUP_WRITES, volumeRange } from '../../../components/command-centre/data.js';
import { greeting } from '../../../components/command-centre/presentation.js';
import { SignOutButton } from '../../../components/command-centre/SignOutButton.js';
import { UpdatedAt } from '../../../components/command-centre/UpdatedAt.js';
import { WithheldSections } from '../../../components/command-centre/WithheldSections.js';
import { visibleNav, withheldNav } from '../../../navigation.js';
import { holdsAny } from '../../../permissions.js';
import { reachable, sourcesFor } from '../../../server/needs-attention.js';
import { pageAccess } from '../../../server/session.js';
import '../../../components/command-centre/shared.css';
import '../../../components/command-centre/command-centre.css';

export const metadata: Metadata = { title: 'Command centre' };
export const dynamic = 'force-dynamic';

/**
 * The Command centre: "Is the desk healthy, and what needs me?" in five
 * seconds (SPEC §6.1, X-30). A briefing, not a board.
 *
 * A greeting and one status line; then what needs you (or, on a new desk,
 * the setup checklist) beside desk health; then one volume chart beside who
 * is on call and the last few configuration changes. There is no primary
 * button — creating things lives in ⌘K and on each list — and the old
 * sitemap of section cards is gone: the sidebar is the map, and what this
 * person cannot open is listed, once, at the foot with the permission to ask
 * for.
 *
 * The page's own render awaits nothing but the gate (the frame already
 * loaded `/me`); each card streams in its own `<Suspense>` with a skeleton of
 * its shape, and fails on its own. Which cards exist is decided here from
 * permissions, so the two columns never hold a hole.
 */
export default async function CommandCentrePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const access = await pageAccess('/');
  if (!access.allowed) return <Forbidden route="/" />;
  const { me, api } = access;

  const params = await searchParams;
  const range = volumeRange(single(params.range));
  const forceSetup = single(params.setup) === '1';
  // Needs attention reads the request's areas itself (`currentAreas()`), so its
  // Service Desk links go through `crossAreaHref`; the cards' v2 `workbench`
  // prop is no longer read and goes with WP-55's rebuild of the cards.
  const workbench = undefined;
  const now = new Date();
  const hello = greeting(me.actor.displayName, now, me.timeZone);
  const withheld = withheldNav(me);
  const sections = visibleNav(me).filter((item) => item.id !== 'command-centre');

  if (sections.length === 0) {
    // Nothing on the console opens for this account: say so, say what to ask
    // for, and offer the one thing left to do.
    return (
      <div className="app-Page app-Briefing">
        <PageHeader title="Command centre" largeTitle />
        <EmptyState
          size="lg"
          tone="forbidden"
          title="Your account can’t configure anything here"
          description="Ask an administrator for a role that includes what you need. Each section below names the permission it needs."
          action={<SignOutButton />}
        />
        <WithheldSections withheld={withheld} open />
      </div>
    );
  }

  const has = {
    attention: sourcesFor(me).length > 0,
    setup: holdsAny(me, Object.values(SETUP_WRITES)),
    volume: holdsAny(me, ['analytics.read']),
    health: holdsAny(me, ['analytics.read', 'ticket.read']),
    onCall: holdsAny(me, ['workload.read', 'workload.manage']),
    changes: holdsAny(me, ['audit.read', 'admin.activity.read']),
  };
  const mainEmpty = !has.attention && !has.setup && !has.volume;
  const sideEmpty = !has.health && !has.onCall && !has.changes;
  const insights = reachable(me, '/insights');
  const audit = has.changes ? undefined : reachable(me, '/audit');

  return (
    <div className="app-Page app-Briefing">
      <PageHeader title="Command centre" largeTitle status={<UpdatedAt at={now.toISOString()} />} />
      <p className="app-Briefing__greeting">
        {hello}.
        <Suspense fallback={null}>
          <StatusClause me={me} api={api} workbench={workbench} />
        </Suspense>
      </p>

      <Suspense fallback={null}>
        <IncidentBanners me={me} api={api} workbench={workbench} />
      </Suspense>

      <div className="app-Briefing__grid" data-main={mainEmpty ? 'none' : undefined} data-side={sideEmpty ? 'none' : undefined}>
        {mainEmpty ? null : (
          <div className="app-Briefing__main">
            <div className="app-Briefing__lead">
              <Suspense fallback={<LeadSkeleton />}>
                <LeadCards me={me} api={api} workbench={workbench} force={forceSetup} />
              </Suspense>
            </div>
            {has.volume ? (
              <div className="app-Briefing__volume">
                {/* No key on the range: a new period arrives in a transition, and the chart stays until it does. */}
                <Suspense fallback={<VolumeSkeleton />}>
                  <VolumeCard me={me} api={api} range={range} />
                </Suspense>
              </div>
            ) : null}
          </div>
        )}
        {sideEmpty ? null : (
          <div className="app-Briefing__side">
            {has.health ? (
              <div className="app-Briefing__health">
                <Suspense fallback={<HealthSkeleton />}>
                  <DeskHealthCard me={me} api={api} />
                </Suspense>
              </div>
            ) : null}
            {has.onCall ? (
              <div className="app-Briefing__oncall">
                <Suspense fallback={<ListSkeleton title="On call now" rows={2} />}>
                  <OnCallCard me={me} api={api} />
                </Suspense>
              </div>
            ) : null}
            {has.changes ? (
              <div className="app-Briefing__changes">
                <Suspense fallback={<ListSkeleton title="Recent changes" rows={3} />}>
                  <RecentChangesCard me={me} api={api} />
                </Suspense>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {insights || audit ? (
        <nav className="app-Briefing__more" aria-label="More">
          {insights ? (
            <AppLink href={insights}>
              More in Insights <Icon name="chevron-right" size="xs" directional />
            </AppLink>
          ) : null}
          {audit ? (
            <AppLink href={audit}>
              Recent changes <Icon name="chevron-right" size="xs" directional />
            </AppLink>
          ) : null}
        </nav>
      ) : null}

      <WithheldSections withheld={withheld} />
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
