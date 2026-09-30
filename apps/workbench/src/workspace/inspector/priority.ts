import type { PriorityMatrixRow } from '@itsm/sdk';
import { LEVELS, PRIORITIES, type Level, type Priority } from '../../client/mutations.js';
import { priorityLabel } from '../../inbox/presentation.js';

/**
 * The priority an impact and an urgency make (X-45): shown live beside the
 * two choices on a new ticket, and beside them in the inspector, so an agent
 * sees the result before it is saved rather than discovering it afterwards.
 *
 * The desk's own grid when the reader may see it (`sla.policy.read`); the
 * recommended grid otherwise — the diagonal, High × High a P1 down to Low ×
 * Low a P4 — and then the preview says "usually", because the desk may have
 * changed it and the service, not this screen, decides.
 */

export const LEVEL_LABEL: Readonly<Record<Level, string>> = { high: 'High', medium: 'Medium', low: 'Low' };

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

/** The recommended grid's answer: the diagonal. */
export function recommendedPriority(impact: Level, urgency: Level): Priority {
  const rank = LEVELS.indexOf(impact) + LEVELS.indexOf(urgency);
  return PRIORITIES[Math.min(rank, PRIORITIES.length - 1)]!;
}

export interface PriorityPreview {
  readonly priority: Priority;
  /** `matrix`: the desk's own grid. `usual`: the recommended one, because the desk's could not be read. */
  readonly from: 'matrix' | 'usual';
}

/** The priority for a pair, or `null` until both are chosen (the service then uses the desk's default). */
export function previewPriority(
  matrix: readonly PriorityMatrixRow[] | null | undefined,
  impact: Level | null | undefined,
  urgency: Level | null | undefined,
): PriorityPreview | null {
  if (!impact || !urgency) return null;
  const cell = matrix?.find((row) => row.impact === impact && row.urgency === urgency);
  if (cell) return { priority: cell.priority, from: 'matrix' };
  return { priority: recommendedPriority(impact, urgency), from: 'usual' };
}

/** The words beside the choices: "→ P2 · High", or "Usually → P2 · High" when the desk's grid could not be read. */
export function previewLine(preview: PriorityPreview | null): string {
  if (!preview) return 'Choose both to see the priority';
  return `${preview.from === 'usual' ? 'Usually ' : ''}→ ${priorityLabel(preview.priority)}`;
}

/** What a screen reader hears for it: "Priority will be P2, High". */
export function previewSpoken(preview: PriorityPreview | null): string {
  if (!preview) return 'Choose an impact and an urgency to see the priority';
  const label = priorityLabel(preview.priority).replace(' · ', ', ');
  return preview.from === 'usual' ? `Priority will usually be ${label}` : `Priority will be ${label}`;
}
