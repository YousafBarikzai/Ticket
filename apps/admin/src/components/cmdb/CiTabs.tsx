'use client';

import type { ReactNode } from 'react';
import type { CiAttribute, CiClassRow, CiHistory, CiRelationships, ImpactResult } from '@itsm/sdk';
import { Button, DescriptionList, EmptyState, Icon, IconButton, ProblemState, RelativeTime, SkeletonList, StatusPill, Timeline, useItsm, type TimelineEvent } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { api } from '../../client/api.js';
import { PersonCell, shortId } from '../PersonCell.js';
import {
  CI_STATUS_LOOK,
  CRITICALITY_LOOK,
  ENTITY_LOOK,
  LINK_ROLE_LABEL,
  SOURCE_LOOK,
  attributeText,
  classPath,
  edgeLabel,
  historyEntry,
  humanise,
  impactGroups,
  impactSentence,
  lookOf,
  relationSentence,
  verbOf,
  type CiView,
} from './presentation.js';
import { useLoad, type LoadCache, type LoadState } from './useLoad.js';

/**
 * The panels of an item's drawer (SPEC §6.1 `/cmdb`): Overview (the facts and
 * the class's details), Relationships (what it needs and what needs it, with
 * Relate… and remove), Impact ("if this fails", by distance), Linked (the
 * tickets, incidents, problems and changes that named it) and History (its
 * audit trail). Each reads what it shows through the SDK when first chosen;
 * the drawer keeps the answers while it is open.
 */

function Loading({ label }: { readonly label: string }): ReactNode {
  return <SkeletonList rows={3} label={label} />;
}

function Failed({ state, retry }: { readonly state: LoadState<unknown>; retry(): void }): ReactNode {
  if (state.status !== 'failed') return null;
  return <ProblemState problem={state.problem} size="sm" onRetry={retry} />;
}

/* ------------------------------------------------------------------ Overview */

export function OverviewTab({
  ci,
  classes,
  cache,
}: {
  readonly ci: CiView;
  readonly classes: readonly CiClassRow[];
  readonly cache: LoadCache;
}): ReactNode {
  const { locale, timeZone } = useItsm();
  const status = lookOf(CI_STATUS_LOOK, ci.status);
  const criticality = lookOf(CRITICALITY_LOOK, ci.criticality);
  const source = lookOf(SOURCE_LOOK, ci.source);
  return (
    <div className="app-CiPanel">
      <DescriptionList
        layout="inline"
        dense
        items={[
          { id: 'class', label: 'Class', value: ci.classId ? (classPath(classes, ci.classId) ?? 'A class that’s no longer in use') : 'Not known' },
          { id: 'status', label: 'Status', value: <StatusPill size="sm" label={status.label} tone={status.tone} {...(status.icon ? { icon: status.icon } : {})} /> },
          { id: 'criticality', label: 'Criticality', value: <StatusPill size="sm" label={criticality.label} tone={criticality.tone} icon={criticality.tone === 'neutral' ? 'dot' : 'auto'} /> },
          { id: 'environment', label: 'Environment', value: ci.environment || null },
          {
            id: 'service',
            label: 'Service',
            value: ci.serviceId ? (ci.serviceName ?? 'A service you can’t see in the catalogue') : 'None',
          },
          { id: 'owner', label: 'Owner', value: <PersonCell person={ci.owner} empty="Nobody" /> },
          { id: 'source', label: 'Recorded', value: source.label, hint: ci.source === 'manual' ? 'By a person, here or through the API.' : ci.source === 'discovery' ? 'By discovery, which keeps it in step.' : 'By an import.' },
          ...(ci.externalKey ? [{ id: 'identifier', label: 'Identifier', value: <code className="app-CmdbMono">{ci.externalKey}</code> }] : []),
          { id: 'updated', label: 'Updated', value: <RelativeTime date={ci.updatedAt} /> },
          ...(ci.retiredAt ? [{ id: 'retired', label: 'Retired', value: formatDateTime(ci.retiredAt, { locale, timeZone, style: 'date' }) }] : []),
        ]}
      />
      {ci.description ? (
        <section className="app-CiSection" aria-labelledby={`ci-${ci.id}-description`}>
          <h3 id={`ci-${ci.id}-description`} className="app-CiSection__title">
            Description
          </h3>
          <p className="app-CiSection__text">{ci.description}</p>
        </section>
      ) : null}
      <Details ci={ci} cache={cache} />
    </div>
  );
}

function Details({ ci, cache }: { readonly ci: CiView; readonly cache: LoadCache }): ReactNode {
  const { locale } = useItsm();
  const classKey = ci.classKey;
  const { state, retry } = useLoad<readonly CiAttribute[]>(cache, `${ci.id}:attributes:${classKey ?? '-'}`, () =>
    classKey ? api.observe.estate.classAttributes(classKey) : Promise.resolve([]),
  );
  const title = ci.className ? `${ci.className} details` : 'Details';
  const values = ci.attributes;
  let body: ReactNode;
  if (state.status === 'loading') body = <Loading label="Loading the details…" />;
  else if (state.status === 'failed') body = <Failed state={state} retry={retry} />;
  else {
    const declared = state.value;
    const known = new Set(declared.map((definition) => definition.key));
    const extra = Object.keys(values).filter((key) => !known.has(key));
    body =
      declared.length === 0 && extra.length === 0 ? (
        <p className="app-CiSection__note">{classKey ? 'This class asks for no other details.' : 'No other details recorded.'}</p>
      ) : (
        <>
          {declared.length > 0 ? (
            <DescriptionList
              layout="inline"
              dense
              emptyLabel="Not set"
              items={declared.map((definition) => ({
                id: definition.key,
                label: definition.label,
                value: attributeText(definition, values[definition.key], locale) || null,
                ...(definition.required && (values[definition.key] === undefined || values[definition.key] === null) ? { hint: 'Required by its class, but not set.' } : {}),
              }))}
            />
          ) : null}
          {extra.length > 0 ? (
            <>
              <p className="app-CiSection__note">{classKey ? 'Also recorded, though its class doesn’t ask for them:' : 'Recorded:'}</p>
              <DescriptionList layout="inline" dense items={extra.map((key) => ({ id: `extra-${key}`, label: humanise(key), value: attributeText(undefined, values[key], locale) || null }))} />
            </>
          ) : null}
        </>
      );
  }
  return (
    <section className="app-CiSection" aria-labelledby={`ci-${ci.id}-details`}>
      <h3 id={`ci-${ci.id}-details`} className="app-CiSection__title">
        {title}
      </h3>
      {body}
    </section>
  );
}

/* ------------------------------------------------------------ Relationships */

export interface Edge {
  readonly direction: 'needs' | 'neededBy';
  readonly type: string;
  readonly other: { readonly id: string; readonly name: string; readonly status: string };
}

export function RelationshipsTab({
  ci,
  cache,
  version,
  canManage,
  onOpenCi,
  onRelate,
  onRemove,
}: {
  readonly ci: CiView;
  readonly cache: LoadCache;
  readonly version: number;
  readonly canManage: boolean;
  onOpenCi(id: string): void;
  onRelate(): void;
  onRemove(edge: Edge): void;
}): ReactNode {
  const { state, retry } = useLoad<CiRelationships>(cache, `${ci.id}:relationships:${version}`, () => api.observe.estate.relationships(ci.id));
  const writable = canManage && ci.retiredAt === null;

  const list = (direction: 'needs' | 'neededBy', rows: CiRelationships['needs'], empty: string): ReactNode =>
    rows.length === 0 ? (
      <p className="app-CiSection__note">{empty}</p>
    ) : (
      <ul className="app-CiEdges">
        {rows.map((row) => {
          const edge: Edge = { direction, type: row.type, other: row.ci };
          const status = lookOf(CI_STATUS_LOOK, row.ci.status);
          const sentence = direction === 'needs' ? relationSentence(row.type, ci.name, row.ci.name) : relationSentence(row.type, row.ci.name, ci.name);
          return (
            <li key={`${direction}:${row.type}:${row.ci.id}`} className="app-CiEdge">
              {/* Spaces between the parts, so the line reads as one sentence to a screen reader too. */}
              {direction === 'needs' ? <span className="app-CiEdge__verb">{edgeLabel(row.type, direction)}</span> : null}{' '}
              <button type="button" className="app-CiEdge__name" onClick={() => onOpenCi(row.ci.id)} title={sentence}>
                {row.ci.name}
              </button>{' '}
              {direction === 'neededBy' ? <span className="app-CiEdge__verb">{edgeLabel(row.type, direction)}</span> : null}{' '}
              {row.ci.status !== 'operational' ? <StatusPill size="sm" label={status.label} tone={status.tone} {...(status.icon ? { icon: status.icon } : {})} /> : null}
              {writable ? <IconButton icon="x" size="sm" variant="ghost" label={`Remove: ${sentence.replace(/[:;].*$/, '').replace(/\.$/, '')}`} onClick={() => onRemove(edge)} /> : null}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="app-CiPanel">
      <div className="app-CiPanel__bar">
        <p className="app-CiSection__note">Impact follows these: if something it needs fails, it is affected too.</p>
        {writable ? (
          <Button variant="secondary" size="sm" iconStart="link" onClick={onRelate}>
            Relate…
          </Button>
        ) : null}
      </div>
      {state.status === 'loading' ? (
        <Loading label="Loading relationships…" />
      ) : state.status === 'failed' ? (
        <Failed state={state} retry={retry} />
      ) : (
        <>
          <section className="app-CiSection" aria-labelledby={`ci-${ci.id}-needs`}>
            <h3 id={`ci-${ci.id}-needs`} className="app-CiSection__title">
              What it needs
            </h3>
            {list('needs', state.value.needs, 'Nothing recorded. If it runs on or depends on something, relate it so impact can follow.')}
          </section>
          <section className="app-CiSection" aria-labelledby={`ci-${ci.id}-needed`}>
            <h3 id={`ci-${ci.id}-needed`} className="app-CiSection__title">
              What needs it
            </h3>
            {list('neededBy', state.value.neededBy, 'Nothing recorded needs it.')}
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Impact */

export function ImpactTab({
  ci,
  cache,
  version,
  serviceNames,
  onOpenCi,
}: {
  readonly ci: CiView;
  readonly cache: LoadCache;
  readonly version: number;
  readonly serviceNames: ReadonlyMap<string, string>;
  onOpenCi(id: string): void;
}): ReactNode {
  const { state, retry } = useLoad<ImpactResult>(cache, `${ci.id}:impact:${version}`, () => api.observe.estate.impact(ci.id));
  if (state.status === 'loading') return <Loading label="Working out what depends on it…" />;
  if (state.status === 'failed') return <Failed state={state} retry={retry} />;
  const { summary, data, depth } = state.value;
  if (summary.total === 0) {
    return (
      <EmptyState
        size="sm"
        headingLevel={3}
        icon="circle-check"
        title="Nothing recorded depends on it"
        description={`If ${ci.name} fails, no other item in the CMDB is affected — as far as its relationships say.`}
      />
    );
  }
  const names = summary.services.map((id) => serviceNames.get(id)).filter((name): name is string => !!name);
  return (
    <div className="app-CiPanel">
      <p className="app-CiImpact__summary">
        <strong>If {ci.name} fails:</strong> {impactSentence(summary, names)}
      </p>
      {summary.truncated ? (
        <p className="app-CiSection__note">
          Stopped {depth} {depth === 1 ? 'step' : 'steps'} out. There may be more beyond.
        </p>
      ) : null}
      {impactGroups(data).map((group) => (
        <section key={group.depth} className="app-CiSection" aria-labelledby={`ci-${ci.id}-impact-${group.depth}`}>
          <h3 id={`ci-${ci.id}-impact-${group.depth}`} className="app-CiSection__title">
            {group.label} <span className="app-CiSection__count">{group.items.length}</span>
          </h3>
          <ul className="app-CiEdges">
            {group.items.map((node) => {
              const criticality = lookOf(CRITICALITY_LOOK, node.criticality);
              const status = lookOf(CI_STATUS_LOOK, node.status);
              return (
                <li key={node.id} className="app-CiEdge">
                  <button type="button" className="app-CiEdge__name" onClick={() => onOpenCi(node.id)}>
                    {node.name}
                  </button>{' '}
                  <span className="app-CiEdge__verb">
                    {node.className} · {verbOf(node.via)} {group.depth === 1 ? ci.name : 'one of the items above'}
                  </span>
                  {criticality.tone !== 'neutral' ? <StatusPill size="sm" srPrefix="Criticality" label={criticality.label} tone={criticality.tone} /> : null}
                  {node.status !== 'operational' ? <StatusPill size="sm" label={status.label} tone={status.tone} {...(status.icon ? { icon: status.icon } : {})} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- Linked */

interface Linked {
  readonly history: CiHistory;
  /** Ticket numbers and titles by ticket id, for the ones this person could open. */
  readonly tickets: ReadonlyMap<string, { readonly number: string; readonly title: string }>;
}

/** Tickets named on the tab are looked up by id, at most this many (the rest show without a title). */
const TICKET_LOOKUPS = 25;

export function LinkedTab({
  ci,
  cache,
  canReadTickets,
  ticketHref,
}: {
  readonly ci: CiView;
  readonly cache: LoadCache;
  readonly canReadTickets: boolean;
  /** Where a ticket opens, by number; null when this person cannot open the Tickets page. */
  ticketHref(number: string): string | null;
}): ReactNode {
  const { state, retry } = useLoad<Linked>(cache, `${ci.id}:linked`, async () => {
    const history = await api.observe.estate.history(ci.id);
    const ids = canReadTickets ? [...new Set(history.data.filter((row) => row.entityType === 'ticket').map((row) => row.entityId))].slice(0, TICKET_LOOKUPS) : [];
    const found = await Promise.allSettled(ids.map((id) => api.observe.ticket(id)));
    const tickets = new Map<string, { number: string; title: string }>();
    found.forEach((result, index) => {
      if (result.status === 'fulfilled') tickets.set(ids[index]!, { number: result.value.number, title: result.value.title });
    });
    return { history, tickets };
  });
  const { Link } = useItsm();
  if (state.status === 'loading') return <Loading label="Loading linked tickets…" />;
  if (state.status === 'failed') return <Failed state={state} retry={retry} />;
  const rows = state.value.history.data;
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        headingLevel={3}
        icon="ticket"
        title="Nothing has named it yet"
        description="Tickets, major incidents, problems and changes that name this item appear here — the first place to look when it fails again."
      />
    );
  }
  const kinds = Object.keys(ENTITY_LOOK).filter((kind) => rows.some((row) => row.entityType === kind));
  return (
    <div className="app-CiPanel">
      {kinds.map((kind) => {
        const look = ENTITY_LOOK[kind]!;
        const entries = rows.filter((row) => row.entityType === kind);
        return (
          <section key={kind} className="app-CiSection" aria-labelledby={`ci-${ci.id}-linked-${kind}`}>
            <h3 id={`ci-${ci.id}-linked-${kind}`} className="app-CiSection__title">
              {look.other} <span className="app-CiSection__count">{entries.length}</span>
            </h3>
            <ul className="app-CiLinked">
              {entries.map((row) => {
                const ticket = kind === 'ticket' ? state.value.tickets.get(row.entityId) : undefined;
                const href = ticket ? ticketHref(ticket.number) : null;
                return (
                  <li key={`${row.entityType}:${row.entityId}:${row.role}`} className="app-CiLinked__row">
                    <Icon name={look.icon} size="sm" className="app-CiLinked__icon" />
                    <span className="app-CiLinked__what">
                      {ticket ? (
                        href ? (
                          <Link href={href} className="app-CiLinked__link">
                            <span className="app-CmdbMono">{ticket.number}</span> {ticket.title}
                          </Link>
                        ) : (
                          <>
                            <span className="app-CmdbMono">{ticket.number}</span> {ticket.title}
                          </>
                        )
                      ) : (
                        <span className="app-CiLinked__unknown">
                          {kind === 'ticket' ? 'A ticket you can’t open' : `A ${look.one.toLowerCase()}`} <span className="app-CmdbMono">#{shortId(row.entityId)}</span>
                        </span>
                      )}
                    </span>
                    <span className="app-CiLinked__meta">
                      {LINK_ROLE_LABEL[row.role] ?? humanise(row.role)} · <RelativeTime date={row.linkedAt} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ History */

export function HistoryTab({
  ci,
  cache,
  version,
  auditHref,
}: {
  readonly ci: CiView;
  readonly cache: LoadCache;
  readonly version: number;
  /** The Audit log filtered to this item, when this person can open it. */
  readonly auditHref: string | null;
}): ReactNode {
  const { locale, Link } = useItsm();
  const { state, retry } = useLoad<TimelineEvent[]>(cache, `${ci.id}:audit:${version}`, async () => {
    const page = await api.observe.auditEvents({ targetType: 'configuration_item', targetId: ci.id, limit: 50 });
    const ids = [...new Set(page.data.map((event) => event.actorId).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      try {
        for (const person of await api.tenant.users({ ids, limit: Math.min(200, ids.length) })) names.set(person.id, person.displayName || person.email);
      } catch {
        // Names are a courtesy: an entry still says what happened, by "Someone".
      }
    }
    return page.data.map((event) => {
      const entry = historyEntry(event, locale);
      // A person when the event names one; otherwise the platform acted (a job, discovery, an import).
      const actor = event.actorId ? { name: names.get(event.actorId) ?? 'Someone', kind: 'person' as const } : { name: 'The platform', kind: 'system' as const };
      return {
        id: event.id,
        title: entry.title,
        timestamp: event.occurredAt,
        actor,
        kind: 'event',
        ...(entry.body ? { body: entry.body } : {}),
        ...(entry.tone ? { tone: entry.tone } : {}),
      } satisfies TimelineEvent;
    });
  });
  if (state.status === 'loading') return <Loading label="Loading its history…" />;
  if (state.status === 'failed') return <Failed state={state} retry={retry} />;
  return (
    <div className="app-CiPanel">
      <Timeline label={`History of ${ci.name}`} events={state.value} emptyMessage="Nothing recorded about it yet." />
      {auditHref ? (
        <p className="app-CiSection__note">
          <Link href={auditHref} className="app-CiLinked__link">
            See it in the Audit log
          </Link>
        </p>
      ) : null}
    </div>
  );
}
