'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type PriorityMatrixRow } from '@itsm/sdk';
import { Button, Select } from '@itsm/ui';
import { api } from '../client/api.js';
import { LEVELS, PRIORITIES, completeMatrix, matrixValue } from '../matrix.js';

/**
 * The impact-and-urgency grid.
 *
 * Nine cells, and the API takes all nine or refuses the lot — `matrixSchema`
 * is `.length(9)` and the service checks for a duplicate combination on top of
 * that. So this always sends a complete set, filled in from what is stored and
 * defaulted where a cell has never been set, rather than sending the cells
 * somebody happened to touch.
 *
 * A grid rather than nine labelled dropdowns because the shape is the
 * information: reading across a row tells you what rising urgency does to a
 * priority, and that is the thing an administrator is checking.
 */
export function PriorityMatrix({
  rows,
  canManage,
}: {
  rows: readonly PriorityMatrixRow[];
  canManage: boolean;
}): ReactNode {
  const router = useRouter();
  const [draft, setDraft] = useState<PriorityMatrixRow[]>(() => completeMatrix(rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setCell(impact: string, urgency: string, priority: string): void {
    setDraft((current) =>
      current.map((cell) =>
        cell.impact === impact && cell.urgency === urgency
          ? { ...cell, priority: priority as PriorityMatrixRow['priority'] }
          : cell,
      ),
    );
    setDone(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.configure.sla.setPriorityMatrix(draft);
      setDone(true);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The matrix could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="itsm-PriorityMatrix">
      <table>
        <caption>Impact and urgency decide the priority</caption>
        <thead>
          <tr>
            <th scope="col">
              <span aria-hidden="true">Impact ↓ / Urgency →</span>
              <span className="itsm-VisuallyHidden">Impact, down the side; urgency, across the top</span>
            </th>
            {LEVELS.map((urgency) => (
              <th scope="col" key={urgency}>
                {urgency}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LEVELS.map((impact) => (
            <tr key={impact}>
              <th scope="row">{impact}</th>
              {LEVELS.map((urgency) => {
                const value = matrixValue(draft, impact, urgency);
                return (
                  <td key={urgency}>
                    {canManage ? (
                      <Select
                        aria-label={`Priority when impact is ${impact} and urgency is ${urgency}`}
                        value={value}
                        onChange={(event) => setCell(impact, urgency, event.target.value)}
                        options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                      />
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {canManage ? (
        <>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            Save the matrix
          </Button>
          <p className="itsm-Admin__note">
            Saving replaces all nine cells. It changes the priority of tickets raised from now on, not of tickets that
            already exist.
          </p>
        </>
      ) : null}

      {error ? (
        <p className="itsm-FieldEditor__error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="itsm-FieldEditor__done" role="status">
          The matrix is saved.
        </p>
      ) : null}
    </div>
  );
}
