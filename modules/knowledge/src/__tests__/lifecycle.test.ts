import { describe, expect, it } from 'vitest';
import { canTransition, refusalReason, transitionsFrom } from '../domain/lifecycle.js';

describe('the article lifecycle', () => {
  it('allows the transitions an author and a reviewer need', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('draft', 'published')).toBe(true);
    expect(canTransition('in_review', 'published')).toBe(true);
    expect(canTransition('in_review', 'draft')).toBe(true);
    expect(canTransition('published', 'retired')).toBe(true);
    expect(canTransition('retired', 'draft')).toBe(true);
  });

  it('keeps a published article published while the next version is written', () => {
    // The difference between this and a wiki: a reader following an article
    // during an incident does not watch it change underneath them.
    expect(canTransition('published', 'draft')).toBe(false);
    expect(refusalReason('published', 'draft')).toMatch(/stays published while you work/);
  });

  it('will not put a retired article straight back in front of readers', () => {
    expect(canTransition('retired', 'published')).toBe(false);
    expect(refusalReason('retired', 'published')).toMatch(/draft first/);
  });

  it('says what can be done instead, rather than only that this cannot', () => {
    // "You cannot do that" is the least useful thing a content tool can say to
    // somebody who has just written something.
    const reason = refusalReason('published', 'in_review');
    expect(reason).toMatch(/can only be: retire/);
  });

  it('notices when the answer is that nothing needs doing', () => {
    expect(refusalReason('draft', 'draft')).toBe('this article is already draft');
  });

  it('offers each transition with a name a person would use', () => {
    expect(transitionsFrom('in_review').map((t) => t.label)).toEqual([
      'send back for changes',
      'approve and publish',
      'reject',
    ]);
  });
});
