'use client';

import { useState, type ReactNode } from 'react';
import type { RuleRow } from '@itsm/sdk';
import { Button, Disclosure, EmptyState, RelativeTime, StatusPill, Surface } from '@itsm/ui';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { JsonDiff } from '../JsonDiff.js';
import { JsonView } from '../JsonView.js';
import { RULE_STATES, ruleState } from './presentation.js';
import type { RuleSnapshot, RuleVersionView, RuleView } from './types.js';

/**
 * A rule's published versions (SPEC §6.1 *History*; up to the latest 20):
 * each with when and by whom, what changed from the one before as a diff,
 * and **Restore** for someone who may publish — which publishes that
 * version's text as the next version (`POST /rules/:key/rollback`), so the
 * history always reads forwards. A rule taken offline by an edit (R1) shows
 * its unpublished changes against the last version first.
 */

/** The parts of a rule a version freezes, in one order, so a diff compares like with like. */
export function comparable(rule: RuleSnapshot | RuleView): Record<string, unknown> {
  return {
    name: rule.name,
    event: rule.event,
    conditions: rule.conditions,
    actions: rule.actions,
    order: rule.order,
    mode: rule.mode,
  };
}

export function RuleHistory({
  rule,
  versions,
  canPublish,
  onRestored,
}: {
  readonly rule: RuleView;
  readonly versions: readonly RuleVersionView[];
  readonly canPublish: boolean;
  /** Client only: the rule as the restore left it. */
  readonly onRestored: (row: RuleRow) => void;
}): ReactNode {
  const online = useOnline();
  const [restoring, setRestoring] = useState<RuleVersionView | null>(null);
  const state = ruleState(rule);
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const latest = ordered[0];

  const rollback = useMutation((version: number) => api.configure.rules.rollback(rule.key, version), {
    success: (row) => `Version ${row.version} is live`,
    failure: 'Couldn’t restore that version',
    onSuccess: onRestored,
  });

  if (ordered.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="history"
        title="Not published yet"
        description="A version is kept each time the rule is published, so you can see what changed and go back."
      />
    );
  }

  return (
    <div className="app-RuleHistory">
      {state === 'changes' && latest ? (
        <Surface as="section" tone="raised" elevation="xs" padding="md" className="app-VersionCard" aria-labelledby="unpublished-heading">
          <header className="app-VersionCard__head">
            <h3 id="unpublished-heading" className="app-VersionCard__title">
              Unpublished changes
            </h3>
            <StatusPill size="sm" {...RULE_STATES.changes} />
          </header>
          <p className="app-VersionCard__meta">
            Saved <RelativeTime date={rule.updatedAt} relativeStyle="long" />. The rule is offline until they’re published.
          </p>
          <Disclosure summary={`What changed since version ${latest.version}`} defaultOpen>
            <JsonDiff before={comparable(latest.snapshot)} after={comparable(rule)} label={`Unpublished changes to ${rule.name}`} />
          </Disclosure>
        </Surface>
      ) : null}

      <ol className="app-RuleHistory__list" aria-label={`Versions of ${rule.name}, newest first`}>
        {ordered.map((version, index) => {
          const previous = ordered[index + 1];
          const current = state === 'live' && version.version === rule.version;
          return (
            <li key={version.version}>
              <Surface as="article" tone="raised" elevation="xs" padding="md" className="app-VersionCard" aria-labelledby={`version-${version.version}`}>
                <header className="app-VersionCard__head">
                  <h3 id={`version-${version.version}`} className="app-VersionCard__title">
                    Version {version.version}
                  </h3>
                  {current ? <StatusPill size="sm" label="Current" tone="success" icon="circle-check" /> : null}
                  {canPublish && !current ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      iconStart="undo-2"
                      className="app-VersionCard__action"
                      onClick={() => setRestoring(version)}
                      aria-label={`Restore version ${version.version}`}
                      {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}
                    >
                      Restore
                    </Button>
                  ) : null}
                </header>
                <p className="app-VersionCard__meta">
                  Published <RelativeTime date={version.publishedAt} relativeStyle="long" />
                  {version.publishedBy ? <> by {version.publishedBy.name ?? 'someone the directory doesn’t know'}</> : null}
                </p>
                {previous ? (
                  <Disclosure summary={`What changed from version ${previous.version}`}>
                    <JsonDiff before={comparable(previous.snapshot)} after={comparable(version.snapshot)} label={`Changes in version ${version.version}`} />
                  </Disclosure>
                ) : (
                  <Disclosure summary="What it said">
                    <JsonView value={comparable(version.snapshot)} label={`Version ${version.version}`} />
                  </Disclosure>
                )}
              </Surface>
            </li>
          );
        })}
      </ol>

      {restoring ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRestoring(null);
          }}
          spec={{
            title: `Restore version ${restoring.version}?`,
            body: `Its conditions and actions are published as version ${rule.version + 1} and act on new events straight away.${
              state === 'changes' ? ' Your unpublished changes are replaced.' : ''
            }`,
            confirmLabel: `Restore version ${restoring.version}`,
          }}
          onConfirm={async () => {
            await rollback.run(restoring.version);
            setRestoring(null);
          }}
        />
      ) : null}
    </div>
  );
}
