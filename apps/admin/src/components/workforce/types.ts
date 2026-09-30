/**
 * What the Workforce pages hand their client components: plain rows with
 * names already resolved (SPEC §3.6, F8).
 */

export interface WorkforceHeader {
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly href: string; readonly match?: 'exact' }[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
}

export interface PersonName {
  readonly id: string;
  /** Null when the directory did not answer for this id: "Unknown person". */
  readonly name: string | null;
}

/** One person's availability, as the Now table shows it. */
export interface AvailabilityView {
  readonly [field: string]: unknown;
  readonly userId: string;
  readonly person: { readonly id: string; readonly name: string };
  readonly status: string;
  readonly effectiveStatus: string;
  readonly reason: string | null;
  readonly until: string | null;
  /** Null: routing uses the team's default. */
  readonly capacity: number | null;
  readonly source: string;
  readonly updatedAt: string;
  /** Whether the signed-in person may change this row. */
  readonly editable: boolean;
}

export interface RotaView {
  readonly key: string;
  readonly name: string;
  readonly teamName: string | null;
  readonly timeZone: string;
  readonly cadence: string;
  readonly handoverAt: string;
  readonly members: readonly PersonName[];
  /** Null when "who is on call" could not be read for this rota. */
  readonly now: {
    readonly person: PersonName | null;
    readonly covering: boolean;
    readonly next: { readonly person: PersonName; readonly at: string } | null;
    readonly overrides: readonly { readonly id: string; readonly person: PersonName; readonly startsAt: string; readonly endsAt: string; readonly reason: string | null }[];
  } | null;
}

export interface ShiftView {
  readonly [field: string]: unknown;
  readonly key: string;
  readonly name: string;
  readonly teamName: string | null;
  readonly timeZone: string;
  /** `{ mon: [{ start, end }] }`, as the week strip draws it. */
  readonly hours: Readonly<Record<string, readonly { readonly start: string; readonly end: string }[]>>;
  /** Everybody on it today, for the avatar stack. */
  readonly people: readonly { readonly name: string }[];
  readonly peopleCount: number;
  readonly assignments: readonly { readonly id: string; readonly person: PersonName; readonly startsOn: string; readonly endsOn: string | null; readonly current: boolean }[];
}

export interface SkillView {
  readonly [field: string]: unknown;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
}
