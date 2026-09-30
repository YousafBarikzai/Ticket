// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { SlaClock } from '../SlaClock.js';

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * The redesign's additions to the SLA clock (SPEC §4.8): three ways to show
 * it, a ring of time used for the ticket header, and a countdown that ticks
 * on the page's shared clock — all without ever becoming a live region.
 * (`sla-clock.test.tsx` keeps the original contract, unchanged.)
 */

describe('display', () => {
  it('shows the reading as one quiet line of text, with an icon only when it matters', () => {
    const { container } = render(<SlaClock targetType="resolution" state="running" remainingMinutes={130} display="text" />);
    const clock = container.querySelector('.itsm-SlaClock')!;
    expect(clock.getAttribute('data-display')).toBe('text');
    expect(clock.textContent).toBe('Resolution2 h 10 min left');
    expect(clock.querySelector('svg')).toBeNull();
  });

  it('marks an urgent or stopped clock with an icon in the text display', () => {
    const { container } = render(
      <div>
        <SlaClock targetType="response" state="running" remainingMinutes={20} display="text" />
        <SlaClock targetType="response" state="paused" remainingMinutes={null} display="text" />
      </div>,
    );
    const [urgent, paused] = [...container.querySelectorAll('.itsm-SlaClock')];
    expect(urgent!.classList.contains('itsm-SlaClock--urgent')).toBe(true);
    expect(urgent!.getAttribute('data-tone')).toBe('warning');
    expect(urgent!.querySelector('svg')).not.toBeNull();
    expect(paused!.querySelector('svg')).not.toBeNull();
    expect(paused!.textContent).not.toContain('left');
  });

  it('draws the share of the target used as a ring named with its value', () => {
    const { container } = render(<SlaClock targetType="resolution" state="running" remainingMinutes={120} totalMinutes={480} display="ring" />);
    const ring = container.querySelector('.itsm-ProgressRing')!;
    expect(ring.getAttribute('role')).toBe('img');
    expect(ring.getAttribute('aria-label')).toBe('Resolution, time used: 75%');
    expect(ring.getAttribute('data-tone')).toBe('accent');
    expect(container.textContent).toContain('2 h left');
  });

  it('fills the ring and turns it red once breached, green once met', () => {
    const { container } = render(
      <div>
        <SlaClock targetType="resolution" state="breached" remainingMinutes={null} totalMinutes={480} display="ring" />
        <SlaClock targetType="resolution" state="met" remainingMinutes={null} totalMinutes={480} display="ring" />
      </div>,
    );
    const rings = [...container.querySelectorAll('.itsm-ProgressRing')];
    expect(rings.map((ring) => ring.getAttribute('data-tone'))).toEqual(['danger', 'success']);
    expect(rings.map((ring) => ring.getAttribute('aria-label'))).toEqual(['Resolution, time used: 100%', 'Resolution, time used: 100%']);
  });

  it('reads as text when a ring has nothing to measure against', () => {
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={45} display="ring" />);
    expect(container.querySelector('.itsm-ProgressRing')).toBeNull();
    expect(container.querySelector('.itsm-SlaClock')?.getAttribute('data-display')).toBe('text');
    expect(container.textContent).toContain('45 min left');
  });

  it('keeps the badge as the default, a status pill beside the label', () => {
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={45} />);
    expect(container.querySelector('.itsm-SlaClock')?.getAttribute('data-display')).toBe('badge');
    expect(container.querySelector('.itsm-StatusPill')?.textContent).toContain('45 min left');
  });

  it('is never a live region in any display; only a breach speaks, once', () => {
    const { container } = render(
      <div>
        {(['badge', 'text', 'ring'] as const).map((display) => (
          <SlaClock key={display} targetType="response" state="running" remainingMinutes={5} totalMinutes={60} display={display} />
        ))}
      </div>,
    );
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe('ticking', () => {
  it('counts down on the shared clock from the minutes it was given', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T10:00:00Z') });
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={30} />);
    expect(container.textContent).toContain('30 min left');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(container.textContent).toContain('29 min left');
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(container.textContent).toContain('24 min left');
    // Still not a live region, however often it moves.
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('starts over from a new figure the server sends', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T10:00:00Z') });
    const { container, rerender } = render(<SlaClock targetType="response" state="running" remainingMinutes={30} />);
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(container.textContent).toContain('27 min left');
    rerender(<SlaClock targetType="response" state="running" remainingMinutes={40} />);
    expect(container.textContent).toContain('40 min left');
  });

  it('counts down to the real due time when it has one, and turns urgent on the way', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T10:00:00Z') });
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={62} dueAt="2026-09-30T11:02:00Z" />);
    expect(container.textContent).toContain('1 h 2 min left');
    expect(container.querySelector('.itsm-SlaClock--urgent')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(container.textContent).toContain('59 min left');
    expect(container.querySelector('.itsm-SlaClock--urgent')).not.toBeNull();
  });

  it('does not tick a paused clock', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T10:00:00Z') });
    const { container } = render(<SlaClock targetType="response" state="paused" remainingMinutes={30} />);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(container.textContent).toContain('Paused');
    expect(container.textContent).not.toContain('left');
  });

  it('hydrates without a mismatch: the first browser render shows the minutes as given', () => {
    const element = <SlaClock targetType="response" state="running" remainingMinutes={30} dueAt="2026-09-30T11:02:00Z" display="text" />;
    const host = document.createElement('div');
    host.innerHTML = renderToString(element);
    document.body.appendChild(host);
    expect(host.textContent).toContain('30 min left');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(host, element, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    act(() => root!.unmount());
  });
});

describe('audit', () => {
  it('passes axe in every display and state', async () => {
    const { container } = render(
      <div>
        <SlaClock targetType="response" state="running" remainingMinutes={130} display="text" />
        <SlaClock targetType="response" state="running" remainingMinutes={5} display="text" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} display="text" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={120} totalMinutes={480} display="ring" />
        <SlaClock targetType="resolution" state="breached" remainingMinutes={null} totalMinutes={480} display="ring" />
        <SlaClock targetType="fulfilment" state="met" remainingMinutes={null} display="badge" />
      </div>,
    );
    await expectNoViolations(container);
  });
});
