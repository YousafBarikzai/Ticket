// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { tooltipStyles } from '../../web/Tooltip.styles.js';
import { Tooltip } from '../../web/Tooltip.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, pointerEnter, press, render, settle } from '../../web/__tests__/support/render.js';
import { Popover } from '../Popover.js';
import { SplitButton } from '../SplitButton.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

describe('Popover', () => {
  it('opens from its trigger as a dialog named by its title, and gives focus back on Escape', async () => {
    render(
      <Popover title="View only" trigger={<button type="button">View only</button>}>
        <p>You need the Rules permission to change this.</p>
      </Popover>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    focus(trigger);
    click(trigger);
    await settle();
    const popover = document.querySelector<HTMLElement>('.itsm-Popover')!;
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(popover.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('View only');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    press(activeElement()!, 'Escape');
    await settle();
    expect(document.querySelector('.itsm-Popover')).toBeNull();
    expect(activeElement()).toBe(trigger);
  });

  it('is named by its trigger when it has no title', async () => {
    render(
      <Popover trigger={<button type="button">Why?</button>}>
        <p>Set by the service catalogue.</p>
      </Popover>,
    );
    click(document.querySelector('button')!);
    await settle();
    const popover = document.querySelector<HTMLElement>('.itsm-Popover')!;
    expect(document.getElementById(popover.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Why?');
  });

  it('closes on a press outside', async () => {
    render(
      <div>
        <button type="button" id="outside">
          Elsewhere
        </button>
        <Popover trigger={<button type="button">Why?</button>}>
          <p>Because.</p>
        </Popover>
      </div>,
    );
    click([...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Why?')!);
    await settle();
    // A whole press: Radix waits for the click, so a drag that starts outside is not a dismissal.
    const outside = document.querySelector('#outside')!;
    pointerDown(outside);
    click(outside);
    await settle();
    expect(document.querySelector('.itsm-Popover')).toBeNull();
  });
});

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const bubble = (): HTMLElement | null => document.querySelector<HTMLElement>('.itsm-Tooltip__content');
  const advance = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it('shows after 500 ms of hover and describes its trigger while up', () => {
    render(
      <Tooltip content="Copy the ticket link" shortcut="mod+shift+c">
        <button type="button">Copy</button>
      </Tooltip>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    pointerEnter(trigger);
    advance(400);
    expect(bubble()).toBeNull();
    advance(200);
    expect(bubble()?.textContent).toContain('Copy the ticket link');
    const tooltip = document.querySelector('[role="tooltip"]')!;
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('shows at once on a keyboard focus, but not when the page moves focus', () => {
    render(
      <Tooltip content="Pin to sidebar">
        <button type="button">Pin</button>
      </Tooltip>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    focus(trigger);
    advance(600);
    expect(bubble()).toBeNull();
    act(() => trigger.blur());

    press(document.body, 'Tab');
    focus(trigger);
    advance(10);
    expect(bubble()).not.toBeNull();
  });

  it('is dismissed by Escape without moving focus (WCAG 1.4.13)', () => {
    render(
      <Tooltip content="Pin to sidebar">
        <button type="button">Pin</button>
      </Tooltip>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    press(document.body, 'Tab');
    focus(trigger);
    advance(10);
    expect(bubble()).not.toBeNull();
    press(trigger, 'Escape');
    advance(300);
    expect(bubble()).toBeNull();
    expect(activeElement()).toBe(trigger);
  });

  it('is the v3 bubble: inverse slate, radius 8, at most 240 px, with the shortcut caps inside it', () => {
    const bubbleRule = tooltipStyles.match(/\.itsm-Tooltip__content \{([^}]*)\}/)![1]!;
    expect(bubbleRule).toContain('background: var(--itsm-colour-surface-inverse);');
    expect(bubbleRule).toContain('color: var(--itsm-colour-text-inverse);');
    expect(bubbleRule).toContain('border-radius: var(--itsm-radius-md);');
    expect(bubbleRule).toContain('max-inline-size: min(15rem, calc(100vw - 2 * var(--itsm-space-xs)));');
    expect(bubbleRule).toContain('font-size: var(--itsm-text-footnote-size);');
    render(
      <Tooltip content="Copy the ticket link" shortcut="mod+shift+c">
        <button type="button">Copy</button>
      </Tooltip>,
    );
    press(document.body, 'Tab');
    focus(document.querySelector<HTMLButtonElement>('button')!);
    advance(10);
    // The caps sit in the bubble, where the key-cap stylesheet draws them from its text colour.
    expect(bubble()?.querySelector('.itsm-Kbd')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names an icon-only control up front with asLabel, instead of describing it', () => {
    render(
      <Tooltip content="Pin" asLabel>
        <button type="button">★</button>
      </Tooltip>,
    );
    expect(document.querySelector('button')!.getAttribute('aria-label')).toBe('Pin');
  });

  it('is off where the provider turns tooltips off (the portal)', () => {
    render(
      <TestProvider app="portal">
        <Tooltip content="Copy">
          <button type="button">Copy</button>
        </Tooltip>
      </TestProvider>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    pointerEnter(trigger);
    advance(1000);
    expect(bubble()).toBeNull();
  });
});

describe('SplitButton', () => {
  it('is a main action and a chevron named for it, and only the main one submits', async () => {
    const onPrimary = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form>
        <SplitButton
          type="submit"
          primary={{ id: 'send', label: 'Send' }}
          onPrimary={onPrimary}
          items={[{ id: 'resolve', label: 'Send and resolve' }]}
        />
      </form>,
    );
    document.querySelector('form')!.addEventListener('submit', onSubmit);
    const [main, more] = [...document.querySelectorAll<HTMLButtonElement>('button')];
    expect(main!.type).toBe('submit');
    expect(more!.type).toBe('button');
    expect(more!.getAttribute('aria-label')).toBe('More options for Send');
    expect(more!.getAttribute('aria-haspopup')).toBe('menu');

    click(main!);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    focus(more!);
    press(more!, 'Enter');
    await settle();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Send and resolve');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('asks first when the main action carries a confirmation', async () => {
    const onPrimary = vi.fn();
    render(
      <SplitButton
        primary={{ id: 'close', label: 'Close tickets', confirm: { title: 'Close 12 tickets?', confirmLabel: 'Close tickets', tone: 'danger' } }}
        onPrimary={onPrimary}
        items={[]}
      />,
    );
    click(document.querySelector<HTMLButtonElement>('.itsm-SplitButton__main')!);
    expect(onPrimary).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Close 12 tickets?');
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Close tickets')!;
    click(confirm);
    await settle();
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('shows the main action busy without losing its name, and swallows presses meanwhile', () => {
    const onPrimary = vi.fn();
    render(<SplitButton primary={{ id: 'send', label: 'Send' }} onPrimary={onPrimary} loading loadingLabel="Sending…" items={[{ id: 'later', label: 'Send later' }]} />);
    const main = document.querySelector<HTMLButtonElement>('.itsm-SplitButton__main')!;
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(main.textContent).toContain('Send');
    expect(main.textContent).toContain('Sending…');
    click(main);
    expect(onPrimary).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('.itsm-SplitButton__more')!.disabled).toBe(true);
  });

  it('disables its alternatives with the main action when asked', () => {
    render(<SplitButton primary={{ id: 'send', label: 'Send', disabled: true }} menuDisabled menuOpen items={[{ id: 'later', label: 'Send later' }]} />);
    expect(document.querySelector<HTMLButtonElement>('.itsm-SplitButton__main')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.itsm-SplitButton__more')!.disabled).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens its menu when the caller says so (a shortcut), and reports closing', async () => {
    const onMenuOpenChange = vi.fn();
    const { rerender } = render(
      <SplitButton primary={{ id: 'send', label: 'Send' }} items={[{ id: 'resolve', label: 'Send and resolve' }]} menuOpen={false} onMenuOpenChange={onMenuOpenChange} />,
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    rerender(<SplitButton primary={{ id: 'send', label: 'Send' }} items={[{ id: 'resolve', label: 'Send and resolve' }]} menuOpen onMenuOpenChange={onMenuOpenChange} />);
    await settle();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Send and resolve');
    press(activeElement()!, 'Escape');
    await settle();
    expect(onMenuOpenChange).toHaveBeenCalledWith(false);
  });
});
