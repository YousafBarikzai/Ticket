import type { TriageAppliedItem, TriageSuggestion, TriageSuggestionItem } from '@itsm/sdk';

/**
 * How triage reads to an agent (ADR-0051, `suggest` and `auto` modes).
 *
 * Pure and separate from the inspector so the wording has tests. Confidence
 * is a word, never a percentage: the same rule the reply suggestions follow,
 * because a number nobody has calibrated for this desk reads as a promise.
 */

const FIELD_NAMES: Readonly<Record<string, string>> = {
  type: 'Type',
  category: 'Category',
  group: 'Team',
  priority: 'Priority',
  majorIncident: 'Major incident',
};

export function fieldName(question: string): string {
  return FIELD_NAMES[question] ?? question;
}

export function confidenceWord(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/** "High confidence": the band as a person reads it beside the value. */
export function confidenceLabel(confidence: number): string {
  const word = confidenceWord(confidence);
  return `${word[0]!.toUpperCase()}${word.slice(1)} confidence`;
}

/** The sentence under each suggestion, saying what Accept would do. */
export function suggestionLine(item: TriageSuggestionItem): string {
  switch (item.kind) {
    case 'apply':
      return `Set ${fieldName(item.question).toLowerCase()} to ${item.display}.`;
    case 'info':
      return `Reads as a ${item.display}. A ticket’s type is fixed when it is raised, so there is nothing to change here.`;
    case 'warning':
      return 'This looks like it could be a major incident. If it is, declare one through your major-incident process; nothing is declared from here.';
  }
}

/** Accept first, the warning last: the order an agent can act on. */
export function orderSuggestions(items: readonly TriageSuggestionItem[]): TriageSuggestionItem[] {
  const rank: Record<TriageSuggestionItem['kind'], number> = { apply: 0, info: 1, warning: 2 };
  const questionRank = ['category', 'group', 'priority', 'type', 'majorIncident'];
  return [...items].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || questionRank.indexOf(a.question) - questionRank.indexOf(b.question),
  );
}

/** The sentence under a value the AI set by itself, saying what Undo would do. */
export function appliedLine(item: TriageAppliedItem): string {
  return `AI set ${fieldName(item.question).toLowerCase()} to ${item.display}. Undo puts back what it was before.`;
}

/** Category before team: the order a person reads a routing decision in. */
export function orderApplied(items: readonly TriageAppliedItem[]): TriageAppliedItem[] {
  const questionRank = ['category', 'group'];
  return [...items].sort((a, b) => questionRank.indexOf(a.question) - questionRank.indexOf(b.question));
}

/* ---------------------------------------------------- Shown where it acts */

/** The inspector rows a triage answer belongs to (SPEC §6.2: "the affected row shows…"). */
export type TriageRow = 'category' | 'team' | 'priority';

export function rowOf(question: string): TriageRow | null {
  switch (question) {
    case 'category':
      return 'category';
    case 'group':
      return 'team';
    case 'priority':
      return 'priority';
    default:
      return null;
  }
}

/**
 * The triage answers arranged for the inspector: each acceptable suggestion
 * and each value the AI set on the row it affects, the type note behind "1
 * more note", and the major-incident call on its own. `handled` holds the
 * questions this person has already answered here, which leave at once
 * rather than waiting for the next read.
 */
export interface TriageView {
  readonly decisionId: string;
  /** Suggestions an agent may accept, in the order they are read. */
  readonly acceptable: readonly TriageSuggestionItem[];
  readonly pending: Readonly<Partial<Record<TriageRow, TriageSuggestionItem>>>;
  readonly applied: Readonly<Partial<Record<TriageRow, TriageAppliedItem>>>;
  /** Only to read and dismiss (a ticket's type is fixed when it is raised). */
  readonly notes: readonly TriageSuggestionItem[];
  readonly warning: TriageSuggestionItem | null;
  /**
   * Written into the demo by its build, not by a provider (A4 §1.14, D13):
   * the card says "Sample" so a visitor never mistakes it for a live call.
   */
  readonly sample: boolean;
}

/** The provider name the demo's build writes its triage decisions under. */
export const SAMPLE_PROVIDER = 'sample';

/** Whether a decision is one of the demo's samples rather than a provider's answer. */
export function isSampleProvider(provider: string | null | undefined): boolean {
  return provider === SAMPLE_PROVIDER;
}

/** What the "Sample" badge's info says (A6 §5.6.5 row 3). */
export const SAMPLE_NOTE = 'This is a sample decision written into the demo; no AI provider was called.';

export function triageView(triage: TriageSuggestion | null | undefined, handled: ReadonlySet<string> = new Set()): TriageView | null {
  if (!triage) return null;
  const open = orderSuggestions(triage.suggestions).filter((item) => !handled.has(item.question));
  const pending: Partial<Record<TriageRow, TriageSuggestionItem>> = {};
  const acceptable: TriageSuggestionItem[] = [];
  const notes: TriageSuggestionItem[] = [];
  let warning: TriageSuggestionItem | null = null;
  for (const item of open) {
    const row = rowOf(item.question);
    if (item.kind === 'apply' && row) {
      pending[row] = item;
      acceptable.push(item);
    } else if (item.kind === 'warning') warning = item;
    else notes.push(item);
  }
  const applied: Partial<Record<TriageRow, TriageAppliedItem>> = {};
  for (const item of orderApplied(triage.applied ?? [])) {
    const row = rowOf(item.question);
    if (row && !handled.has(item.question)) applied[row] = item;
  }
  const view: TriageView = { decisionId: triage.decisionId, acceptable, pending, applied, notes, warning, sample: isSampleProvider(triage.provider) };
  return isEmptyView(view) ? null : view;
}

function isEmptyView(view: TriageView): boolean {
  return view.acceptable.length === 0 && Object.keys(view.applied).length === 0 && view.notes.length === 0 && view.warning === null;
}

/** The strip at the top of the inspector, shown only while something waits: "AI triage: 3 suggestions". */
export function stripLine(count: number): string {
  return `AI triage: ${count} ${count === 1 ? 'suggestion' : 'suggestions'}`;
}

/** "1 more note", "2 more notes": what hides the type notes in the strip. */
export function notesLine(count: number): string {
  return `${count} more ${count === 1 ? 'note' : 'notes'}`;
}

/** Progress while Accept all works through them: "Accepting 2 of 3…". */
export function acceptingLine(current: number, total: number): string {
  return `Accepting ${current} of ${total}…`;
}

/* --------------------------------------------------------- Accept all */

export interface AcceptAllDeps {
  /**
   * The ticket's version as it is now. Accepting changes the ticket, and the
   * accept answers without the new version, so the next accept needs a fresh
   * read of it — never the version from before the last change.
   */
  readonly version: () => Promise<number>;
  readonly accept: (question: string, version: number) => Promise<void>;
  /** Before each accept: which one (1-based) of how many. */
  readonly onProgress?: (current: number, total: number) => void;
  /** Checked before each accept: stop when the person has moved on. */
  readonly cancelled?: () => boolean;
  /** Whether a failure is someone else's change arriving first (409/412): read the version again and try once more. */
  readonly isConflict?: (error: unknown) => boolean;
}

export interface AcceptAllResult {
  readonly accepted: readonly string[];
  /** The one that failed and stopped the run, with why. */
  readonly failed: { readonly question: string; readonly error: unknown } | null;
  /** The ones not tried because an earlier one failed, or the run was cancelled. */
  readonly skipped: readonly string[];
}

/**
 * Accepts the suggestions one after another (SPEC §6.2, WP25): the first with
 * the version the person is looking at, every later one with a version read
 * again after the one before it landed. A conflict on the way — somebody else
 * changed the ticket in between — is read again and tried once more; any
 * other failure stops the run, so nothing is accepted on top of a ticket the
 * person has not seen.
 */
export async function acceptInSequence(
  items: readonly TriageSuggestionItem[],
  startVersion: number,
  deps: AcceptAllDeps,
): Promise<AcceptAllResult> {
  const accepted: string[] = [];
  let version = startVersion;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (deps.cancelled?.()) {
      return { accepted, failed: null, skipped: items.slice(index).map((entry) => entry.question) };
    }
    deps.onProgress?.(index + 1, items.length);
    try {
      if (index > 0) version = await deps.version();
      try {
        await deps.accept(item.question, version);
      } catch (error) {
        if (!deps.isConflict?.(error)) throw error;
        version = await deps.version();
        await deps.accept(item.question, version);
      }
      accepted.push(item.question);
    } catch (error) {
      return { accepted, failed: { question: item.question, error }, skipped: items.slice(index + 1).map((entry) => entry.question) };
    }
  }
  return { accepted, failed: null, skipped: [] };
}

/** What Accept all did, for the toast: "3 suggestions accepted", "Accepted 1 of 3". */
export function acceptAllSummary(result: AcceptAllResult, total: number): string {
  if (!result.failed && result.skipped.length === 0) {
    return total === 1 ? 'Suggestion accepted' : `${total} suggestions accepted`;
  }
  return `Accepted ${result.accepted.length} of ${total}`;
}
