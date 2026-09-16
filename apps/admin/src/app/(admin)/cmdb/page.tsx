import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Services and CMDB' };
export const dynamic = 'force-dynamic';

const CRITICALITY: Record<string, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

/**
 * What this desk runs on (MOD-10-E1).
 *
 * Configuration items, their classes and the asset register — three lists the
 * API has served since MOD-10-E1 with no screen at all, which meant that an
 * estate imported by discovery could only be checked by querying the database.
 *
 * Retired items are excluded, as the API excludes them by default. That is
 * worth stating because it is the one place this screen and the database
 * disagree on what "everything" means, and a CMDB that silently shows decommissioned
 * kit is a CMDB people stop trusting.
 *
 * The services half of "Services and CMDB" is the catalogue, which already has
 * a builder — so this links there rather than growing a second one.
 */
export default async function CmdbPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  const mayReadCis = holds(me, 'cmdb.read') || holds(me, 'cmdb.manage');
  const mayReadAssets = holds(me, 'asset.read') || holds(me, 'asset.manage');

  if (!mayReadCis && !mayReadAssets) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's estate"
        description="It needs cmdb.read for configuration items or asset.read for the asset register."
      />
    );
  }

  const [classes, cis, assets] = await Promise.all([
    mayReadCis ? read(() => api.observe.estate.classes()) : null,
    mayReadCis ? read(() => api.observe.estate.cis({ limit: 100 })) : null,
    mayReadAssets ? read(() => api.observe.estate.assets({ limit: 100 })) : null,
  ]);

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Services and CMDB</h1>
        <p className="itsm-Admin__lede">
          The estate a ticket can point at. Services people can ask for live in{' '}
          <Link href="/catalogue">the catalogue</Link>; what follows is what those services run on.
        </p>
      </header>

      {cis ? (
        <Panel
          title="Configuration items"
          description="Up to a hundred, retired ones excluded — the same default the API applies."
          result={cis}
          empty="Nothing in the CMDB. Discovery has either not run or found nothing it was allowed to record."
        >
          {(rows) => (
            <Table
              caption="Configuration items"
              columns={[
                { key: 'name', header: 'Name', cell: (row) => row.name },
                {
                  key: 'criticality',
                  header: 'Criticality',
                  cell: (row) => (
                    <Badge intent={CRITICALITY[row.criticality] ?? 'neutral'} srPrefix="Criticality">
                      {row.criticality}
                    </Badge>
                  ),
                },
                { key: 'status', header: 'Status', cell: (row) => row.status },
                { key: 'environment', header: 'Environment', cell: (row) => row.environment ?? '—' },
                {
                  key: 'source',
                  header: 'Recorded by',
                  cell: (row) => (row.source === 'manual' ? 'A person' : row.source),
                },
                { key: 'seen', header: 'Updated', cell: (row) => new Date(row.updatedAt).toLocaleDateString() },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      {classes ? (
        <Panel
          title="Classes"
          description="What kinds of thing this CMDB knows about, and which attributes each carries."
          result={classes}
          empty="No classes. Nothing can be added to the CMDB until there is a class to add it to."
        >
          {(rows) => (
            <Table
              caption="Configuration item classes"
              columns={[
                { key: 'name', header: 'Class', cell: (row) => row.name },
                { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
                { key: 'parent', header: 'Inherits from', cell: (row) => (row.parentId ? 'A parent class' : '—') },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      {assets ? (
        <Panel
          title="Assets"
          description="The register: tags, warranties and who holds what."
          result={assets}
          empty="No assets recorded."
        >
          {(rows) => (
            <Table
              caption="Asset register"
              columns={[
                { key: 'tag', header: 'Tag', cell: (row) => <code>{row.tag}</code> },
                { key: 'serial', header: 'Serial', cell: (row) => row.serial ?? '—' },
                { key: 'status', header: 'Status', cell: (row) => row.status },
                { key: 'location', header: 'Where', cell: (row) => row.location ?? '—' },
                { key: 'cost', header: 'Cost centre', cell: (row) => row.costCentre ?? '—' },
                { key: 'warranty', header: 'Warranty ends', cell: (row) => row.warrantyEndsOn ?? '—' },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Relationships, impact and dependency traversal are all served by the API and shown nowhere. They are a graph,
          and a graph drawn badly is worse than a link somebody follows themselves — so they are waiting for a screen
          that can do them properly rather than a table of edges.
        </p>
      </section>
    </div>
  );
}
