import { describe, expect, it } from 'vitest';
import { scoreCase } from '../service/eval-service.js';

/**
 * Scoring one answer.
 *
 * What is checked is never a golden string: two good replies to the same
 * ticket differ, and pinning one of them would score fluency rather than
 * usefulness. What is checked is that the answer can be stored, says what it
 * must, avoids what it must not, and is not three pages long.
 */
const reply = (text: string) => JSON.stringify({ text, reason: 'Drafted.', confidence: 0.9 });

describe('scoring a case', () => {
  it('gives full marks when every expectation holds', () => {
    const score = scoreCase('reply-draft', 'grounded', reply('Your expenses account has been unlocked.'), {
      mustMention: ['expenses'],
      mustNotMention: ['guarantee'],
      maxWords: 50,
    });
    expect(score).toEqual({ key: 'grounded', score: 1, failures: [] });
  });

  it('scores zero for an answer that cannot be stored, rather than skipping it', () => {
    // A prompt whose answers stop parsing is exactly the regression the gate
    // exists to catch; averaging it away would hide it.
    const score = scoreCase('reply-draft', 'broken', 'Sure! Here you go.', { mustMention: ['expenses'] });
    expect(score.score).toBe(0);
    expect(score.failures[0]).toMatch(/could not be stored/);
  });

  it('counts each expectation separately, so a partial answer scores partly', () => {
    const score = scoreCase('reply-draft', 'partial', reply('We will fix it, we guarantee it.'), {
      mustMention: ['expenses'],
      mustNotMention: ['guarantee'],
    });
    expect(score.score).toBe(0);
    expect(score.failures).toHaveLength(2);
  });

  it('is case-insensitive about what was mentioned, because prose is', () => {
    const score = scoreCase('reply-draft', 'casing', reply('Your EXPENSES account is fine.'), { mustMention: ['expenses'] });
    expect(score.score).toBe(1);
  });

  it('looks inside every string of the answer, not only the obvious one', () => {
    const article = JSON.stringify({
      title: 'A title',
      summary: 'A summary',
      body: ['The VPN client needed reinstalling.'],
      reason: 'x',
      confidence: 0.9,
    });
    expect(scoreCase('article-draft', 'nested', article, { mustMention: ['VPN'] }).score).toBe(1);
  });

  it('counts words across the whole answer, and says how many', () => {
    const score = scoreCase('reply-draft', 'long', reply('word '.repeat(60)), { maxWords: 10 });
    expect(score.score).toBe(0);
    expect(score.failures[0]).toMatch(/above the limit of 10/);
  });

  it('gives full marks to an answer that only had to parse', () => {
    expect(scoreCase('reply-draft', 'bare', reply('Anything at all.'), {}).score).toBe(1);
  });
});
