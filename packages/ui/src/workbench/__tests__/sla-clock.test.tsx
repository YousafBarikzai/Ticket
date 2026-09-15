// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { SlaClock, describeRemaining } from '../SlaClock.js';

afterEach(() => cleanupDocument());

describe('reading a countdown', () => {
  it('says it the way a person would', () => {
    expect(describeRemaining(1)).toBe('1 min left');
    expect(describeRemaining(59)).toBe('59 min left');
    expect(describeRemaining(60)).toBe('1 h left');
    expect(describeRemaining(135)).toBe('2 h 15 min left');
    expect(describeRemaining(1440)).toBe('1 d left');
    expect(describeRemaining(1500)).toBe('1 d 1 h left');
  });

  it('calls nought overdue rather than counting past it', () => {
    expect(describeRemaining(0)).toBe('overdue');
    expect(describeRemaining(-30)).toBe('overdue');
  });
});

describe('showing the clock', () => {
  it('says paused, and says nothing about minutes', () => {
    const { container } = render(<SlaClock targetType="resolution" state="paused" remainingMinutes={null} />);
    const text = container.textContent ?? '';
    // MOD-07 stops the clock while a ticket waits on the requester. A paused
    // timer rendering a falling number is a lie that costs somebody an
    // afternoon.
    expect(text).toContain('Paused');
    expect(text).not.toContain('left');
  });

  it('marks a target urgent before it is late, not after', () => {
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={30} />);
    expect(container.querySelector('.itsm-SlaClock--urgent')).not.toBeNull();
    expect(container.textContent).toContain('30 min left');
  });

  it('does not announce the countdown, which would talk over everything', () => {
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={45} />);
    // A live region that updates every minute makes a screen reader unusable.
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('announces a breach once, because that is worth interrupting for', () => {
    const { container } = render(<SlaClock targetType="resolution" state="breached" remainingMinutes={null} />);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Resolution target breached');
  });

  it('names the target it belongs to, for a badge read out of context', () => {
    const { container } = render(<SlaClock targetType="fulfilment" state="met" remainingMinutes={null} />);
    expect(container.textContent).toContain('Fulfilment');
    expect(container.textContent).toContain('Met');
  });

  /**
   * The assertions above are the ones somebody thought of. This one is the
   * rule engine reading the same markup for the ones nobody did — and it runs
   * over every state at once, because a breach renders a live region the other
   * four do not.
   */
  it('passes an axe audit in every state it can be in', async () => {
    const { container } = render(
      <div>
        <SlaClock targetType="response" state="running" remainingMinutes={45} />
        <SlaClock targetType="response" state="running" remainingMinutes={5} />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} />
        <SlaClock targetType="resolution" state="breached" remainingMinutes={null} />
        <SlaClock targetType="fulfilment" state="met" remainingMinutes={null} />
      </div>,
    );
    await expectNoViolations(container);
  });
});
