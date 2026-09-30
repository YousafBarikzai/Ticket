'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { DescriptionList, EmptyState, StatusPill, Surface } from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { DirtyBar } from './DirtyBar.js';
import { MiniMatrix } from './MiniMatrix.js';
import { NewPolicySheet } from './NewPolicySheet.js';
import {
  describeClock,
  describeConditions,
  inEvaluationOrder,
  policyState,
  targetChanges,
  targetsFrom,
  targetsModel,
  type TargetsModel,
} from './presentation.js';
import { TargetsGrid } from './TargetsGrid.js';
import type { CalendarOption, PolicyView, SlaHeader } from './types.js';
import { useNewFlag } from './useNewFlag.js';

/**
 * Service levels › Policies (SPEC §6.1): the promises this desk makes, as
 * cards in the order the clock checks them, each opening a drawer
 * (`?open=policy:<key>`) where its targets are edited in place.
 *
 * *New policy* opens a sheet (`?new=1`, which the palette's "New SLA policy"
 * also opens) that ends in **Create and publish** behind a confirmation —
 * the API puts a policy live the moment it exists, and the old form did it
 * without saying so (F26).
 */
export function PoliciesView({
  header,
  policies,
  calendars,
  canManage,
}: {
  readonly header: SlaHeader;
  readonly policies: readonly PolicyView[];
  readonly calendars: readonly CalendarOption[];
  readonly canManage: boolean;
}): ReactNode {
  const drawer = useDrawer('policy');
  const create = useNewFlag();
  const ordered = inEvaluationOrder(policies);
  const open = drawer.key ? ordered.find((policy) => policy.key === drawer.key) : undefined;
  const [dirty, setDirty] = useState(false);

  return (
    <div className="app-Page app-Sla">
      <PageHeader
        title="Service levels"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-policy', label: 'New policy', icon: 'plus', variant: 'primary', shortcut: 'c' } } : {})}
        onAction={(id) => {
          if (id === 'new-policy') create.open();
        }}
      />

      {ordered.length === 0 ? (
        <EmptyState
          icon="sla"
          title="No promises yet"
          description="Tickets won’t have SLA clocks until a policy exists."
          {...(canManage ? { action: { id: 'new-policy', label: 'New policy', icon: 'plus', variant: 'primary' } } : {})}
          onAction={() => create.open()}
        />
      ) : (
        <section className="app-Policies" aria-labelledby="policies-caption">
          <p id="policies-caption" className="app-Policies__caption">
            The most specific matching policy applies. They are checked in this order.
          </p>
          <ol className="app-Policies__list">
            {ordered.map((policy, index) => (
              <li key={policy.id}>
                <PolicyCard
                  policy={policy}
                  position={index + 1}
                  calendars={calendars}
                  href={drawer.href(policy.key)}
                  current={drawer.key === policy.key}
                  onOpen={() => drawer.open(policy.key)}
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDirty(false);
            drawer.close();
          }
        }}
        size="lg"
        dirty={dirty}
        title={open?.name ?? 'Policy'}
        {...(open ? { headerMeta: <StatusPill size="sm" {...policyState(open.status)} /> } : {})}
      >
        {open ? (
          <PolicyDetail
            key={`${open.key}:${open.version}`}
            policy={open}
            position={ordered.indexOf(open) + 1}
            total={ordered.length}
            calendars={calendars}
            canManage={canManage}
            onDirtyChange={setDirty}
          />
        ) : drawer.key ? (
          <EmptyState size="sm" icon="sla" title="That policy no longer exists" description="It may have been removed since the link was shared." />
        ) : null}
      </Sheet>

      {canManage ? (
        <NewPolicySheet
          open={create.isOpen}
          onClose={create.close}
          policies={ordered}
          calendars={calendars}
        />
      ) : null}
    </div>
  );
}

function PolicyCard({
  policy,
  position,
  calendars,
  href,
  current,
  onOpen,
}: {
  readonly policy: PolicyView;
  readonly position: number;
  readonly calendars: readonly CalendarOption[];
  readonly href: string;
  readonly current: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const state = policyState(policy.status);
  const model = targetsModel(policy.targets);
  const titleId = `policy-${policy.key}`;
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    // Modified clicks open a new tab as links do; a plain click opens the drawer in place.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen();
  };
  return (
    <Surface as="article" tone="raised" elevation="sm" padding="lg" className="app-PolicyCard" aria-labelledby={titleId} data-current={current ? '' : undefined}>
      <header className="app-PolicyCard__head">
        <span className="app-PolicyCard__order" aria-hidden="true">
          {position}
        </span>
        <h2 className="app-PolicyCard__title" id={titleId}>
          <a className="app-PolicyCard__link" href={href} onClick={follow} {...(current ? { 'aria-current': 'true' as const } : {})}>
            {policy.name}
          </a>
        </h2>
        <StatusPill size="sm" label={state.label} tone={state.tone} />
      </header>
      <DescriptionList
        layout="grid"
        dense
        items={[
          { id: 'applies', label: 'Applies to', value: describeConditions(policy.match) },
          { id: 'clock', label: 'Clock', value: describeClock(policy, calendars) },
        ]}
      />
      {policy.targets.length > 0 ? (
        <MiniMatrix model={model} caption={`Targets for ${policy.name}`} />
      ) : (
        <p className="app-PolicyCard__none">No targets: nothing is timed under this policy.</p>
      )}
      <div className="app-PolicyCard__key">
        <TechnicalKey value={policy.key} label="policy key" />
      </div>
    </Surface>
  );
}

function PolicyDetail({
  policy,
  position,
  total,
  calendars,
  canManage,
  onDirtyChange,
}: {
  readonly policy: PolicyView;
  readonly position: number;
  readonly total: number;
  readonly calendars: readonly CalendarOption[];
  readonly canManage: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
  const saved = targetsModel(policy.targets);
  const [draft, setDraft] = useState<TargetsModel>(saved);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [thresholdErrors, setThresholdErrors] = useState<Readonly<Record<string, string>>>({});
  const [confirming, setConfirming] = useState(false);
  // Remounts the grid on Discard, so text a cell could not read is cleared too.
  const [generation, setGeneration] = useState(0);
  const online = useOnline();
  const changes = targetChanges(saved, draft, invalid);

  const save = useMutation((targets: ReturnType<typeof targetsFrom>) => api.configure.sla.setTargets(policy.key, targets), {
    success: `Targets saved for ${policy.name}`,
    failure: `Couldn’t save the targets for ${policy.name}`,
  });

  const update = (next: TargetsModel): void => {
    setDraft(next);
    onDirtyChange(targetChanges(saved, next, invalid) > 0);
  };

  const updateInvalid = (next: ReadonlySet<string>): void => {
    setInvalid(next);
    onDirtyChange(targetChanges(saved, draft, next) > 0);
  };

  const discard = (): void => {
    setDraft(saved);
    setInvalid(new Set());
    setThresholdErrors({});
    setGeneration((value) => value + 1);
    onDirtyChange(false);
  };

  const targets = targetsFrom(draft);
  const blocked = !online
    ? 'You’re offline — changes can’t be saved.'
    : invalid.size > 0
      ? `Fix the ${invalid.size === 1 ? 'target that isn’t' : `${invalid.size} targets that aren’t`} a duration.`
      : Object.keys(thresholdErrors).length > 0
        ? 'Fix the warning thresholds.'
        : targets.length === 0
          ? 'A policy needs at least one target.'
          : undefined;

  return (
    <div className="app-PolicyDetail">
      <DescriptionList
        layout="inline"
        items={[
          { id: 'applies', label: 'Applies to', value: describeConditions(policy.match) },
          { id: 'clock', label: 'Clock', value: describeClock(policy, calendars) },
          {
            id: 'order',
            label: 'Checked',
            value: `${ordinal(position)} of ${total}`,
            hint: `Specificity ${policy.specificity}: higher is checked first.`,
          },
        ]}
      />
      {canManage ? (
        <p className="app-PolicyDetail__note">
          The name, what it applies to and its clock are set when a policy is created. To change them, create a new policy with a higher
          specificity.
        </p>
      ) : null}

      <section className="app-PolicyDetail__targets" aria-labelledby="policy-targets">
        <h3 id="policy-targets" className="app-PolicyDetail__heading">
          Targets
        </h3>
        {canManage ? (
          <TargetsGrid
            key={generation}
            label={`Targets for ${policy.name}`}
            value={draft}
            saved={saved}
            onChange={update}
            invalid={invalid}
            onInvalidChange={updateInvalid}
            thresholdErrors={thresholdErrors}
            onThresholdErrorsChange={setThresholdErrors}
          />
        ) : policy.targets.length > 0 ? (
          <MiniMatrix model={saved} caption={`Targets for ${policy.name}`} />
        ) : (
          <p className="app-PolicyDetail__note">No targets: nothing is timed under this policy.</p>
        )}
      </section>

      {canManage && changes > 0 ? (
        <DirtyBar
          count={changes}
          noun={{ one: 'change', other: 'changes' }}
          saveLabel="Save targets"
          pending={save.pending}
          {...(blocked ? { disabledReason: blocked } : {})}
          onDiscard={discard}
          onSave={() => setConfirming(true)}
        />
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        spec={{
          title: `Save the targets for ${policy.name}?`,
          body: 'New targets apply to timers started from now. Timers already running keep the target they started with.',
          confirmLabel: 'Save targets',
        }}
        onConfirm={async () => {
          const result = await save.run(targets);
          setConfirming(false);
          if (result.ok) onDirtyChange(false);
        }}
      />
    </div>
  );
}

function ordinal(n: number): string {
  const rule = new Intl.PluralRules('en-GB', { type: 'ordinal' }).select(n);
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' }[rule as 'one' | 'two' | 'few' | 'other'] ?? 'th';
  return `${n}${suffix}`;
}

