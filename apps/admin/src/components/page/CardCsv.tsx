'use client';

import type { ReactNode } from 'react';
import { IconButton, notify } from '@itsm/ui';
import { exportTable } from './csv.js';

export interface CardCsvProps {
  /** The chart card's `id`: its table twin (the "View as table" data) is what is written. */
  readonly figureId: string;
  /** `sla-by-team-30-days.csv`. */
  readonly filename: string;
  /** What the button says to assistive technology and in its tooltip. */
  readonly label?: string;
}

/**
 * "Download data (CSV)" on a chart card (G6, A7 §2.3), placed in the card's
 * `actions`.
 *
 * Every chart in the kit renders its numbers twice on the server: as a
 * drawing and as a table twin for screen readers and "View as table". This
 * writes that table — the same figures, the same labels, the same period —
 * so the download can never disagree with the chart, and costs no request.
 */
export function CardCsv({ figureId, filename, label = 'Download data (CSV)' }: CardCsvProps): ReactNode {
  return (
    <IconButton
      label={label}
      icon="download"
      size="sm"
      onClick={() => {
        // `CSS.escape` is not in every test runner; an id from `useId()` or a slug needs only quotes escaped.
        const rows = exportTable(`[id="${figureId.replace(/["\\]/g, '\\$&')}"]`, filename);
        if (rows === null) notify('Nothing to download', { tone: 'info', description: 'This card has no data for the period.' });
      }}
    />
  );
}
