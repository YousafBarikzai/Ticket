'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CiClassRow, CiRelationships, CiRow } from '@itsm/sdk';
import { Button, EmptyState, ProblemState, SkeletonText, StatusPill, Tabs, type Problem } from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import type { PersonRef } from '../PersonCell.js';
import { CiForm } from './CiForm.js';
import { RelateDialog, StatusDialog, type RelateInput } from './CiDialogs.js';
import { HistoryTab, ImpactTab, LinkedTab, OverviewTab, RelationshipsTab, type Edge } from './CiTabs.js';
import { CI_STATUS_LOOK, ciView, lookOf, relationSentence, type CiView, type SettableStatus } from './presentation.js';
import type { LoadCache } from './useLoad.js';

/**
 * One configuration item, in a drawer (`?open=ci:<id>`, SPEC §6.1 and §4.10):
 * its status and class at the top, then Overview · Relationships · Impact ·
 * Linked · History, and — for people who manage the CMDB — Edit (in place),
 * Change status… and Retire… at the foot.
 *
 * The row it was opened from is the placeholder; an item that is not in the
 * list (retired, filtered out, or reached from a relationship or an asset) is
 * read through the SDK. After a change the page's list refreshes; the drawer
 * shows the API's answer at once rather than waiting for it.
 */

export interface CiDrawerProps {
  readonly id: string | null;
  /** The item as the list has it. */
  readonly row?: CiView;
  /** The item the server read for a hard load of the link. */
  readonly initial?: CiView;
  /** The server could not find the linked item. */
  readonly missing?: boolean;
  readonly classes: readonly CiClassRow[];
  readonly services: readonly { readonly id: string; readonly name: string }[] | null;
  readonly canManage: boolean;
  readonly canAudit: boolean;
  readonly canReadTickets: boolean;
  ticketHref(number: string): string | null;
  auditHref(id: string): string | null;
  onClose(): void;
  onOpenCi(id: string): void;
}

type Mode = 'view' | 'edit';

export function CiDrawer(props: CiDrawerProps): ReactNode {
  const { id, row, initial, missing, classes, services, canManage, onClose } = props;
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly view: CiView } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>('view');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  // Names this drawer has learnt, so a changed owner reads as a name straight away.
  const people = useRef(new Map<string, PersonRef>());
  const serviceNames = useMemo(() => new Map((services ?? []).map((service) => [service.id, service.name])), [services]);

  const fromServer = row ?? (initial && initial.id === id ? initial : undefined);
  if (fromServer?.owner) people.current.set(fromServer.owner.id, fromServer.owner);

  const toView = (saved: CiRow): CiView =>
    ciView(saved, {
      classes,
      serviceName: (serviceId) => serviceNames.get(serviceId) ?? null,
      person: (personId) => (personId ? (people.current.get(personId) ?? { id: personId, name: null }) : null),
    });

  // Another item: back to reading it, and forget the last one's failure.
  useEffect(() => {
    setMode('view');
    setDirty(false);
    setProblem(null);
  }, [id]);

  // The item, when the list did not bring it.
  useEffect(() => {
    if (!id || fromServer || missing) return;
    let live = true;
    setProblem(null);
    void (async () => {
      try {
        const found = await api.observe.estate.ci(id);
        if (found.ownerId && !people.current.has(found.ownerId)) {
          try {
            const [person] = await api.tenant.users({ ids: [found.ownerId], limit: 1 });
            if (person) people.current.set(person.id, { id: person.id, name: person.displayName || person.email });
          } catch {
            // The owner reads "Unknown person" with a short id; the item still shows.
          }
        }
        if (live) setLoaded({ id, view: toView(found) });
      } catch (error) {
        if (live) setProblem(problemFrom(error));
      }
    })();
    return () => {
      live = false;
    };
    // Loaded again when the item or Retry changes; the row, when there is one, is used instead.
  }, [id, attempt, Boolean(fromServer)]);

  // What a change just answered, shown until the list catches up. An item
  // that leaves the list (retired) keeps showing the answer.
  const [latest, setLatest] = useState<CiView | null>(null);
  useEffect(() => setLatest(null), [id]);
  useEffect(() => {
    if (row) setLatest(null);
  }, [row]);

  const ci = latest?.id === id ? latest : (fromServer ?? (loaded?.id === id ? loaded.view : undefined));

  const close = (): void => {
    setMode('view');
    setDirty(false);
    onClose();
  };

  const status = ci ? lookOf(CI_STATUS_LOOK, ci.status) : null;
  const editing = mode === 'edit' && ci !== undefined;

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={ci?.name ?? (missing || problem?.status === 404 ? 'Configuration item' : 'Loading…')}
      {...(ci ? { description: [ci.className, ci.environment].filter(Boolean).join(' · ') || undefined } : {})}
      {...(status && ci ? { headerMeta: <StatusPill size="sm" label={status.label} tone={status.tone} {...(status.icon ? { icon: status.icon } : {})} /> } : {})}
      dirty={editing && dirty}
      {...(editing
        ? {
            footer: (
              <div className="app-CmdbActions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMode('view');
                    setDirty(false);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="primary" type="submit" form={formId} loading={busy}>
                  Save changes
                </Button>
              </div>
            ),
          }
        : ci && canManage && ci.retiredAt === null
          ? { footer: <Actions ci={ci} onEdit={() => setMode('edit')} onChanged={setLatest} toView={toView} /> }
          : {})}
    >
      {id === null ? null : missing || problem?.status === 404 || problem?.status === 422 ? (
        <EmptyState
          size="sm"
          headingLevel={3}
          icon="cmdb"
          title="That item no longer exists"
          description="It may have been removed since the link was shared. Retired items stay in the record; this one isn’t there."
        />
      ) : problem && !ci ? (
        <ProblemState problem={problem} size="sm" onRetry={() => setAttempt((value) => value + 1)} />
      ) : !ci ? (
        <div className="app-CiPanel">
          <SkeletonText lines={6} />
          <span className="itsm-visually-hidden" role="status">
            Loading the item…
          </span>
        </div>
      ) : editing ? (
        <CiForm
          key={ci.id}
          formId={formId}
          ci={ci}
          classes={classes}
          services={services}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={(saved, owner) => {
            if (owner) people.current.set(owner.id, { id: owner.id, name: owner.name });
            if (saved) setLatest(toView(saved));
            setMode('view');
          }}
        />
      ) : (
        <Body ci={ci} {...props} serviceNames={serviceNames} />
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ The tabs */

function Body({
  ci,
  classes,
  canManage,
  canAudit,
  canReadTickets,
  ticketHref,
  auditHref,
  onOpenCi,
  serviceNames,
}: CiDrawerProps & { readonly ci: CiView; readonly serviceNames: ReadonlyMap<string, string> }): ReactNode {
  const [tab, setTab] = useState('overview');
  const [version, setVersion] = useState(0);
  const [relating, setRelating] = useState(false);
  const cache = useRef<LoadCache>(new Map()).current;

  // A different item starts on its overview.
  useEffect(() => setTab('overview'), [ci.id]);

  const relate = useMutation(
    async (input: RelateInput) => {
      const relationship = { fromCi: input.fromCi, toCi: input.toCi, type: input.type };
      const recorded = await api.observe.estate.relate(relationship);
      return { reads: recorded.reads, relationship };
    },
    {
      // The API's own sentence: the direction it actually recorded is the thing to check.
      success: ({ reads }) => `Recorded: ${reads.replace(/[:;].*$/, '')}`,
      undo: async ({ relationship }) => {
        await api.observe.estate.unrelate(relationship);
        setVersion((value) => value + 1);
      },
      failure: 'Couldn’t record the relationship',
      onSuccess: () => setVersion((value) => value + 1),
    },
  );

  const unrelate = useMutation(
    async (edge: Edge) => {
      const relationship = edge.direction === 'needs' ? { fromCi: ci.id, toCi: edge.other.id, type: edge.type as RelateInput['type'] } : { fromCi: edge.other.id, toCi: ci.id, type: edge.type as RelateInput['type'] };
      await api.observe.estate.unrelate(relationship);
      return { edge, relationship };
    },
    {
      success: ({ edge }) => `Removed: ${(edge.direction === 'needs' ? relationSentence(edge.type, ci.name, edge.other.name) : relationSentence(edge.type, edge.other.name, ci.name)).replace(/[:;].*$/, '').replace(/\.$/, '')}`,
      undo: async ({ relationship }) => {
        await api.observe.estate.relate(relationship);
        setVersion((value) => value + 1);
      },
      failure: 'Couldn’t remove the relationship',
      onSuccess: () => setVersion((value) => value + 1),
    },
  );

  const items = [
    { id: 'overview', label: 'Overview', content: <OverviewTab ci={ci} classes={classes} cache={cache} /> },
    {
      id: 'relationships',
      label: 'Relationships',
      content: (
        <RelationshipsTab
          ci={ci}
          cache={cache}
          version={version}
          canManage={canManage}
          onOpenCi={onOpenCi}
          onRelate={() => setRelating(true)}
          onRemove={(edge) => void unrelate.run(edge)}
        />
      ),
    },
    { id: 'impact', label: 'Impact', content: <ImpactTab ci={ci} cache={cache} version={version} serviceNames={serviceNames} onOpenCi={onOpenCi} /> },
    { id: 'linked', label: 'Linked', content: <LinkedTab ci={ci} cache={cache} canReadTickets={canReadTickets} ticketHref={ticketHref} /> },
    ...(canAudit ? [{ id: 'history', label: 'History', content: <HistoryTab ci={ci} cache={cache} version={version} auditHref={auditHref(ci.id)} /> }] : []),
  ];

  return (
    <div className="app-CiDrawer">
      <Tabs label={`${ci.name}: sections`} items={items} value={tab} onChange={setTab} activation="manual" />
      <RelateDialog
        ci={ci}
        classes={classes}
        open={relating}
        onClose={() => setRelating(false)}
        onSubmit={async (input) => (await relate.run(input)).ok}
      />
    </div>
  );
}

/* --------------------------------------------------------------- The actions */

function Actions({
  ci,
  onEdit,
  onChanged,
  toView,
}: {
  readonly ci: CiView;
  onEdit(): void;
  onChanged(view: CiView): void;
  toView(saved: CiRow): CiView;
}): ReactNode {
  const [changing, setChanging] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [dependants, setDependants] = useState<CiRelationships['neededBy'] | null>(null);
  const online = useOnline();
  const offline = online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' };

  const setStatus = useMutation(
    async (input: { readonly status: SettableStatus; readonly note: string; readonly previous: SettableStatus }) => ({
      saved: await api.observe.estate.setCiStatus(ci.id, input.status, input.note || undefined),
      previous: input.previous,
    }),
    {
      success: ({ saved }) => `${saved.name} is now ${lookOf(CI_STATUS_LOOK, saved.status).label.toLowerCase()}`,
      // A status change back is a safe inverse; the note stays in the history.
      undo: async ({ previous }) => {
        onChanged(toView(await api.observe.estate.setCiStatus(ci.id, previous)));
      },
      failure: 'Couldn’t change the status',
      onSuccess: ({ saved }) => onChanged(toView(saved)),
    },
  );
  const retire = useMutation(async (reason: string) => api.observe.estate.retireCi(ci.id, reason), {
    success: (saved) => `${saved.name} retired`,
    failure: 'Couldn’t retire the item',
    onSuccess: (saved) => onChanged(toView(saved)),
  });

  const askToRetire = async (): Promise<void> => {
    // What still depends on it, said before rather than discovered after.
    try {
      const found = await api.observe.estate.relationships(ci.id);
      setDependants(found.neededBy);
    } catch {
      setDependants(null);
    }
    setRetiring(true);
  };

  return (
    <div className="app-CmdbDrawerActions">
      <Button variant="dangerTinted" iconStart="archive" onClick={() => void askToRetire()} {...offline}>
        Retire…
      </Button>
      <div className="app-CmdbActions">
        <Button variant="secondary" onClick={() => setChanging(true)} {...offline}>
          Change status…
        </Button>
        <Button variant="primary" iconStart="pencil" onClick={onEdit} {...offline}>
          Edit
        </Button>
      </div>
      <StatusDialog
        ci={ci}
        open={changing}
        onClose={() => setChanging(false)}
        onSubmit={async (status, note) => (await setStatus.run({ status, note, previous: ci.status as SettableStatus })).ok}
      />
      <ConfirmDialog
        open={retiring}
        onOpenChange={setRetiring}
        spec={{
          title: `Retire ${ci.name}?`,
          body: 'It keeps its record and history, but leaves the lists, stops carrying impact and can’t be changed again. This can’t be undone.',
          confirmLabel: 'Retire item',
          tone: 'danger',
          requireReason: { label: 'Why is it being retired?', hint: 'Kept in its history.', minLength: 3 },
          ...(dependants && dependants.length > 0
            ? {
                consequences: dependants.slice(0, 5).map((entry) => ({ label: `${entry.ci.name} still depends on it` })),
              }
            : {}),
        }}
        onConfirm={async (reason) => {
          const result = await retire.run(reason ?? '');
          if (!result.ok) throw new Error(result.problem.detail ?? 'Couldn’t retire the item.');
        }}
      />
    </div>
  );
}
