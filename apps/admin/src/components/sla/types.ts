/**
 * What the service-level pages hand their client components: plain,
 * serialisable rows (SPEC §3.6 — no functions cross from server to client).
 */

/** A route tab of the page header, as `tabsFor` builds it. */
export interface HeaderTab {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly match?: 'exact';
}

/** The page header's server-worked parts: tabs for this person and the *View only* pill. */
export interface SlaHeader {
  readonly tabs: readonly HeaderTab[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
}

export interface PolicyTarget {
  readonly priority: string;
  readonly targetType: string;
  readonly minutes: number;
  readonly warningThresholds: readonly number[];
}

export interface PolicyView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly specificity: number;
  readonly calendarMode: string;
  readonly calendarId: string | null;
  readonly version: number;
  /** The stored match expression, as JSON. */
  readonly match: unknown;
  readonly targets: readonly PolicyTarget[];
}

/** A calendar as pickers and clock descriptions need it. */
export interface CalendarOption {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly timeZone: string;
  readonly isDefault: boolean;
}

export interface CalendarView extends CalendarOption {
  /** `{ mon: [{ start, end }] }`; a closed day is absent. */
  readonly hours: Readonly<Record<string, readonly { readonly start: string; readonly end: string }[]>>;
  /** The policies whose own calendar this is, by name. */
  readonly usedBy: readonly string[];
}
