import { describe, expect, it } from 'vitest';
import type { PriorityMatrixRow } from '@itsm/sdk';
import {
  LEVELS,
  changedCells,
  completeMatrix,
  defaultFor,
  matrixSignature,
  matrixValue,
  recommendedMatrix,
  withCell,
} from '../matrix.js';

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

describe('the recommended matrix ("Reset to recommended")', () => {
  it('exports the diagonal rule the page resets to', () => {
    expect(defaultFor('high', 'high')).toBe('P1');
    expect(defaultFor('high', 'medium')).toBe('P2');
    expect(defaultFor('medium', 'high')).toBe('P2');
    expect(defaultFor('high', 'low')).toBe('P3');
    expect(defaultFor('medium', 'medium')).toBe('P3');
    expect(defaultFor('medium', 'low')).toBe('P4');
    expect(defaultFor('low', 'low')).toBe('P4');
  });

  it('resets every cell to the recommendation, whatever was stored, still nine cells', () => {
    const odd = completeMatrix([]).map((cell) => ({ ...cell, priority: 'P1' as const }));
    const reset = recommendedMatrix();
    expect(reset).toHaveLength(9);
    expect(reset).toEqual(completeMatrix([]));
    expect(changedCells(odd, reset)).toBe(8);
  });
});

describe('editing a cell', () => {
  it('changes exactly one cell and keeps all nine', () => {
    const before = completeMatrix([]);
    const after = withCell(before, 'low', 'high', 'P1');
    expect(after).toHaveLength(9);
    expect(matrixValue(after, 'low', 'high')).toBe('P1');
    expect(changedCells(before, after)).toBe(1);
    expect(new Set(after.map((row) => `${row.impact}:${row.urgency}`)).size).toBe(9);
  });

  it('completes a partial grid before editing, so the result can always be sent', () => {
    expect(withCell([{ impact: 'high', urgency: 'high', priority: 'P2' }], 'low', 'low', 'P3')).toHaveLength(9);
  });

  it('counts no change when a cell is set back to what it was', () => {
    const before = completeMatrix([]);
    const after = withCell(withCell(before, 'low', 'low', 'P1'), 'low', 'low', 'P4');
    expect(changedCells(before, after)).toBe(0);
  });
});

describe('resyncing from the server', () => {
  it('fingerprints the stored grid independent of the order the API sends it in', () => {
    const cells = completeMatrix([]);
    expect(matrixSignature([...cells].reverse())).toBe(matrixSignature(cells));
  });

  it('changes when any cell changes, so a refreshed page replaces the draft', () => {
    const cells = completeMatrix([]);
    expect(matrixSignature(withCell(cells, 'medium', 'medium', 'P1'))).not.toBe(matrixSignature(cells));
  });
});
