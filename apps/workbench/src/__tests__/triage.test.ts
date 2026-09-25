import { describe, expect, it } from 'vitest';
import type { TriageAppliedItem, TriageSuggestionItem } from '@itsm/sdk';
import { appliedLine, confidenceWord, fieldName, orderApplied, orderSuggestions, suggestionLine } from '../ai/triage.js';

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
