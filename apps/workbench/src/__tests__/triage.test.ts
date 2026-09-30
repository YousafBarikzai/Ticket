import { describe, expect, it } from 'vitest';
import { ApiError, type TriageAppliedItem, type TriageSuggestion, type TriageSuggestionItem } from '@itsm/sdk';
import {
  acceptAllSummary,
  acceptInSequence,
  acceptingLine,
  appliedLine,
  confidenceLabel,
  confidenceWord,
  fieldName,
  notesLine,
  orderApplied,
  orderSuggestions,
  rowOf,
  stripLine,
  suggestionLine,
  triageView,
} from '../ai/triage.js';

/**
 * How a triage suggestion reads to an agent. Each case is a place the card
 * could promise more than it does.
 */

function item(overrides: Partial<TriageSuggestionItem> = {}): TriageSuggestionItem {
  return { question: 'category', field: 'categoryId', kind: 'apply', value: 'c1', display: 'Access / VPN', confidence: 0.85, ...overrides };
}

describe('the words', () => {
  it('shows confidence as a word, never a number', () => {
    expect(confidenceWord(0.92)).toBe('high');
    expect(confidenceWord(0.65)).toBe('medium');
    expect(confidenceWord(0.3)).toBe('low');
  });

  it('says what Accept would set', () => {
    expect(suggestionLine(item())).toBe('Set category to Access / VPN.');
    expect(suggestionLine(item({ question: 'group', display: 'Network' }))).toBe('Set team to Network.');
  });

  it('says a type cannot be changed rather than offering to change it', () => {
    expect(suggestionLine(item({ question: 'type', kind: 'info', display: 'request' }))).toMatch(/fixed when it is raised/);
  });

  it('never suggests declaring a major incident from here', () => {
    const line = suggestionLine(item({ question: 'majorIncident', kind: 'warning', value: true, display: 'true' }));
    expect(line).toMatch(/nothing is declared from here/);
  });

  it('names fields the way a desk does', () => {
    expect(fieldName('group')).toBe('Team');
    expect(fieldName('majorIncident')).toBe('Major incident');
  });
});

describe('the order', () => {
  it('puts what can be accepted first and the warning last', () => {
    const ordered = orderSuggestions([
      item({ question: 'majorIncident', kind: 'warning' }),
      item({ question: 'type', kind: 'info' }),
      item({ question: 'priority' }),
      item({ question: 'category' }),
    ]).map((entry) => entry.question);
    expect(ordered).toEqual(['category', 'priority', 'type', 'majorIncident']);
  });
});

describe('what the AI set by itself', () => {
  const applied = (overrides: Partial<TriageAppliedItem> = {}): TriageAppliedItem => ({
    question: 'group',
    field: 'groupId',
    value: 'g1',
    display: 'Network',
    confidence: 0.96,
    at: '2026-09-25T10:00:00.000Z',
    ...overrides,
  });

  it('says the AI set it, and what Undo does', () => {
    expect(appliedLine(applied())).toBe('AI set team to Network. Undo puts back what it was before.');
  });

  it('reads category before team', () => {
    expect(orderApplied([applied(), applied({ question: 'category', field: 'categoryId' })]).map((entry) => entry.question)).toEqual([
      'category',
      'group',
    ]);
  });
});

describe('shown where it acts', () => {
  const applied: TriageAppliedItem = { question: 'group', field: 'groupId', value: 'g1', display: 'Network', confidence: 0.96, at: '2026-09-25T10:00:00.000Z' };
  const triage = (overrides: Partial<TriageSuggestion> = {}): TriageSuggestion => ({
    decisionId: 'd1',
    provider: 'rules',
    model: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    suggestions: [
      item({ question: 'majorIncident', kind: 'warning', value: true, display: 'true' }),
      item({ question: 'type', kind: 'info', display: 'request' }),
      item({ question: 'priority', field: 'priority', value: 'P2', display: 'P2' }),
      item(),
    ],
    applied: [],
    ...overrides,
  });

  it('puts each answer on the row it would change', () => {
    expect(rowOf('category')).toBe('category');
    expect(rowOf('group')).toBe('team');
    expect(rowOf('priority')).toBe('priority');
    expect(rowOf('type')).toBeNull();
  });

  it('arranges the answers: acceptable in reading order, the type note apart, the warning on its own', () => {
    const view = triageView(triage())!;
    expect(view.acceptable.map((entry) => entry.question)).toEqual(['category', 'priority']);
    expect(view.pending.category?.display).toBe('Access / VPN');
    expect(view.pending.priority?.value).toBe('P2');
    expect(view.notes.map((entry) => entry.question)).toEqual(['type']);
    expect(view.warning?.question).toBe('majorIncident');
  });

  it('drops what this person already answered, and is nothing once nothing is left', () => {
    const view = triageView(triage(), new Set(['category', 'priority', 'type']))!;
    expect(view.acceptable).toEqual([]);
    expect(view.warning).not.toBeNull();
    expect(triageView(triage(), new Set(['category', 'priority', 'type', 'majorIncident']))).toBeNull();
    expect(triageView(null)).toBeNull();
  });

  it('shows a value the AI set on its row, for Undo', () => {
    const view = triageView(triage({ suggestions: [], applied: [applied] }))!;
    expect(view.applied.team?.display).toBe('Network');
    expect(view.acceptable).toEqual([]);
  });

  it('counts in words, never a number without a noun', () => {
    expect(stripLine(1)).toBe('AI triage: 1 suggestion');
    expect(stripLine(3)).toBe('AI triage: 3 suggestions');
    expect(notesLine(1)).toBe('1 more note');
    expect(notesLine(2)).toBe('2 more notes');
    expect(acceptingLine(2, 3)).toBe('Accepting 2 of 3…');
    expect(confidenceLabel(0.85)).toBe('High confidence');
    expect(confidenceLabel(0.3)).toBe('Low confidence');
  });
});

describe('Accept all', () => {
  const three = [item(), item({ question: 'group', field: 'groupId', value: 'g1', display: 'Network' }), item({ question: 'priority', field: 'priority', value: 'P2', display: 'P2' })];

  it('accepts one at a time, reading the version again after each change', async () => {
    const calls: string[] = [];
    let version = 4;
    const progress: string[] = [];
    const result = await acceptInSequence(three, 4, {
      version: async () => {
        calls.push('read version');
        return version;
      },
      accept: async (question, sent) => {
        calls.push(`accept ${question} @${sent}`);
        // Every accept is a ticket write: the version moves on.
        version = sent + 1;
      },
      onProgress: (current, total) => progress.push(acceptingLine(current, total)),
    });
    expect(calls).toEqual(['accept category @4', 'read version', 'accept group @5', 'read version', 'accept priority @6']);
    expect(progress).toEqual(['Accepting 1 of 3…', 'Accepting 2 of 3…', 'Accepting 3 of 3…']);
    expect(result).toEqual({ accepted: ['category', 'group', 'priority'], failed: null, skipped: [] });
    expect(acceptAllSummary(result, 3)).toBe('3 suggestions accepted');
  });

  it('reads the version again and tries once more when someone else changed the ticket in between', async () => {
    const calls: string[] = [];
    const conflict = new ApiError(409, null, 'changed');
    let first = true;
    const result = await acceptInSequence(three.slice(0, 1), 4, {
      version: async () => {
        calls.push('read version');
        return 9;
      },
      accept: async (question, sent) => {
        calls.push(`accept ${question} @${sent}`);
        if (first) {
          first = false;
          throw conflict;
        }
      },
      isConflict: (error) => error === conflict,
    });
    expect(calls).toEqual(['accept category @4', 'read version', 'accept category @9']);
    expect(result.accepted).toEqual(['category']);
  });

  it('stops at a failure, so nothing is accepted on top of a ticket the person has not seen', async () => {
    const refused = new ApiError(422, null, 'no');
    const result = await acceptInSequence(three, 4, {
      version: async () => 5,
      accept: async (question) => {
        if (question === 'group') throw refused;
      },
    });
    expect(result.accepted).toEqual(['category']);
    expect(result.failed).toEqual({ question: 'group', error: refused });
    expect(result.skipped).toEqual(['priority']);
    expect(acceptAllSummary(result, 3)).toBe('Accepted 1 of 3');
  });

  it('stops when the person has moved on', async () => {
    let cancelled = false;
    const result = await acceptInSequence(three, 4, {
      version: async () => 5,
      accept: async () => {
        cancelled = true;
      },
      cancelled: () => cancelled,
    });
    expect(result.accepted).toEqual(['category']);
    expect(result.skipped).toEqual(['group', 'priority']);
  });
});
