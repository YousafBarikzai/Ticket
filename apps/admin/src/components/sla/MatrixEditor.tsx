'use client';

import { useState, type ReactNode } from 'react';
import type { PriorityMatrixRow } from '@itsm/sdk';
import { Button, PRIORITY_LOOK as SHARED_PRIORITY_LOOK } from '@itsm/ui';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import {
  LEVELS,
  LEVEL_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  changedCells,
  completeMatrix,
  matrixSignature,
  matrixValue,
  recommendedMatrix,
  withCell,
  type Level,
  type Priority,
} from '../../matrix.js';
import { HeatGrid, type HeatGridOption } from './HeatGrid.js';
import { DirtyBar } from './DirtyBar.js';

/** P1 danger, P2 `high` orange, P3 and P4 neutral (D5): the shared priority tones, and the chip's text always says which. */
export const PRIORITY_OPTIONS: readonly HeatGridOption[] = PRIORITIES.map((priority, index) => ({
  value: priority,
  label: priority,
  description: PRIORITY_LABELS[priority],
  tone: SHARED_PRIORITY_LOOK[priority].tone,
  shortcut: String(index + 1),
}));

const AXIS = LEVELS.map((level) => ({ id: level, label: LEVEL_LABELS[level] }));

/**
 * The priority matrix editor (SPEC §6.1; fixes F30).
 *
 * The draft is the stored grid completed to nine cells, and it **resyncs from
 * the server** whenever what is stored changes — after this page saves and
 * refreshes, or when someone else's change arrives on a refresh. The old grid
 * copied its props into state once and never looked again, so a second save
 * could quietly put back the first one's values.
 *
 * Saving always sends all nine cells (the API refuses anything else), after a
 * confirmation that says what a new matrix does and does not touch. Changes
 * sit behind a dirty bar — "2 unsaved changes · Discard · Save matrix" — and
 * *Reset to recommended* only fills the draft, so it too is saved on purpose.
 */
export function MatrixEditor({ rows, canManage }: { readonly rows: readonly PriorityMatrixRow[]; readonly canManage: boolean }): ReactNode {
  const signature = matrixSignature(rows);
  const [synced, setSynced] = useState(signature);
  const [saved, setSaved] = useState<PriorityMatrixRow[]>(() => completeMatrix(rows));
  const [draft, setDraft] = useState<PriorityMatrixRow[]>(() => completeMatrix(rows));
  const [confirming, setConfirming] = useState(false);
  const online = useOnline();

  // The server sent a different grid: start again from it (derived state, so
  // there is never a render showing the old draft beside the new grid).
  if (synced !== signature) {
    setSynced(signature);
    setSaved(completeMatrix(rows));
    setDraft(completeMatrix(rows));
  }

  const save = useMutation((cells: PriorityMatrixRow[]) => api.configure.sla.setPriorityMatrix(cells), {
    success: 'Priority matrix saved',
    failure: 'Couldn’t save the priority matrix',
  });

  const changes = changedCells(saved, draft);
  const recommended = recommendedMatrix();
  const isRecommended = changedCells(draft, recommended) === 0;

  return (
    <div className="app-Matrix">
      <HeatGrid
        label="Priority by impact and urgency"
        rows={{ label: 'Impact', values: AXIS }}
        columns={{ label: 'Urgency', values: AXIS }}
        options={PRIORITY_OPTIONS}
        value={(impact, urgency) => matrixValue(draft, impact as Level, urgency as Level)}
        changed={(impact, urgency) => matrixValue(draft, impact as Level, urgency as Level) !== matrixValue(saved, impact as Level, urgency as Level)}
        {...(canManage
          ? { onChange: (impact: string, urgency: string, priority: string) => setDraft((current) => withCell(current, impact as Level, urgency as Level, priority as Priority)) }
          : {})}
      />

      {canManage ? (
        <div className="app-Matrix__tools">
          <Button
            variant="ghost"
            size="sm"
            iconStart="undo-2"
            onClick={() => setDraft(recommended)}
            {...(isRecommended ? { disabledReason: 'The grid already matches the recommendation.' } : {})}
          >
            Reset to recommended
          </Button>
        </div>
      ) : null}

      {canManage && changes > 0 ? (
        <DirtyBar
          count={changes}
          noun={{ one: 'unsaved change', other: 'unsaved changes' }}
          saveLabel="Save matrix"
          pending={save.pending}
          {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}
          onDiscard={() => setDraft(saved)}
          onSave={() => setConfirming(true)}
        />
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        spec={{
          title: 'Save the priority matrix?',
          body: 'Applies to new and re-prioritised tickets. Existing priorities don’t change.',
          confirmLabel: 'Save matrix',
        }}
        onConfirm={async () => {
          const cells = completeMatrix(draft);
          const result = await save.run(cells);
          // A failure is told once, by the toast (with Retry); the draft stays.
          setConfirming(false);
          // Keep the saved grid as the baseline at once; the refresh confirms it.
          if (result.ok) setSaved(cells);
        }}
      />
    </div>
  );
}
