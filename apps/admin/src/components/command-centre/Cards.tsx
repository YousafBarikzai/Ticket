import type { ReactNode } from 'react';
import type { Admin, Me } from '@itsm/sdk';
import { ActivityFeed, Avatar, Banner, Button, Card, EmptyState, Skeleton, SkeletonCard, SkeletonList, SkeletonStat, StatusPill, type Problem } from '@itsm/ui';
import { BarChart, LineChart, StatCard, StatGrid } from '@itsm/ui/charts';
import { formatDateTime, formatRelative } from '@itsm/ui/format';
import { holdsAny } from '../../permissions.js';
import { needsAttention, reachable } from '../../server/needs-attention.js';
import { chartScale, hasData, rangeLabel, statFormat, statValue, toBars, toSeries } from '../insights/presentation.js';
import { loadDeskHealth, loadOnCall, loadRecentChanges, loadSetup, loadVolume, type VolumeRange } from './data.js';
import { statusLine } from './presentation.js';
import { BriefingLead } from './SetupChecklist.js';
import { VolumeView } from './VolumeView.js';

/**
 * The Command centre's cards, each an async server component the page puts
 * in its own `<Suspense>` with the skeleton below it (SPEC §4.10 "Section
 * loading"): each streams in when its data arrives and fails on its own.
 */

interface Actor {
  readonly me: Me;
  readonly api: Admin;
}

/* -------------------------------------------------------------------------
 * The status line and the incident banner
 * ---------------------------------------------------------------------- */

/** "Two things need you, one of them urgent." — after the greeting, from the same answer the card shows. */
export async function StatusClause({ me, api, workbench }: Actor & { readonly workbench: string | undefined }): Promise<ReactNode> {
  const line = statusLine(await needsAttention(me, api, workbench));
  return line ? <span className="app-Briefing__status"> {line}</span> : null;
}

/**
 * An open major incident, above everything (SPEC §6.1): the one thing on the
 * page allowed to shout. There is no incident page in either app yet, so the
 * banner says what and when, and offers nothing it cannot deliver.
 */
export async function IncidentBanners({ me, api, workbench }: Actor & { readonly workbench: string | undefined }): Promise<ReactNode> {
  const { incidents } = await needsAttention(me, api, workbench);
  if (incidents.length === 0) return null;
  const now = Date.now();
  return (
    <div className="app-Briefing__incidents">
      {incidents.slice(0, 2).map((incident) => (
        <Banner key={incident.number} tone="danger" title={`Major incident · ${incident.number}`}>
          {incident.title} · {severityWords(incident.severity)} · declared{' '}
          {formatRelative(incident.declaredAt, now, me.locale, { timeZone: me.timeZone, style: 'long' })}
        </Banner>
      ))}
    </div>
  );
}

function severityWords(severity: string): string {
  const match = /^(?:sev|s)?\s*(\d)$/i.exec(severity.trim());
  return match ? `Sev ${match[1]}` : severity;
}

/* -------------------------------------------------------------------------
 * Needs attention and the first-run checklist
 * ---------------------------------------------------------------------- */

export async function LeadCards({ me, api, workbench, force }: Actor & { readonly workbench: string | undefined; readonly force: boolean }): Promise<ReactNode> {
  const [attention, steps] = await Promise.all([needsAttention(me, api, workbench), loadSetup(me, api)]);
  return (
    <BriefingLead
      steps={steps.length > 0 ? steps : null}
      force={force}
      attention={attention.consulted > 0 ? { items: attention.items, failures: attention.failures, checkedAt: attention.checkedAt } : null}
    />
  );
}

export function LeadSkeleton(): ReactNode {
  return (
    <div className="app-Skeleton" aria-hidden="true">
      <SkeletonCard lines={4} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Desk health
 * ---------------------------------------------------------------------- */

export async function DeskHealthCard({ me, api }: Actor): Promise<ReactNode> {
  const health = await loadDeskHealth(me, api);
  if (health.source === 'none') return null;
  if (health.empty) {
    return (
      <Card title="Desk health" className="app-Health">
        <EmptyState
          size="sm"
          headingLevel={3}
          icon="insights"
          title="No data for this period yet"
          description="Numbers appear here as tickets are raised and worked."
          className="app-Health__empty"
        />
      </Card>
    );
  }
  return (
    <Card title="Desk health" className="app-Health">
      <StatGrid columns={2}>
        {health.stats.map((stat) => (
          <StatCard
            key={stat.id}
            label={stat.label}
            value={statValue(stat.unit, stat.value)}
            format={statFormat(stat.unit)}
            surface="sunken"
            locale={me.locale}
            {...(stat.approx ? { approx: 'atLeast' as const } : {})}
            {...(stat.href ? { href: stat.href } : {})}
            {...(stat.trend ? { trend: stat.trend } : {})}
            {...(stat.secondary ? { secondary: stat.secondary } : {})}
            {...(stat.footnote ? { footnote: stat.footnote } : {})}
            {...(stat.status ? { status: stat.status } : {})}
            {...(stat.problem ? { problem: stat.problem } : {})}
            {...(stat.delta
              ? { delta: { value: stat.delta.value, period: stat.delta.period, format: { style: 'percent', maximumFractionDigits: 0 }, goodDirection: 'down' as const } }
              : {})}
          />
        ))}
      </StatGrid>
    </Card>
  );
}

export function HealthSkeleton(): ReactNode {
  return (
    <div className="app-Skeleton" aria-hidden="true">
      <Card title="Desk health">
        <StatGrid columns={2}>
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </StatGrid>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Volume
 * ---------------------------------------------------------------------- */

export async function VolumeCard({ me, api, range }: Actor & { readonly range: VolumeRange }): Promise<ReactNode> {
  const volume = await loadVolume(api, range);
  const period = rangeLabel(range).toLowerCase();
  const empty = `No tickets in the ${period}`;

  const lines =
    volume.raised.ok && volume.resolved.ok && !hasData(volume.raised.value) && !hasData(volume.resolved.value) ? (
      // Two flat lines at zero say less than one sentence does.
      <EmptyState size="sm" headingLevel={3} icon="insights" title={empty} description="Raised and resolved tickets are drawn here as they happen." className="app-Volume__empty" />
    ) : volume.raised.ok && volume.resolved.ok ? (
      <LineChart
        title={`Tickets raised and resolved, ${period}`}
        titleHidden
        xType="time"
        interactive
        locale={me.locale}
        timeZone={me.timeZone}
        yFormat={chartScale('count', []).format}
        emptyText={empty}
        series={[toSeries('raised', 'Raised', volume.raised.value.series, 1, 1), toSeries('resolved', 'Resolved', volume.resolved.value.series, 1, 2)]}
      />
    ) : (
      <Failure problem={!volume.raised.ok ? volume.raised.problem : !volume.resolved.ok ? volume.resolved.problem : undefined} />
    );

  const bars = (result: typeof volume.byChannel, title: string, dimension: string): ReactNode =>
    result.ok ? (
      <BarChart
        title={title}
        titleHidden
        variant="list"
        locale={me.locale}
        emptyText={empty}
        maxBars={8}
        valueFormat={chartScale('count', []).format}
        data={toBars(result.value.groups, 1, dimension)}
      />
    ) : (
      <Failure problem={result.problem} />
    );

  return (
    <VolumeView
      range={range}
      views={{
        time: lines,
        channel: bars(volume.byChannel, `Tickets raised by channel, ${period}`, 'channel'),
        team: bars(volume.byTeam, `Tickets raised by team, ${period}`, 'teamId'),
      }}
    />
  );
}

function Failure({ problem }: { readonly problem: Problem | undefined }): ReactNode {
  return (
    <Banner tone="warning" variant="subtle" live={false}>
      Couldn’t load this chart{problem?.status === 403 ? ' — it needs Read insights' : ''}. Refresh to try again.
    </Banner>
  );
}

export function VolumeSkeleton(): ReactNode {
  return (
    <div className="app-Skeleton" aria-hidden="true">
      <Card title="Volume">
        <Skeleton height={220} radius="md" />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * On call now
 * ---------------------------------------------------------------------- */

export async function OnCallCard({ me, api }: Actor): Promise<ReactNode> {
  const onCall = await loadOnCall(api);
  const all = reachable(me, '/workforce/on-call', '/workforce');
  const cover = holdsAny(me, ['workload.oncall.override']) ? reachable(me, '/workforce/on-call') : undefined;

  if (onCall.problem) {
    return <Card title="On call now" problem={onCall.problem} />;
  }
  if (onCall.rotas.length === 0) {
    return (
      <Card title="On call now">
        <EmptyState
          size="sm"
          headingLevel={3}
          icon="calendar"
          title="Nobody is on call"
          description="On-call rotas set up in Workforce appear here, with who has the pager now."
          {...(all && holdsAny(me, ['workload.manage']) ? { action: { id: 'rotas', label: 'Go to Workforce', href: all, variant: 'secondary' as const } } : {})}
        />
      </Card>
    );
  }

  return (
    <Card
      title="On call now"
      footer={
        all || cover ? (
          <div className="app-OnCall__foot">
            {cover ? (
              <Button size="sm" variant="secondary" href={cover}>
                Cover…
              </Button>
            ) : null}
            {all ? (
              <Button size="sm" variant="ghost" href={all} iconEnd="chevron-right">
                {onCall.more > 0 ? `All ${onCall.rotas.length + onCall.more} rotas` : 'All rotas'}
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <ul className="app-OnCall__list">
        {onCall.rotas.map((rota) => {
          const name = rota.person ? (rota.person.name ?? 'Unknown person') : null;
          return (
            <li key={rota.key} className="app-OnCall__rota">
              {name ? <Avatar name={name} size="md" decorative /> : <Avatar name="Nobody" kind="system" size="md" decorative />}
              <div className="app-OnCall__who">
                <p className="app-OnCall__name">
                  {rota.problem ? 'Couldn’t load this rota' : (name ?? 'Nobody on call')}{' '}
                  {rota.covering ? <StatusPill size="sm" tone="info" label="Covering" /> : null}
                </p>
                <p className="app-OnCall__rotaName">{rota.name}</p>
                {rota.handoverAt ? (
                  <p className="app-OnCall__next">
                    Hands over {formatDateTime(rota.handoverAt, { locale: me.locale, timeZone: rota.timeZone, style: 'weekdayTime' })} ({rota.timeZone})
                    {rota.next ? ` · next ${rota.next.name ?? 'Unknown person'}` : ''}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function ListSkeleton({ title, rows = 3 }: { readonly title: string; readonly rows?: number }): ReactNode {
  return (
    <div className="app-Skeleton" aria-hidden="true">
      <Card title={title}>
        <SkeletonList rows={rows} />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Recent changes
 * ---------------------------------------------------------------------- */

export async function RecentChangesCard({ me, api }: Actor): Promise<ReactNode> {
  const changes = await loadRecentChanges(me, api);
  if (!changes) return null;
  if (changes.problem) return <Card title="Recent changes" problem={changes.problem} />;
  const audit = reachable(me, '/audit');
  return (
    <Card
      title="Recent changes"
      footer={
        audit ? (
          <div className="app-Changes__foot">
            <Button size="sm" variant="ghost" href={audit} iconEnd="chevron-right">
              Open audit log
            </Button>
          </div>
        ) : undefined
      }
    >
      <ActivityFeed
        label="Recent changes"
        items={changes.items}
        groupBy="none"
        headingLevel={3}
        empty={{ title: 'No changes yet', description: 'Changes to rules, service levels, settings and people appear here.' }}
      />
    </Card>
  );
}
