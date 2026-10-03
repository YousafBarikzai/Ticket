/**
 * Shared chart vocabulary. Types only.
 */

/** A categorical colour slot, 1–8 (§1.11). Slots follow the entity, never its rank. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Whether the data table behind a chart is offered, always shown, or left out. */
export type ChartTableMode = 'toggle' | 'visible' | 'hidden';

/**
 * A status colour for a chart mark (D5, D8): a priority's segment, an SLA
 * band, a risk dot. Distinct from `ChartSlot`, which is identity: status tones
 * and categorical slots never share a chart, so a reader never has to work
 * out whether orange means "P2" or "the third team".
 *
 * `high` is P2 orange; `neutralSoft` is the quiet fill a P4 or a "low" takes,
 * and is always drawn with an outline (`chartToneOutline`), because the fill
 * alone is under 3:1 on a card.
 */
export type ChartTone = 'danger' | 'high' | 'warning' | 'success' | 'info' | 'hold' | 'neutral' | 'neutralSoft';
