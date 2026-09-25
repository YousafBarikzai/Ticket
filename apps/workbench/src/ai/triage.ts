import type { TriageSuggestionItem } from '@itsm/sdk';

/**
 * How a triage suggestion reads to an agent (ADR-0051, `suggest` mode).
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
