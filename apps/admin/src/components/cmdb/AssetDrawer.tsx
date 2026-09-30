'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AssetRow } from '@itsm/sdk';
import { Button, DescriptionList, EmptyState, ProblemState, SkeletonText, StatusPill, useItsm, type Problem } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { PersonCell, type PersonRef } from '../PersonCell.js';
import { AssignDialog, RetireAssetDialog, ReturnDialog, type AssignChoice } from './AssetDialogs.js';
import { AssetForm } from './AssetForm.js';
import { assetDetailView, type AssetDetailView } from './assets.js';
import { ASSET_STATUS_LOOK, CI_STATUS_LOOK, assetIsActive, formatDay, lookOf, warrantyChip, type AssetView } from './presentation.js';

/**
 * One asset, in a drawer (`?open=asset:<tag>`, SPEC §6.1): what it is, who
 * holds it and where, the configuration item it is (a link that opens that
 * item's drawer on Configuration items), supplier, purchase and warranty,
 * and every holding it has had. People who manage assets get Assign to…,
 * Return, Edit (in place) and Retire….
 *
 * The row is the placeholder while the SDK reads the asset and its holdings;
 * a hard load arrives with them already.
 */

export interface AssetDrawerProps {
  readonly tag: string | null;
  readonly row?: AssetView;
  readonly initial?: AssetDetailView;
  readonly missing?: boolean;
  readonly today: string;
  readonly canManage: boolean;
  /** Whether this person may read configuration items (to name and open the linked one). */
  readonly canReadCis: boolean;
  readonly takenTags: readonly string[];
  onClose(): void;
}

export function AssetDrawer({ tag, row, initial, missing, today, canManage, canReadCis, takenTags, onClose }: AssetDrawerProps): ReactNode {
  const { locale, timeZone, Link } = useItsm();
  const [detail, setDetail] = useState<AssetDetailView | null>(initial && initial.asset.tag === tag ? initial : null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'assign' | 'return' | 'retire' | null>(null);
  const formId = useId();
  const online = useOnline();

  useEffect(() => {
    setEditing(false);
    setDirty(false);
    setProblem(null);
    if (!tag) return;
    if (initial && initial.asset.tag === tag && version === 0) {
      setDetail(initial);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const found = await api.observe.estate.asset(tag);
        const ids = [...new Set(found.assignments.map((holding) => holding.userId).filter((id): id is string => !!id))];
        const names = new Map<string, PersonRef>();
        if (ids.length > 0) {
          try {
            for (const person of await api.tenant.users({ ids, limit: Math.min(200, ids.length) })) names.set(person.id, { id: person.id, name: person.displayName || person.email });
          } catch {
            // Names are a courtesy: a holding still reads "Unknown person" with a short id.
          }
        }
        let ci: AssetDetailView['ci'] = null;
        if (found.ciId) {
          ci = 'hidden';
          if (canReadCis) {
            try {
              const item = await api.observe.estate.ci(found.ciId);
              ci = { id: item.id, name: item.name, status: item.status };
            } catch {
              // Left as "an item you can't open".
            }
          }
        }
        if (live) setDetail(assetDetailView(found, { person: (id) => (id ? (names.get(id) ?? { id, name: null }) : null), today, locale, ci }));
      } catch (error) {
        if (live) setProblem(problemFrom(error));
      }
    })();
    return () => {
      live = false;
    };
    // Read again for another asset, and after a change here.
  }, [tag, version]);

  const refreshed = (): void => setVersion((value) => value + 1);

  const assign = useMutation(async (choice: AssignChoice) => api.observe.estate.assignAsset(tag!, { ...(choice.person ? { userId: choice.person.id } : {}), ...(choice.location ? { location: choice.location } : {}), ...(choice.note ? { note: choice.note } : {}) }), {
    success: (saved) => (saved.status === 'assigned' ? `${saved.tag} assigned` : `${saved.tag} moved`),
    failure: 'Couldn’t assign the asset',
    onSuccess: refreshed,
  });
  const giveBack = useMutation(async (location: string) => api.observe.estate.returnAsset(tag!, location || undefined), {
    success: (saved) => `${saved.tag} returned to stock`,
    failure: 'Couldn’t return the asset',
    onSuccess: refreshed,
  });
  const retire = useMutation(async (input: { readonly reason: string; readonly disposed: boolean }) => api.observe.estate.retireAsset(tag!, input.reason, input.disposed), {
    success: (saved) => `${saved.tag} retired`,
    failure: 'Couldn’t retire the asset',
    onSuccess: refreshed,
  });

  const asset = detail?.asset ?? row;
  const status = asset ? lookOf(ASSET_STATUS_LOOK, asset.status) : null;
  const active = asset ? assetIsActive(asset.status, asset.retiredAt) : false;
  const gone = missing || problem?.status === 404;
  const offline = online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' };

  const close = (): void => {
    setEditing(false);
    setDirty(false);
    onClose();
  };

  let footer: ReactNode = null;
  if (asset && editing) {
    footer = (
      <div className="app-CmdbActions">
        <Button
          variant="secondary"
          onClick={() => {
            setEditing(false);
            setDirty(false);
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={formId} loading={busy}>
          Save changes
        </Button>
      </div>
    );
  } else if (asset && canManage && active && detail) {
    footer = (
      <div className="app-CmdbDrawerActions">
        <Button variant="dangerTinted" iconStart="archive" onClick={() => setDialog('retire')} {...offline}>
          Retire…
        </Button>
        <div className="app-CmdbActions">
          {asset.status === 'assigned' ? (
            <Button variant="secondary" onClick={() => setDialog('return')} {...offline}>
              Return
            </Button>
          ) : null}
          <Button variant="secondary" iconStart="pencil" onClick={() => setEditing(true)} {...offline}>
            Edit
          </Button>
          <Button variant="primary" iconStart="user" onClick={() => setDialog('assign')} {...offline}>
            Assign to…
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Sheet
      open={tag !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
      title={asset?.tag ?? tag ?? 'Asset'}
      {...(asset?.serial ? { description: `Serial ${asset.serial}` } : {})}
      {...(status && asset ? { headerMeta: <StatusPill size="sm" label={status.label} tone={status.tone} {...(status.icon ? { icon: status.icon } : {})} /> } : {})}
      dirty={editing && dirty}
      {...(footer ? { footer } : {})}
    >
      {tag === null ? null : gone ? (
        <EmptyState size="sm" headingLevel={3} icon="assets" title="That asset no longer exists" description="It may have been removed since the link was shared. Retired assets stay in the register; this one isn’t there." />
      ) : problem && !asset ? (
        <ProblemState problem={problem} size="sm" onRetry={refreshed} />
      ) : !asset ? (
        <div className="app-CiPanel">
          <SkeletonText lines={6} />
          <span className="itsm-visually-hidden" role="status">
            Loading the asset…
          </span>
        </div>
      ) : editing ? (
        <AssetForm
          key={asset.tag}
          formId={formId}
          asset={asset}
          ciName={detail?.ci && detail.ci !== 'hidden' ? detail.ci.name : null}
          takenTags={takenTags}
          canLinkCi={canReadCis}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={(saved: AssetRow | null) => {
            setEditing(false);
            if (saved) refreshed();
          }}
        />
      ) : (
        <div className="app-CiPanel">
          <DescriptionList
            layout="inline"
            dense
            items={[
              {
                id: 'holder',
                label: 'Held by',
                // Undefined only while an older API's row stands in for the detail.
                value: asset.holder === undefined ? null : <PersonCell person={asset.holder} empty="Nobody" />,
              },
              { id: 'location', label: 'Location', value: asset.location },
              {
                id: 'ci',
                label: 'Configuration item',
                value: !detail ? null : detail.ci === null ? 'None linked' : detail.ci === 'hidden' ? 'An item you can’t open' : (
                  <Link href={`/cmdb?open=${encodeURIComponent(`ci:${detail.ci.id}`)}`} className="app-CiLinked__link">
                    {detail.ci.name}
                    {detail.ci.status !== 'operational' ? ` · ${lookOf(CI_STATUS_LOOK, detail.ci.status).label}` : ''}
                  </Link>
                ),
              },
              { id: 'cost-centre', label: 'Cost centre', value: asset.costCentre },
              { id: 'supplier', label: 'Supplier', value: asset.supplier },
              { id: 'purchased', label: 'Purchased', value: asset.purchasedOn ? formatDay(asset.purchasedOn, locale) : null },
              { id: 'warranty', label: 'Warranty ends', value: asset.warrantyEndsOn ? <WarrantyValue asset={asset} /> : null },
              ...(asset.retiredAt ? [{ id: 'retired', label: asset.status === 'disposed' ? 'Disposed of' : 'Retired', value: formatDateTime(asset.retiredAt, { locale, timeZone, style: 'date' }) }] : []),
            ]}
          />
          <section className="app-CiSection" aria-labelledby={`asset-${asset.id}-holdings`}>
            <h3 id={`asset-${asset.id}-holdings`} className="app-CiSection__title">
              Holdings
            </h3>
            {!detail ? (
              <SkeletonText lines={2} />
            ) : detail.holdings.length === 0 ? (
              <p className="app-CiSection__note">Never assigned: it has been in stock since it was added.</p>
            ) : (
              <ol className="app-CmdbHoldings">
                {detail.holdings.map((holding) => (
                  <li key={`${holding.assignedAt}-${holding.who?.id ?? holding.location ?? ''}`} className="app-CmdbHolding" data-current={holding.returnedAt === null ? '' : undefined}>
                    <div className="app-CmdbHolding__who">
                      {holding.who ? <PersonCell person={holding.who} /> : <span>{holding.location ?? 'Somewhere unrecorded'}</span>}
                      {holding.returnedAt === null ? <StatusPill size="sm" label="Now" tone="info" icon="dot" /> : null}
                    </div>
                    <p className="app-CmdbHolding__when">
                      {formatDateTime(holding.assignedAt, { locale, timeZone, style: 'date' })}
                      {holding.returnedAt ? ` – ${formatDateTime(holding.returnedAt, { locale, timeZone, style: 'date' })}` : ' – now'}
                      {holding.who && holding.location ? ` · ${holding.location}` : ''}
                    </p>
                    {holding.note ? <p className="app-CmdbHolding__note">{holding.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {detail && !active ? <p className="app-CiSection__note">Retired assets can’t be assigned or changed.</p> : null}
        </div>
      )}
      {asset ? (
        <>
          <AssignDialog asset={asset} open={dialog === 'assign'} onClose={() => setDialog(null)} onSubmit={async (choice) => (await assign.run(choice)).ok} />
          <ReturnDialog asset={asset} open={dialog === 'return'} onClose={() => setDialog(null)} onSubmit={async (location) => (await giveBack.run(location)).ok} />
          <RetireAssetDialog asset={asset} open={dialog === 'retire'} onClose={() => setDialog(null)} onSubmit={async (reason, disposed) => (await retire.run({ reason, disposed })).ok} />
        </>
      ) : null}
    </Sheet>
  );
}

/** The end date and, when it is close or past, the chip that says so in words. */
export function WarrantyValue({ asset }: { readonly asset: Pick<AssetView, 'warrantyText' | 'warranty' | 'warrantyEndsOn'> }): ReactNode {
  const chip = warrantyChip(asset.warranty);
  return (
    <span className="app-CmdbWarranty">
      <span>{asset.warrantyText ?? asset.warrantyEndsOn}</span>
      {chip ? <StatusPill size="sm" label={chip.label} tone={chip.tone} {...(chip.icon ? { icon: chip.icon } : {})} /> : null}
    </span>
  );
}
