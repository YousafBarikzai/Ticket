import type { TriageAppliedItem, TriageSuggestionItem } from '@itsm/sdk';

/**
 * How triage reads to an agent (ADR-0051, `suggest` and `auto` modes).
 *
 * Pure and separate from the card so the wording has tests. Confidence is a
 * word, never a percentage: the same rule the reply suggestions follow,
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
