'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, DescriptionList, EmptyState, Input, Meter, ProblemState, Select, SkeletonList, StatusPill, describeProblem, notify, type ConfirmSpec, type Problem } from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { useOnline } from '../../client/live.js';
import { GB, type MeterView } from '../settings/usage.js';
import { parseRegions, regionsText, statusLook, type TenantView } from './presentation.js';

/**
 * One tenant (`?open=tenant:<id>`, SPEC §6.1 `/tenants`): who it is, its
 * meters against its plan, where its prompts may be processed, and the
 * operator's actions — change its plan, set its AI regions, suspend it (type
 * the slug, give a reason) or resume it.
 *
 * Every action is a Server Action that checks, on the server and at the time
 * of the call, that the caller is still a platform operator.
 */

export type PlatformActionResult = { readonly ok: true } | { readonly ok: false; readonly problem: Problem };

export interface PlatformActions {
  suspend(tenantId: string, reason: string): Promise<PlatformActionResult>;
  resume(tenantId: string): Promise<PlatformActionResult>;
  changePlan(tenantId: string, planKey: string): Promise<PlatformActionResult>;
  setAiRegions(tenantId: string, regions: readonly string[]): Promise<PlatformActionResult>;
}

/** What the server rendered for the open tenant: its meters, or why they could not be read. */
export interface TenantDetail {
  readonly id: string;
  readonly meters: readonly MeterView[] | null;
  readonly problem?: Problem;
}

const OFFLINE = 'You’re offline — changes can’t be saved.';

type Pending =
  | { readonly kind: 'suspend' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'plan'; readonly planKey: string; readonly planName: string }
  | { readonly kind: 'regions'; readonly regions: readonly string[] };

export function TenantDrawer({
  openId,
  row,
  detail,
  plans,
  actions,
  onClose,
}: {
  readonly openId: string | null;
  readonly row: TenantView | null;
  readonly detail: TenantDetail | null;
  readonly plans: readonly { readonly key: string; readonly name: string; readonly retired: boolean }[];
  readonly actions: PlatformActions;
  onClose(): void;
}): ReactNode {
  const look = row ? statusLook(row.status) : null;
  return (
    <Sheet
      open={openId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      title={row?.name ?? 'Tenant'}
      {...(row ? { description: row.slug } : {})}
      {...(look ? { headerMeta: <StatusPill size="sm" tone={look.tone} icon={look.icon} label={look.label} srPrefix="Status" /> } : {})}
    >
      {openId === null ? null : row ? (
        <Body key={`${row.id}:${row.status}:${row.planKey ?? ''}:${(row.aiRegions ?? []).join(',')}`} row={row} detail={detail} plans={plans} actions={actions} />
      ) : (
        <EmptyState size="sm" title="That tenant no longer exists" description="It may have been removed." action={{ id: 'close', label: 'Close', variant: 'secondary' }} onAction={onClose} />
      )}
    </Sheet>
  );
}

function Body({
  row,
  detail,
  plans,
  actions,
}: {
  readonly row: TenantView;
  readonly detail: TenantDetail | null;
  readonly plans: readonly { readonly key: string; readonly name: string; readonly retired: boolean }[];
  readonly actions: PlatformActions;
}): ReactNode {
  const online = useOnline();
  const regionsId = useId();
  const regionsErrorId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [planKey, setPlanKey] = useState(row.planKey ?? '');
  const [regionsDraft, setRegionsDraft] = useState((row.aiRegions ?? []).join(', '));
  const [regionsProblem, setRegionsProblem] = useState<string | null>(null);
  // Retired plans are offered only to a tenant already on one (the API refuses anyone new).
  const choices = plans.filter((plan) => !plan.retired || plan.key === row.planKey);
  const offline = online ? {} : { disabledReason: OFFLINE };

  const confirm = async (reason?: string): Promise<void> => {
    if (!pending) return;
    const result =
      pending.kind === 'suspend'
        ? await actions.suspend(row.id, reason ?? '')
        : pending.kind === 'resume'
          ? await actions.resume(row.id)
          : pending.kind === 'plan'
            ? await actions.changePlan(row.id, pending.planKey)
            : await actions.setAiRegions(row.id, pending.regions);
    if (!result.ok) {
      // The dialog stays open with the reason (ConfirmDialog shows a rejection inline).
      const words = describeProblem(result.problem);
      throw new Error(result.problem.detail ?? words.body ?? words.title);
    }
    const done =
      pending.kind === 'suspend'
        ? [`${row.name} suspended`, 'Every call for this workspace is refused until it is resumed.']
        : pending.kind === 'resume'
          ? [`${row.name} resumed`, 'Its people can sign in and work again.']
          : pending.kind === 'plan'
            ? [`${row.name} moved to ${pending.planName}`, 'Its limits changed straight away.']
            : [`AI regions saved for ${row.name}`, undefined];
    notify(done[0]!, { tone: 'success', ...(done[1] ? { description: done[1] } : {}) });
    setPending(null);
  };

  const spec: ConfirmSpec | null = !pending
    ? null
    : pending.kind === 'suspend'
      ? {
          title: `Suspend ${row.name}?`,
          body: 'Everyone in this workspace is refused at once — the apps show that it is suspended, and email and integrations stop. Nothing is deleted, and you can resume it at any time.',
          confirmLabel: 'Suspend tenant',
          tone: 'danger',
          typeToConfirm: row.slug,
          requireReason: { label: 'Reason', hint: 'Kept on the tenant’s audit trail.' },
        }
      : pending.kind === 'resume'
        ? { title: `Resume ${row.name}?`, body: 'Its people can sign in and work again straight away.', confirmLabel: 'Resume tenant' }
        : pending.kind === 'plan'
          ? {
              title: `Move ${row.name} to ${pending.planName}?`,
              body: 'Its limits change straight away. Anything already over a new limit stays; new use past it is refused.',
              confirmLabel: 'Change plan',
            }
          : {
              title: `Change where ${row.name}’s prompts may be processed?`,
              body:
                pending.regions.length === 0
                  ? `Only where its data lives (${row.region}). A provider outside it is passed over.`
                  : `Only in ${pending.regions.join(', ')}. A provider outside these is passed over. Residency is part of the tenant’s contract.`,
              confirmLabel: 'Save regions',
            };

  return (
    <div className="app-TenantDrawer">
      <DescriptionList
        layout="inline"
        dense
        items={[
          { id: 'slug', label: 'Slug', value: <code>{row.slug}</code> },
          { id: 'plan', label: 'Plan', value: row.plan ?? '' },
          { id: 'region', label: 'Region', value: row.region },
          { id: 'created', label: 'Created', value: row.created },
          ...(row.suspendedSince ? [{ id: 'suspended', label: 'Suspended since', value: row.suspendedSince }] : []),
        ]}
      />

      <section className="app-TenantDrawer__section" aria-labelledby={`${regionsId}-usage`}>
        <h3 id={`${regionsId}-usage`} className="app-TenantDrawer__heading">
          Usage
        </h3>
        {detail === null ? (
          <SkeletonList rows={4} label="Loading usage…" />
        ) : detail.meters === null ? (
          <ProblemState size="sm" context="Usage" problem={detail.problem ?? { status: 503 }} />
        ) : (
          <ul className="app-TenantDrawer__meters">
            {detail.meters.map((meter) => (
              <li key={meter.meter} className="app-TenantDrawer__meter">
                <div className="app-TenantDrawer__meterHead">
                  <span className="app-TenantDrawer__meterLabel">{meter.label}</span>
                  <span className="app-TenantDrawer__meterValue">{meter.display}</span>
                  {meter.state !== 'ok' ? (
                    <StatusPill size="sm" tone={meter.state === 'blocked' ? 'danger' : 'warning'} label={meter.state === 'blocked' ? 'At the limit' : 'Past the warning line'} />
                  ) : null}
                </div>
                {meter.hard !== null && meter.hard > 0 ? (
                  <Meter
                    label={`${meter.label} used`}
                    value={meter.unit === 'bytes' ? meter.value / GB : meter.value}
                    max={meter.unit === 'bytes' ? meter.hard / GB : meter.hard}
                    hardLine={meter.unit === 'bytes' ? meter.hard / GB : meter.hard}
                    {...(meter.soft !== null ? { softLine: meter.unit === 'bytes' ? meter.soft / GB : meter.soft } : {})}
                    format={meter.unit === 'bytes' ? { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }}
                  />
                ) : null}
                <p className="app-TenantDrawer__meterLines">
                  {meter.period} · {meter.lines}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-TenantDrawer__section" aria-labelledby={`${regionsId}-plan`}>
        <h3 id={`${regionsId}-plan`} className="app-TenantDrawer__heading">
          Plan
        </h3>
        <div className="app-TenantDrawer__row">
          <Select
            aria-labelledby={`${regionsId}-plan`}
            size="sm"
            value={planKey}
            placeholder="Choose a plan"
            options={choices.map((plan) => ({ value: plan.key, label: plan.retired ? `${plan.name} (retired)` : plan.name }))}
            onChange={(event) => setPlanKey(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            {...offline}
            {...(planKey === '' || planKey === row.planKey ? { disabledReason: planKey === '' ? 'Choose a plan first' : 'That is its plan now' } : {})}
            onClick={() => setPending({ kind: 'plan', planKey, planName: plans.find((plan) => plan.key === planKey)?.name ?? planKey })}
          >
            Change plan
          </Button>
        </div>
      </section>

      <section className="app-TenantDrawer__section" aria-labelledby={`${regionsId}-regions`}>
        <h3 id={`${regionsId}-regions`} className="app-TenantDrawer__heading">
          AI regions
        </h3>
        <p className="app-TenantDrawer__text">{regionsText(row.aiRegions, row.region)}</p>
        {row.aiRegions !== null ? (
          <form
            className="app-TenantDrawer__row"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = parseRegions(regionsDraft);
              if (!parsed.ok) {
                setRegionsProblem(parsed.problem);
                return;
              }
              setRegionsProblem(null);
              setPending({ kind: 'regions', regions: parsed.regions });
            }}
          >
            <Input
              aria-labelledby={`${regionsId}-regions`}
              aria-describedby={regionsProblem ? regionsErrorId : undefined}
              invalid={regionsProblem !== null}
              size="sm"
              value={regionsDraft}
              placeholder={`Empty: only ${row.region}`}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setRegionsDraft(event.currentTarget.value)}
            />
            <Button size="sm" variant="secondary" type="submit" {...offline}>
              Save regions
            </Button>
          </form>
        ) : null}
        {regionsProblem ? (
          <p id={regionsErrorId} className="app-TenantDrawer__error" role="alert">
            {regionsProblem}
          </p>
        ) : null}
      </section>

      <section className="app-TenantDrawer__section app-TenantDrawer__danger" aria-labelledby={`${regionsId}-status`}>
        <h3 id={`${regionsId}-status`} className="app-TenantDrawer__heading">
          {row.status === 'suspended' ? 'Suspended' : 'Suspend'}
        </h3>
        {row.status === 'suspended' ? (
          <>
            <p className="app-TenantDrawer__text">Every call for this workspace is refused until it is resumed.</p>
            <Button size="sm" variant="primary" iconStart="play" {...offline} onClick={() => setPending({ kind: 'resume' })}>
              Resume…
            </Button>
          </>
        ) : (
          <>
            <p className="app-TenantDrawer__text">Refuses every call for this workspace until it is resumed. Nothing is deleted.</p>
            <Button size="sm" variant="dangerTinted" iconStart="pause" {...offline} onClick={() => setPending({ kind: 'suspend' })}>
              Suspend…
            </Button>
          </>
        )}
      </section>

      {/* Kept mounted, so focus returns to the button that opened it when it closes. */}
      <ConfirmDialog
        open={spec !== null}
        spec={spec ?? { title: '', confirmLabel: 'Confirm' }}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
