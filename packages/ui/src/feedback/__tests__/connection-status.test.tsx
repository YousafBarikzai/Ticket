// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { cleanupDocument, click, press, render } from '../../web/__tests__/support/render.js';
import { ConnectionStatus, summariseConnection, type ConnectionAttentionItem, type ConnectionStatusProps } from '../ConnectionStatus.js';

/*
 * ConnectionStatus (SPEC §4.5, X-82, X-51): nothing at all when healthy — and
 * healthy includes "nothing needs the person" — otherwise a pill that opens a
 * tray, with focus on the first failed write.
 */

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.useRealTimers();
});

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const failed: ConnectionAttentionItem = { id: 'q1', summary: 'Reply on INC-000123', problem: 'The ticket was closed.', state: 'failed' };
const conflict: ConnectionAttentionItem = { id: 'q2', summary: 'Approval for REQ-000046', state: 'conflict' };

function props(overrides: Partial<ConnectionStatusProps> = {}): ConnectionStatusProps {
  return { state: 'live', pending: 0, attention: [], onRetry: vi.fn(), onDiscard: vi.fn(), ...overrides };
}

const pill = (root: ParentNode): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.itsm-ConnectionStatus__pill')!;
const tray = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

describe('summariseConnection', () => {
  it.each([
    ['live', 0, 0, ''],
    ['live', 3, 0, 'Sending 3…'],
    ['offline', 0, 0, 'Offline'],
    ['offline', 2, 0, 'Offline · 2 waiting'],
    ['reconnecting', 0, 0, 'Reconnecting…'],
    ['ended', 0, 0, 'Session ended'],
    ['ended', 1, 0, 'Session ended · 1 waiting'],
    ['live', 0, 1, "1 didn't send"],
    ['offline', 4, 2, "Offline · 2 didn't send"],
  ] as const)('%s with %i waiting and %i needing the person reads "%s"', (state, pending, attention, label) => {
    const summary = summariseConnection(state, pending, attention);
    expect(summary.healthy).toBe(label === '');
    if (label) expect(summary.label).toBe(label);
  });

  it('is healthy only when live, with nothing waiting and nothing failed', () => {
    expect(summariseConnection('live', 0, 0).healthy).toBe(true);
    expect(summariseConnection('live', 0, 1).healthy).toBe(false);
    expect(summariseConnection('live', 1, 0).healthy).toBe(false);
    expect(summariseConnection('reconnecting', 0, 0).healthy).toBe(false);
  });

  it('tints a failure red and an ended session amber', () => {
    expect(summariseConnection('live', 0, 1).tone).toBe('danger');
    expect(summariseConnection('ended', 0, 0).tone).toBe('warning');
    expect(summariseConnection('offline', 0, 0).tone).toBe('neutral');
  });
});

describe('ConnectionStatus', () => {
  it('renders nothing at all when healthy', () => {
    const { container } = render(<ConnectionStatus {...props()} />);
    expect(container.innerHTML).toBe('');
  });

  it('still shows the pill when online but a write failed — that is the one thing the person must act on', () => {
    const { container } = render(<ConnectionStatus {...props({ attention: [failed] })} />);
    expect(text(pill(container))).toBe("Connection: 1 didn't send");
    expect(container.querySelector('.itsm-ConnectionStatus')?.getAttribute('data-tone')).toBe('danger');
  });

  it('is a button that says it opens a dialog, and is not itself a live region', () => {
    const { container } = render(<ConnectionStatus {...props({ state: 'offline', pending: 2 })} />);
    const button = pill(container);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(container.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(text(button)).toBe('Connection: Offline · 2 waiting');
  });

  it('opens the tray with focus on the first failed item, and wires the dialog to the pill', () => {
    const { container } = render(<ConnectionStatus {...props({ state: 'offline', pending: 1, attention: [failed, conflict] })} />);
    click(pill(container));
    const dialog = tray();
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('false');
    expect(pill(container).getAttribute('aria-expanded')).toBe('true');
    expect(pill(container).getAttribute('aria-controls')).toBe(dialog?.id);
    expect(text(document.getElementById(dialog!.getAttribute('aria-labelledby')!))).toBe("You're offline");
    expect(text(dialog)).toContain('1 change waiting to send');
    expect(document.activeElement?.textContent).toBe('Try again: Reply on INC-000123');
    expect(text(dialog)).toContain('Someone else changed this first.');
  });

  it('retries and discards by id, with each button named for its item', () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const { container } = render(<ConnectionStatus {...props({ attention: [failed, conflict], onRetry, onDiscard })} />);
    click(pill(container));
    const named = (name: string): HTMLButtonElement =>
      Array.from(tray()!.querySelectorAll('button')).find((button) => button.textContent === name)!;
    click(named('Try again: Approval for REQ-000046'));
    click(named('Discard: Reply on INC-000123'));
    expect(onRetry).toHaveBeenCalledWith('q2');
    expect(onDiscard).toHaveBeenCalledWith('q1');
  });

  it('moves focus to the next item when the focused one leaves the list', () => {
    const onDiscard = vi.fn();
    const view = render(<ConnectionStatus {...props({ attention: [failed, conflict], onDiscard })} />);
    click(pill(view.container));
    const discard = Array.from(tray()!.querySelectorAll('button')).find((b) => b.textContent === 'Discard: Reply on INC-000123')!;
    discard.focus();
    click(discard);
    view.rerender(<ConnectionStatus {...props({ attention: [conflict], onDiscard })} />);
    expect(document.activeElement?.textContent).toBe('Try again: Approval for REQ-000046');
  });

  it('closes on Escape and returns focus to the pill, without letting Escape reach an enclosing layer', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    try {
      const { container } = render(<ConnectionStatus {...props({ state: 'reconnecting' })} />);
      click(pill(container));
      expect(tray()).not.toBeNull();
      press(document.activeElement!, 'Escape');
      expect(tray()).toBeNull();
      expect(document.activeElement).toBe(pill(container));
      expect(outer).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outer);
    }
  });

  it('closes on a press outside, leaving focus where the press landed', () => {
    const { container } = render(
      <div>
        <ConnectionStatus {...props({ state: 'offline' })} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    click(pill(container));
    const elsewhere = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Elsewhere')!;
    act(() => {
      elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(tray()).toBeNull();
  });

  it('offers Sign in again when the session has ended, and focuses it when nothing failed', () => {
    const onSignIn = vi.fn();
    const { container } = render(<ConnectionStatus {...props({ state: 'ended', onSignIn })} />);
    click(pill(container));
    expect(text(tray())).toContain('Your session ended');
    expect(document.activeElement?.textContent).toBe('Sign in again');
    click(document.activeElement!);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('stays open as the last item is sent, says so, and hides once closed', () => {
    const view = render(
      <div>
        <ConnectionStatus {...props({ attention: [failed] })} />
        <a href="/next">Next thing</a>
      </div>,
    );
    click(pill(view.container));
    view.rerender(
      <div>
        <ConnectionStatus {...props({ attention: [] })} />
        <a href="/next">Next thing</a>
      </div>,
    );
    expect(text(tray())).toContain("Everything's sent");
    press(tray()!, 'Escape');
    expect(view.container.querySelector('.itsm-ConnectionStatus')).toBeNull();
    // Not stranded on <body>: focus went to what follows the pill.
    expect(document.activeElement?.textContent).toBe('Next thing');
  });

  it('announces the changes that matter, once, and nothing on the first render', () => {
    vi.useFakeTimers();
    const view = render(<ConnectionStatus {...props({ state: 'offline', pending: 1 })} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe('');

    view.rerender(<ConnectionStatus {...props({ state: 'live', pending: 1 })} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe('Back online. Sending 1 change.');

    view.rerender(<ConnectionStatus {...props({ state: 'live', pending: 0, attention: [failed] })} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe("1 change didn't send.");

    view.rerender(<ConnectionStatus {...props({ state: 'offline', attention: [failed] })} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toContain("You're offline.");
  });
});
