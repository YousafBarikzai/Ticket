import { describe, expect, it } from 'vitest';
import type { PriorityMatrixRow } from '@itsm/sdk';
import { LEVELS, completeMatrix, matrixValue } from '../matrix.js';

/**
 * The nine cells, checked against the rule the API enforces.
 *
 * `matrixSchema` is `.length(9)` and `setPriorityMatrix` refuses a duplicate
 * impact-and-urgency pair on top of that. A grid that sent only the cells
 * somebody touched would be rejected every time, and one that sent a duplicate
 * would be rejected in a way that reads like a bug in the API.
 */

describe('completing the matrix', () => {
  it('always produces exactly nine cells', () => {
    expect(completeMatrix([])).toHaveLength(9);
    expect(completeMatrix([{ impact: 'high', urgency: 'high', priority: 'P1' }])).toHaveLength(9);
  });

  it('never produces a duplicate combination', () => {
    const seen = new Set(completeMatrix([]).map((row) => `${row.impact}:${row.urgency}`));
    expect(seen.size).toBe(9);
  });

  it('covers every combination of the three levels', () => {
    const cells = completeMatrix([]);
    for (const impact of LEVELS) {
      for (const urgency of LEVELS) {
        expect(cells.some((cell) => cell.impact === impact && cell.urgency === urgency), `${impact}/${urgency}`).toBe(true);
      }
    }
  });

  it('keeps what is stored and fills in only what is missing', () => {
    const stored: PriorityMatrixRow[] = [
      { impact: 'low', urgency: 'low', priority: 'P1' },
      { impact: 'high', urgency: 'high', priority: 'P4' },
    ];
    const cells = completeMatrix(stored);
    // Deliberately inverted values: a tenant's own matrix wins over the
    // sensible default, however odd it looks.
    expect(matrixValue(cells, 'low', 'low')).toBe('P1');
    expect(matrixValue(cells, 'high', 'high')).toBe('P4');
    expect(cells).toHaveLength(9);
  });

  it('defaults an unset grid along the diagonal', () => {
    const cells = completeMatrix([]);
    expect(matrixValue(cells, 'high', 'high')).toBe('P1');
    expect(matrixValue(cells, 'low', 'low')).toBe('P4');
    // Never off the end of the four priorities.
    for (const cell of cells) expect(['P1', 'P2', 'P3', 'P4']).toContain(cell.priority);
  });

  it('is stable, so saving an untouched grid changes nothing', () => {
    const once = completeMatrix([]);
    expect(completeMatrix(once)).toEqual(once);
  });
});
