/**
 * Shared chart vocabulary. Types only.
 */

/** A categorical colour slot, 1–8 (§1.11). Slots follow the entity, never its rank. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Whether the data table behind a chart is offered, always shown, or left out. */
export type ChartTableMode = 'toggle' | 'visible' | 'hidden';
