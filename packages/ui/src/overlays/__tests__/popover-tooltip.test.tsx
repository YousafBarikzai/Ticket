// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import { structuralVariables, themeVariables } from '../../tokens/css.js';
import { commandPaletteStyles } from '../../web/CommandPalette.styles.js';
import { dialogStyles } from '../../web/Dialog.styles.js';
import { tooltipStyles } from '../../web/Tooltip.styles.js';
import { Tooltip } from '../../web/Tooltip.js';
import { confirmDialogStyles } from '../ConfirmDialog.styles.js';
import { contextMenuStyles } from '../ContextMenu.styles.js';
import { menuStyles } from '../Menu.styles.js';
import { styleRegistry } from '../../styles/registry.js';
import { popoverStyles } from '../Popover.styles.js';
import { sheetStyles } from '../Sheet.styles.js';
import { toasterStyles } from '../Toaster.styles.js';
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

/* -------------------------------------------------------------------------
 * The v3 overlay restyles (§2.9, §2.14, §2.15; A1 §7.16, §7.17): radii 12
 * for things that float beside their trigger, 16 for things that take the
 * screen; the long soft elevations; the slate scrim; no squircles.
 * ---------------------------------------------------------------------- */

describe('v3 overlay restyles', () => {
  /** One rule of a stylesheet, by its exact selector at the start of a line. */
  const rule = (css: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('sizes the radii the overlays use: xl 12, 3xl 16, sm 6', () => {
    const vars = structuralVariables();
    expect(vars['--itsm-radius-xl']).toBe('0.75rem');
    expect(vars['--itsm-radius-3xl']).toBe('1rem');
    expect(vars['--itsm-radius-sm']).toBe('0.375rem');
  });

  it('dims the page behind dialogs and sheets with the slate scrim', () => {
    expect(themeVariables('apple')['--itsm-colour-scrim']).toBe('rgba(15, 23, 42, 0.4)');
    for (const [css, scrim] of [
      [dialogStyles, '.itsm-Dialog__scrim'],
      [sheetStyles, '.itsm-Sheet__scrim'],
      [commandPaletteStyles, '.itsm-CommandPalette__scrim'],
    ] as const) {
      expect(rule(css, scrim), scrim).toContain('background: var(--itsm-colour-scrim);');
    }
  });

  it('menus and context menus: radius 12, 6 px padding, a 1 px border.subtle, elevation md', () => {
    const content = rule(menuStyles, '.itsm-Menu__content');
    expect(content).toContain('border-radius: var(--itsm-radius-xl);');
    expect(content).toContain('padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));');
    expect(content).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);');
    expect(content).toContain('box-shadow: var(--itsm-elevation-md)');
    // A context menu draws with the menu's classes; only its origin is its own.
    expect(contextMenuStyles).not.toContain('border-radius');
    expect(contextMenuStyles).not.toContain('box-shadow');
  });

  it('menu items: 34 px, radius 6, 500 13/20 text.secondary, muted icons; section heads 600 12/16 muted; divider separators', () => {
    const item = rule(menuStyles, '.itsm-Menu__item');
    expect(item).toContain('min-block-size: calc(var(--itsm-nav-item-height) - var(--itsm-space-3xs));');
    expect(item).toContain('border-radius: var(--itsm-radius-sm);');
    expect(item).toContain('color: var(--itsm-colour-text-secondary);');
    expect(item).toContain('font-weight: var(--itsm-font-weight-medium);');
    expect(rule(menuStyles, '.itsm-Menu__item[data-highlighted]')).toContain('color: var(--itsm-colour-text-primary);');
    expect(rule(menuStyles, '.itsm-Menu__leading')).toContain('color: var(--itsm-colour-text-muted);');
    const heading = rule(menuStyles, '.itsm-Menu__heading');
    expect(heading).toContain('font-size: var(--itsm-text-footnote-size);');
    expect(heading).toContain('font-weight: var(--itsm-font-weight-semibold);');
    expect(heading).toContain('color: var(--itsm-colour-text-muted);');
    expect(rule(menuStyles, '.itsm-Menu__separator')).toContain('background: var(--itsm-colour-border-divider);');
    // The item's detail line and the current choice's check live with the menu.
    expect(rule(menuStyles, '.itsm-Menu__detail')).toContain('color: var(--itsm-colour-text-secondary);');
    expect(rule(menuStyles, '.itsm-Menu__current')).toContain('color: var(--itsm-colour-accent);');
    // Only there: the area switcher's interim copies are gone, so a change here is the only change.
    for (const name of ['.itsm-Menu__detail {', '.itsm-Menu__current {']) {
      expect(styleRegistry.filter((entry) => entry.css.includes(name)).map((entry) => entry.module), name).toEqual(['overlays/Menu.styles.ts']);
    }
  });

  it('popovers: the menu’s surface, with room for free content', () => {
    const popover = rule(popoverStyles, '.itsm-Popover');
    expect(popover).toContain('border-radius: var(--itsm-radius-xl);');
    expect(popover).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);');
    expect(popover).toContain('box-shadow: var(--itsm-elevation-md)');
  });

  it('dialogs: radius 16, elevation xl, padding 28 28 24, a title2 title, the 34 px close 12 px from the corner', () => {
    const dialog = rule(dialogStyles, '.itsm-Dialog');
    expect(dialog).toContain('border-radius: var(--itsm-radius-3xl);');
    expect(dialog).toContain('box-shadow: var(--itsm-elevation-xl)');
    expect(dialog).toContain('--_pad: calc(var(--itsm-space-lg) + var(--itsm-space-2xs));');
    expect(rule(dialogStyles, '.itsm-Dialog__header')).toMatch(/padding: var\(--_pad\) .+ var\(--itsm-space-sm\) var\(--_pad\);/);
    expect(rule(dialogStyles, '.itsm-Dialog__body')).toContain('padding: var(--itsm-space-xs) var(--_pad) var(--itsm-space-lg);');
    expect(rule(dialogStyles, '.itsm-Dialog__title')).toContain('font-size: var(--itsm-text-title2-size);');
    const close = rule(dialogStyles, '.itsm-Dialog__close');
    expect(close).toContain('inset-block-start: var(--itsm-space-sm);');
    expect(close).toContain('inset-inline-end: var(--itsm-space-sm);');
    expect(close).toContain('inline-size: var(--_close);');
    expect(dialog).toContain('--_close: 2.125rem;');
  });

  it('sheets and the palette: radius 16, elevation xl; no squircle on anything that floats', () => {
    expect(rule(sheetStyles, '.itsm-Sheet')).toContain('border-radius: var(--itsm-radius-3xl);');
    expect(rule(sheetStyles, '.itsm-Sheet')).toContain('box-shadow: var(--itsm-elevation-xl)');
    // From the bottom, only the top corners round.
    expect(rule(sheetStyles, '.itsm-Sheet--bottom')).toContain('border-end-start-radius: 0;');
    const palette = rule(commandPaletteStyles, '.itsm-CommandPalette');
    expect(palette).toContain('border-radius: var(--itsm-radius-3xl);');
    expect(palette).toContain('box-shadow: var(--itsm-elevation-xl)');
    for (const css of [dialogStyles, sheetStyles, commandPaletteStyles, menuStyles, popoverStyles, toasterStyles]) {
      expect(css).not.toContain('squircle');
    }
  });

  it('toasts: radius 12, elevation lg, padding 12 10 12 14, 13/20 descriptions, a 24 px close', () => {
    const item = rule(toasterStyles, '.itsm-Toaster__item');
    expect(item).toContain('border-radius: var(--itsm-radius-xl);');
    expect(item).toContain('box-shadow: var(--itsm-elevation-lg)');
    expect(item).toContain('background: var(--itsm-colour-surface-overlay);');
    expect(rule(toasterStyles, '.itsm-Toaster__toast')).toContain(
      'padding: var(--itsm-space-sm) calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) var(--itsm-space-sm) calc(var(--itsm-space-sm) + var(--itsm-space-3xs));',
    );
    expect(rule(toasterStyles, '.itsm-Toaster__description')).toContain('font-size: var(--itsm-text-callout-size);');
    expect(rule(toasterStyles, '.itsm-Toaster__close')).toContain('inline-size: var(--itsm-icon-xl);');
    expect(rule(toasterStyles, '.itsm-Toaster__actions .itsm-Button--ghost')).toContain('color: var(--itsm-colour-brand-subtleText);');
  });

  it('reads only variables the tokens emit, and no colour literals', () => {
    for (const css of [menuStyles, contextMenuStyles, popoverStyles, sheetStyles, toasterStyles, confirmDialogStyles, dialogStyles, commandPaletteStyles]) {
      expect(unknownVariables(css)).toEqual([]);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    }
  });
});
