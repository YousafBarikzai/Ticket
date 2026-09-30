import type { ReactNode } from 'react';
import { PRIORITY_ROWS, TARGET_LABELS, cellKey, formatTarget, type TargetsModel } from './presentation.js';

/**
 * A policy's targets at a glance: P1–P4 down the side, the promises in use
 * across the top, each cell a duration in business hours ("4 h", "30 min") or
 * a dash for no target. Replaces the old "P1 response in 60 minutes; P1
 * resolution in 4 hours; …" string. Server-safe.
 */
export function MiniMatrix({ model, caption }: { readonly model: TargetsModel; readonly caption: string }): ReactNode {
  return (
    <table className="app-MiniMatrix">
      <caption className="itsm-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <td />
          {model.types.map((type) => (
            <th key={type} scope="col">
              {TARGET_LABELS[type].label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PRIORITY_ROWS.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.id}</th>
            {model.types.map((type) => {
              const minutes = model.cells[cellKey(row.id, type)];
              return (
                <td key={type}>
                  {minutes === undefined ? (
                    <span className="app-MiniMatrix__none">
                      <span aria-hidden="true">—</span>
                      <span className="itsm-visually-hidden">No target</span>
                    </span>
                  ) : (
                    formatTarget(minutes)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
