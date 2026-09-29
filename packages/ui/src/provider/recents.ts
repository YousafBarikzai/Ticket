'use client';

/**
 * Something a person opened recently or pinned, as the palette and the
 * sidebar list it. Keys and labels only — never ticket content — because it is
 * kept in this device's `localStorage`.
 */
export interface RecentItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** What it is: `ticket`, `rule`, `article`… Groups the list and picks its icon. */
  readonly kind: string;
  readonly meta?: string;
}

export interface Pins {
  readonly pins: readonly RecentItem[];
  pin(item: RecentItem): void;
  unpin(id: string): void;
}

const none: readonly RecentItem[] = [];
const noPins: Pins = { pins: none, pin() {}, unpin() {} };

/**
 * Records a visit to the current entity (at most 8 per app, newest first).
 *
 * Stub (SPEC §4.1): records nothing yet; the foundations package stores them.
 */
export function useRecordRecent(item: RecentItem): void {
  void item;
}

/** The recent items, newest first. Stub: always empty. */
export function useRecents(): readonly RecentItem[] {
  return none;
}

/** Items pinned "on this device". Stub: always empty, and pinning does nothing. */
export function usePins(): Pins {
  return noPins;
}
