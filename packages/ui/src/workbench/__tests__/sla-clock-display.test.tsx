// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { SLA_STATE_LOOK } from '../../display/ticket-states.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { SlaClock, describeSlaChip, type SlaChipInput } from '../SlaClock.js';

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * The redesign's additions to the SLA clock (v2 SPEC §4.8, v3 A6 §5.6 and
 * SPEC §6.6): four ways to show it, a ring of time used for the ticket
 * header, the `chip` for rows and cards, D5's tones, and a countdown that
 * ticks on the page's shared clock — a `timer`, never a live region, whose
 * words are spoken in full. (`sla-clock.test.tsx` keeps the original
 * contract.)
 */

/** What the eye reads: the text outside the visually hidden sentence. */
function visible(element: Element | null | undefined): string {
  if (!element) return '';
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('.itsm-visually-hidden')) hidden.remove();
  return copy.textContent ?? '';
}

/** What a screen reader reads: the visually hidden sentence. */
function spoken(element: Element | null | undefined): string {
  return element?.querySelector(':scope > .itsm-visually-hidden')?.textContent ?? '';
}

/** Live regions that would speak on their own; a `timer` is `aria-live="off"`. */
const speaking = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'));

describe('display', () => {
  it('shows the reading as one quiet line of text, with an icon only when it matters', () => {
    const { container } = render(<SlaClock targetType="resolution" state="running" remainingMinutes={130} display="text" />);
    const clock = container.querySelector('.itsm-SlaClock')!;
    expect(clock.getAttribute('data-display')).toBe('text');
    expect(visible(clock)).toBe('Resolution2 h 10 min left');
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

  it('is never a live region in any display: each is a timer, read when reached', () => {
    const { container } = render(
      <div>
        {(['badge', 'text', 'ring', 'chip'] as const).map((display) => (
          <SlaClock key={display} targetType="response" state="running" remainingMinutes={5} totalMinutes={60} display={display} />
        ))}
      </div>,
    );
    expect(speaking(container)).toEqual([]);
    const timers = [...container.querySelectorAll('.itsm-SlaClock')];
    expect(timers.map((timer) => [timer.getAttribute('role'), timer.getAttribute('aria-live')])).toEqual([
      ['timer', 'off'],
      ['timer', 'off'],
      ['timer', 'off'],
      ['timer', 'off'],
    ]);
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
    expect(speaking(container)).toEqual([]);
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

/* ----------------------------------------------------------------- v3 */

/** 10:00 in London (BST) on 2 October 2026. */
const NOW = Date.parse('2026-10-02T09:00:00Z');
const MIN = 60_000;
const at = (offsetMinutes: number): string => new Date(NOW + offsetMinutes * MIN).toISOString();
const base: SlaChipInput = { state: 'running', remaining: null, urgentBelowMinutes: 60, now: NOW, locale: 'en-GB', timeZone: 'Europe/London' };

describe('the chip (v3 copy register: "Breached 1 d ago", "Due in 40 min", "Due 16:30", "SLA paused")', () => {
  it.each([
    ['a day and three hours', 27 * 60, 'Breached 1 d ago', 'breached 1 day ago'],
    ['three hours and forty minutes', 220, 'Breached 3 h ago', 'breached 3 hours ago'],
    ['forty minutes', 40, 'Breached 40 min ago', 'breached 40 minutes ago'],
    ['twenty seconds', 1 / 3, 'Breached just now', 'breached just now'],
  ])('says how long ago a target was breached: %s', (_, minutesAgo, text, said) => {
    const chip = describeSlaChip({ ...base, state: 'breached', breachedAt: at(-minutesAgo) });
    expect([chip.key, chip.tone, chip.icon, chip.text, chip.spoken]).toEqual(['breached', 'danger', 'circle-alert', text, said]);
  });

  it('never rounds "ago" up: 47 hours is one day, not two', () => {
    expect(describeSlaChip({ ...base, state: 'breached', breachedAt: at(-47 * 60) }).text).toBe('Breached 1 d ago');
  });

  it('says "Breached" alone when it cannot know when, or has no clock to read yet', () => {
    expect(describeSlaChip({ ...base, state: 'breached' }).text).toBe('Breached');
    expect(describeSlaChip({ ...base, state: 'breached', breachedAt: at(-90), now: null }).text).toBe('Breached');
  });

  it('treats a running clock past its due time as breached, timed from when it fell due', () => {
    const chip = describeSlaChip({ ...base, remaining: -5, dueAt: at(-5) });
    expect([chip.key, chip.tone, chip.text]).toEqual(['breached', 'danger', 'Breached 5 min ago']);
  });

  it('counts down within the hour, in amber with a clock: the only warning look', () => {
    const chip = describeSlaChip({ ...base, remaining: 40, dueAt: at(40) });
    expect([chip.key, chip.tone, chip.icon, chip.text, chip.spoken]).toEqual(['due_soon', 'warning', 'clock', 'Due in 40 min', 'due in 40 minutes']);
    expect(describeSlaChip({ ...base, remaining: 60 }).text).toBe('Due in 1 h');
    expect(describeSlaChip({ ...base, remaining: 65, urgentBelowMinutes: 90 }).spoken).toBe('due in 1 hour 5 minutes');
  });

  it('gives the clock time later today, tomorrow\'s with the word, and a date further out — in the reader\'s zone', () => {
    const today = describeSlaChip({ ...base, remaining: 390, dueAt: '2026-10-02T15:30:00Z' });
    expect([today.key, today.tone, today.icon, today.text, today.spoken]).toEqual(['due_later', 'neutral', 'calendar', 'Due 16:30', 'due at 16:30']);
    const tomorrow = describeSlaChip({ ...base, remaining: 1380, dueAt: '2026-10-03T08:00:00Z' });
    expect([tomorrow.text, tomorrow.spoken]).toEqual(['Due tomorrow 09:00', 'due tomorrow at 09:00']);
    const later = describeSlaChip({ ...base, remaining: 4500, dueAt: '2026-10-05T14:00:00Z' });
    expect([later.text, later.spoken]).toEqual(['Due 5 Oct', 'due on 5 October']);
  });

  it('decides "today" and "tomorrow" by the reader\'s calendar, not UTC\'s', () => {
    // 23:30 in London is still 2 October in UTC; 00:30 the next morning is
    // tomorrow in London, though UTC calls both the same day.
    const chip = describeSlaChip({ ...base, now: Date.parse('2026-10-02T22:30:00Z'), remaining: 61, dueAt: '2026-10-02T23:30:00Z' });
    expect(chip.text).toBe('Due tomorrow 00:30');
    expect(describeSlaChip({ ...base, timeZone: 'UTC', now: Date.parse('2026-10-02T22:30:00Z'), remaining: 61, dueAt: '2026-10-02T23:30:00Z' }).text).toBe('Due 23:30');
  });

  it('reads against the moment the props imply until there is a clock, so the server and the browser agree', () => {
    // dueAt less the minutes left is 10:00: the same "today" as the live clock.
    expect(describeSlaChip({ ...base, now: null, remaining: 390, dueAt: '2026-10-02T15:30:00Z' }).text).toBe('Due 16:30');
    // Nothing to read against at all: the date and the time, both.
    const bare = describeSlaChip({ ...base, now: null, dueAt: '2026-10-02T15:30:00Z' });
    expect([bare.text, bare.spoken]).toEqual(['Due 2 Oct, 16:30', 'due on 2 October at 16:30']);
    expect(describeSlaChip({ ...base, now: null, remaining: 130 }).text).toBe('Due in 2 h 10 min');
  });

  it('says paused, met and on track in the D5 looks, from SLA_STATE_LOOK', () => {
    const paused = describeSlaChip({ ...base, state: 'paused', remaining: 30, dueAt: at(30) });
    expect([paused.key, paused.tone, paused.icon, paused.text, paused.spoken]).toEqual(['paused', 'hold', 'pause', 'SLA paused', 'SLA paused']);
    const met = describeSlaChip({ ...base, state: 'met' });
    expect([met.tone, met.icon, met.text]).toEqual([SLA_STATE_LOOK.met.tone, SLA_STATE_LOOK.met.icon, 'Met']);
    const onTrack = describeSlaChip(base);
    expect([onTrack.key, onTrack.tone, onTrack.text]).toEqual(['on_track', SLA_STATE_LOOK.on_track.tone, 'On track']);
    for (const key of ['breached', 'due_soon', 'paused'] as const) {
      const look = SLA_STATE_LOOK[key];
      const chip = [
        describeSlaChip({ ...base, state: 'breached' }),
        describeSlaChip({ ...base, remaining: 10 }),
        describeSlaChip({ ...base, state: 'paused' }),
      ].find((one) => one.key === key)!;
      expect([chip.tone, chip.icon]).toEqual([look.tone, look.icon]);
    }
  });

  it('renders the pill alone, a timer whose spoken sentence names the target in full', () => {
    vi.useFakeTimers({ now: NOW });
    const { container } = render(
      <SlaClock targetType="resolution" state="running" remainingMinutes={40} dueAt={at(40)} display="chip" timeZone="Europe/London" />,
    );
    const chip = container.querySelector('.itsm-SlaClock')!;
    expect(chip.tagName).toBe('SPAN');
    expect([chip.getAttribute('role'), chip.getAttribute('aria-live'), chip.getAttribute('data-sla'), chip.getAttribute('data-tone')]).toEqual([
      'timer',
      'off',
      'due_soon',
      'warning',
    ]);
    const pill = chip.querySelector('.itsm-StatusPill')!;
    expect(pill.textContent).toBe('Due in 40 min');
    expect(pill.getAttribute('aria-hidden')).toBe('true');
    expect(pill.getAttribute('data-size')).toBe('sm');
    expect(spoken(chip)).toBe('Resolution: due in 40 minutes');
    expect(chip.querySelector('.itsm-SlaClock__label')).toBeNull();
  });

  it('ticks into "Breached" on the shared clock, and never speaks unasked: a list could hold fifty', () => {
    vi.useFakeTimers({ now: NOW });
    const { container } = render(
      <SlaClock targetType="response" state="running" remainingMinutes={2} dueAt={at(2)} display="chip" timeZone="Europe/London" />,
    );
    expect(visible(container)).toBe('Due in 2 min');
    act(() => {
      vi.advanceTimersByTime(3 * MIN);
    });
    expect(visible(container)).toBe('Breached 1 min ago');
    expect(container.querySelector('.itsm-SlaClock')?.getAttribute('data-tone')).toBe('danger');
    expect(announcerText('polite')).toBe('');
    expect(speaking(container)).toEqual([]);
  });

  it('hydrates without a mismatch, saying the clock time the props imply', () => {
    const element = (
      <SlaClock targetType="resolution" state="running" remainingMinutes={390} dueAt="2026-10-02T15:30:00Z" display="chip" timeZone="Europe/London" />
    );
    const host = document.createElement('div');
    host.innerHTML = renderToString(element);
    document.body.appendChild(host);
    expect(visible(host)).toBe('Due 16:30');
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

describe('D5 tones, the full spoken reading and the breach announcement', () => {
  it('draws a paused clock in hold, the waiting colour, in every display', () => {
    const { container } = render(
      <div>
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} display="text" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={30} totalMinutes={60} display="ring" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} display="chip" />
      </div>,
    );
    const clocks = [...container.querySelectorAll('.itsm-SlaClock')];
    expect(clocks.map((clock) => clock.getAttribute('data-tone'))).toEqual(['hold', 'hold', 'hold', 'hold']);
    expect(clocks[0]!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('hold');
    expect(clocks.map((clock) => visible(clock))).toEqual(['ResolutionPaused', 'ResolutionPaused', 'ResolutionPaused', 'SLA paused']);
  });

  it('turns a running clock past its due time red with a circled "!", not amber', () => {
    const { container } = render(<SlaClock targetType="response" state="running" remainingMinutes={-3} />);
    const clock = container.querySelector('.itsm-SlaClock')!;
    expect(clock.getAttribute('data-tone')).toBe('danger');
    expect(clock.classList.contains('itsm-SlaClock--urgent')).toBe(false);
    expect(visible(clock)).toBe('First responseoverdue');
    expect(spoken(clock)).toBe('First response: overdue');
  });

  it('speaks every reading in full words, and hides the abbreviated one from the ear', () => {
    const { container } = render(
      <div>
        <SlaClock targetType="resolution" state="running" remainingMinutes={130} display="text" />
        <SlaClock targetType="response" state="running" remainingMinutes={45} />
        <SlaClock targetType="resolution" state="running" remainingMinutes={1500} totalMinutes={2880} display="ring" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} />
        <SlaClock targetType="fulfilment" state="met" remainingMinutes={null} />
        <SlaClock targetType="resolution" state="breached" remainingMinutes={null} />
        <SlaClock targetType="custom_target" state="running" remainingMinutes={null} />
      </div>,
    );
    const clocks = [...container.querySelectorAll('.itsm-SlaClock')];
    expect(clocks.map((clock) => spoken(clock))).toEqual([
      'Resolution: 2 hours 10 minutes left',
      'First response: due soon, 45 minutes left',
      'Resolution: 1 day 1 hour left',
      'Resolution: SLA paused',
      'Fulfilment: met',
      'Resolution: breached',
      'custom_target: running',
    ]);
    for (const hidden of container.querySelectorAll('.itsm-SlaClock__label, .itsm-SlaClock__reading, .itsm-SlaClock__stack, .itsm-SlaClock__pill')) {
      expect(hidden.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // The ring stays an image with its own name: the share used is not in the sentence.
    expect(container.querySelector('.itsm-ProgressRing')?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('says a breach once when a running clock reaches nought on screen, not again when the server catches up', () => {
    vi.useFakeTimers({ now: NOW });
    const { rerender } = render(<SlaClock targetType="response" state="running" remainingMinutes={1} dueAt={at(1)} display="text" />);
    act(() => {
      vi.advanceTimersByTime(2 * MIN);
    });
    // The announcer fills its region on the next task, so a repeat is a change.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe('First response target breached');
    destroyAnnouncer();
    rerender(<SlaClock targetType="response" state="breached" remainingMinutes={null} display="text" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe('');
  });
});

describe('ring sizes (A6 §5.6: 28 px condensed, 44 px SLA block)', () => {
  it('marks the size and draws from the nearest ring, scaled by the stylesheet', () => {
    const { container } = render(
      <div>
        <SlaClock targetType="resolution" state="running" remainingMinutes={30} totalMinutes={120} display="ring" ringSize="sm" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={30} totalMinutes={120} display="ring" ringSize="lg" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={30} totalMinutes={120} display="ring" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={30} display="ring" ringSize="lg" />
      </div>,
    );
    const clocks = [...container.querySelectorAll('.itsm-SlaClock')];
    expect(clocks.map((clock) => clock.getAttribute('data-ring-size'))).toEqual(['sm', 'lg', null, null]);
    expect(clocks.map((clock) => clock.querySelector('.itsm-ProgressRing')?.getAttribute('data-size') ?? null)).toEqual(['32', '48', '32', null]);
  });

  it('carries the 28 and 44 px rules and the hold arc', async () => {
    const { slaClockStyles } = await import('../SlaClock.styles.js');
    const css = String(slaClockStyles);
    expect(css).toMatch(/\[data-ring-size="sm"\] \.itsm-SlaClock__ring \{\s*inline-size: 28px;\s*block-size: 28px;/);
    expect(css).toMatch(/\[data-ring-size="lg"\] \.itsm-SlaClock__ring \{\s*inline-size: 44px;\s*block-size: 44px;/);
    expect(css).toMatch(/\[data-tone="hold"\] \.itsm-SlaClock__ring \{\s*--_itsm-ring: var\(--itsm-colour-hold-border\);/);
  });
});

describe('v3 audit', () => {
  it('passes axe for every chip state and both ring sizes', async () => {
    vi.useFakeTimers({ now: NOW });
    const { container } = render(
      <div>
        <SlaClock targetType="resolution" state="breached" remainingMinutes={null} breachedAt={at(-27 * 60)} display="chip" />
        <SlaClock targetType="response" state="running" remainingMinutes={40} dueAt={at(40)} display="chip" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={390} dueAt={at(390)} display="chip" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={null} display="chip" />
        <SlaClock targetType="fulfilment" state="met" remainingMinutes={null} display="chip" />
        <SlaClock targetType="resolution" state="running" remainingMinutes={30} totalMinutes={120} display="ring" ringSize="sm" />
        <SlaClock targetType="resolution" state="paused" remainingMinutes={30} totalMinutes={120} display="ring" ringSize="lg" />
      </div>,
    );
    vi.useRealTimers();
    await expectNoViolations(container);
  });
});
