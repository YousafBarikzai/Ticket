// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { AiSuggestionCard, type SuggestionEvidence } from '../AiSuggestionCard.js';

afterEach(() => cleanupDocument());

/**
 * The governance properties ADR-0006 asks for, asserted on the thing that
 * actually shows them.
 *
 * Until something renders reason, confidence and evidence, "every output is
 * explainable" is satisfied by three database columns nobody reads. These
 * tests are what make the claim true, so each one names the way the claim
 * fails rather than the element it queries.
 */
const EVIDENCE: SuggestionEvidence[] = [
  { kind: 'article', id: 'a1', title: 'Unlocking an expenses account', ref: 'KB-0012', href: '/knowledge/expenses' },
  { kind: 'ticket', id: 't1', title: 'Expenses lockout after password change', ref: 'INC-000481' },
];

function card(overrides: Partial<Parameters<typeof AiSuggestionCard>[0]> = {}) {
  return (
    <AiSuggestionCard
      capability="reply-draft"
      title="Draft a reply"
      reason="Drafted from two related records."
      confidence="high"
      evidence={EVIDENCE}
      {...overrides}
    >
      <p>Your expenses account has been unlocked.</p>
    </AiSuggestionCard>
  );
}

describe('showing a suggestion', () => {
  it('names itself as the AI, so nobody mistakes it for a colleague', () => {
    const { container } = render(card());
    const section = container.querySelector('article')!;
    expect(section.getAttribute('aria-label')).toBe('Draft a reply — suggested by AI');
  });

  it('shows the confidence as a word, never as the number the model reported', () => {
    const { container } = render(card({ confidence: 'low' }));
    const text = container.textContent ?? '';
    expect(text).toContain('Low confidence');
    // A figure calibrated against nothing, shown as `0.42`, reads as a
    // probability. That is the misreading the band exists to prevent.
    expect(text).not.toMatch(/0\.\d/);
  });

  it('shows the reason with the answer, not behind a disclosure', () => {
    const { container } = render(card());
    expect(container.querySelector('.itsm-AiSuggestion__reason')?.textContent).toContain(
      'Drafted from two related records.',
    );
  });

  it('gives every piece of evidence the reference a person would open', () => {
    const { container } = render(card());
    const refs = [...container.querySelectorAll('.itsm-AiSuggestion__evidenceRef')].map((node) => node.textContent);
    // A citation nobody can follow is a claim.
    expect(refs).toEqual(['KB-0012', 'INC-000481']);
    expect(container.querySelector('a.itsm-AiSuggestion__evidenceLink')?.getAttribute('href')).toBe('/knowledge/expenses');
  });

  it('says so in words when there is no evidence at all', () => {
    const { container } = render(card({ evidence: [] }));
    expect(container.querySelector('.itsm-AiSuggestion__evidenceList')).toBeNull();
    // An empty list reads as an oversight. "Nothing" is the most important
    // thing a person can be told about an answer.
    expect(container.textContent).toContain('Nothing in the knowledge base');
    expect(container.textContent).toContain('Check this one yourself');
  });
});

describe('deciding what to do with it', () => {
  it('offers the three outcomes as real buttons', () => {
    const { container } = render(card());
    const labels = [...container.querySelectorAll('.itsm-AiSuggestion__actions button')].map((node) => node.textContent);
    expect(labels).toEqual(['Use it', 'Edit first', 'Not useful']);
  });

  it('reports which one was chosen', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(card({ onAccept, onReject }));
    const buttons = [...container.querySelectorAll('.itsm-AiSuggestion__actions button')];
    click(buttons[0]!);
    click(buttons[2]!);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('takes the actions away once an outcome is recorded, and keeps the outcome', () => {
    const { container } = render(card({ outcome: 'edited' }));
    // An outcome is recorded once (MOD-09); offering the buttons again would
    // promise something the API refuses.
    expect(container.querySelector('.itsm-AiSuggestion__actions')).toBeNull();
    expect(container.querySelector('.itsm-AiSuggestion__outcome')?.textContent).toBe('Edited before sending');
    expect(container.querySelector('article')?.getAttribute('data-outcome')).toBe('edited');
  });

  it('stops a second click while the first is in flight', () => {
    const { container } = render(card({ busy: true }));
    const buttons = [...container.querySelectorAll('.itsm-AiSuggestion__actions button')] as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  /**
   * ADR-0006's governance properties are only real if a person can perceive
   * them. The tests above check the reason, the confidence and the evidence
   * are rendered; this checks they are rendered in a way that reaches somebody
   * not looking at the screen — which is the same claim, made about a different
   * reader.
   */
  it('passes an axe audit, offered and decided', async () => {
    const { container } = render(
      <div>
        {card()}
        {card({ outcome: 'edited' })}
        {card({ busy: true })}
      </div>,
    );
    await expectNoViolations(container);
  });
});
