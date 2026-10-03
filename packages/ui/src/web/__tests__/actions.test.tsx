// @vitest-environment jsdom
import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { Button } from '../Button.js';
import { buttonStyles } from '../Button.styles.js';
import { IconButton } from '../IconButton.js';
import { iconButtonStyles } from '../IconButton.styles.js';
import { activeElement, cleanupDocument, click, focus, press, render } from './support/render.js';

/*
 * Button and IconButton (SPEC §4.2, WP3 acceptance): variants and links, the
 * busy state that keeps focus and swallows clicks, the disabled-with-a-reason
 * state that stays reachable and explains itself (X-80), and the icon
 * button's tooltip, which is fetched only when somebody points at or tabs to
 * a button.
 */

const tooltipModule = vi.hoisted(() => ({ loads: 0 }));
vi.mock('../IconButtonTooltip.js', async (importOriginal) => {
  tooltipModule.loads += 1;
  return importOriginal();
});

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** React's `onPointerEnter`/`onPointerLeave` are built on `pointerover`/`pointerout`. */
function pointer(target: Element, type: 'pointerover' | 'pointerout' | 'pointerdown', pointerType = 'mouse'): void {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType }));
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Lets the lazily imported tooltip module resolve and render. */
async function flushLazy(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function button(name?: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((element) =>
    name === undefined ? true : (element.getAttribute('aria-label') ?? element.textContent)?.includes(name),
  );
  if (!found) throw new Error(`no button ${name ?? ''}`);
  return found;
}

function bubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.itsm-Bubble');
}

/** The declarations of the first rule in `sheet` written exactly as `selector {`. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  return start < 0 ? '' : sheet.slice(start, sheet.indexOf('}', start));
}

describe('Button', () => {
  it('is a plain type=button by default, with its variant and size as classes', () => {
    render(<Button>Save</Button>);
    const element = button('Save');
    expect(element.type).toBe('button');
    expect(element.className).toContain('itsm-Button--secondary');
    expect(element.className).toContain('itsm-Button--md');
    // Nothing but the label inside: callers assert on `textContent`.
    expect(element.textContent).toBe('Save');
  });

  it('accepts the deprecated `subtle` as `tinted`', () => {
    render(<Button variant="subtle">Filter</Button>);
    expect(button('Filter').className).toContain('itsm-Button--tinted');
  });

  it('draws a registry icon from its name and passes other nodes through', () => {
    render(
      <Button iconStart="plus" iconEnd={<b data-testid="mine">!</b>}>
        New ticket
      </Button>,
    );
    const element = button('New ticket');
    expect(element.querySelector('svg[data-icon="plus"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelector('[data-testid="mine"]')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('hands the caller its ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current).toBe(button('Save'));
  });

  describe('as a link', () => {
    it('renders the provider Link, styled the same', () => {
      render(
        <TestProvider>
          <Button href="/tickets/new" variant="primary">
            New ticket
          </Button>
        </TestProvider>,
      );
      const link = document.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/tickets/new');
      expect(link?.className).toContain('itsm-Button--primary');
      expect(document.querySelector('button')).toBeNull();
    });

    it('opens an external destination in a new tab and says so', () => {
      render(
        <Button href="https://status.example.com" external>
          Status page
        </Button>,
      );
      const link = document.querySelector('a');
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link?.querySelector('svg[data-icon="external"]')).not.toBeNull();
      expect(link?.textContent).toContain('opens in a new tab');
    });

    it('is a button while it cannot be followed', () => {
      render(
        <Button href="/rules/new" disabledReason="Publish the form first">
          New rule
        </Button>,
      );
      expect(document.querySelector('a')).toBeNull();
      expect(button('New rule').getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('loading', () => {
    it('keeps focus, marks itself busy and swallows clicks', () => {
      const onClick = vi.fn();
      const view = render(
        <Button onClick={onClick} loadingLabel="Saving">
          Save
        </Button>,
      );
      const element = button('Save');
      focus(element);
      view.rerender(
        <Button onClick={onClick} loading loadingLabel="Saving">
          Save
        </Button>,
      );
      expect(activeElement()).toBe(element);
      expect(element.disabled).toBe(false);
      expect(element.getAttribute('aria-busy')).toBe('true');
      expect(element.getAttribute('aria-disabled')).toBe('true');
      click(element);
      expect(onClick).not.toHaveBeenCalled();
      // The label is kept (for its width and its name); the busy words follow it.
      expect(element.textContent).toBe('SaveSaving');
    });

    it('does not submit its form while busy', () => {
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
          <Button type="submit" loading>
            Send
          </Button>
        </form>,
      );
      click(button('Send'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('puts the spinner in the start icon’s place, or over the label when there is none', () => {
      const view = render(
        <Button loading iconStart="send">
          Send
        </Button>,
      );
      expect(button('Send').getAttribute('data-loading')).toBe('start');
      expect(button('Send').querySelector('svg[data-icon="send"]')).toBeNull();
      view.rerender(<Button loading>Send</Button>);
      expect(button('Send').getAttribute('data-loading')).toBe('overlay');
      expect(button('Send').querySelector('.itsm-Button__spinner[data-overlay]')).not.toBeNull();
    });

    it('says "Loading…" by default', () => {
      render(<Button loading>Save</Button>);
      expect(button('Save').querySelector('.itsm-visually-hidden')?.textContent).toBe('Loading…');
    });
  });

  describe('disabledReason', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    function renderGated(onClick = vi.fn()): HTMLButtonElement {
      render(
        <Button onClick={onClick} disabledReason="Needs a connection">
          Publish rule
        </Button>,
      );
      return button('Publish rule');
    }

    it('stays focusable, is aria-disabled, and is described by the reason', () => {
      const element = renderGated();
      expect(element.disabled).toBe(false);
      expect(element.getAttribute('aria-disabled')).toBe('true');
      const describedBy = element.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent).toBe('Needs a connection');
      // The reason is not part of the button's name.
      expect(element.textContent).toBe('Publish rule');
      focus(element);
      expect(activeElement()).toBe(element);
    });

    it('keeps the caller’s own description alongside the reason', () => {
      render(
        <>
          <p id="note">Publishing notifies everyone.</p>
          <Button aria-describedby="note" disabledReason="Needs a connection">
            Publish rule
          </Button>
        </>,
      );
      expect(button('Publish rule').getAttribute('aria-describedby')?.split(' ')[0]).toBe('note');
    });

    it('explains itself on a click or tap for four seconds, and says it aloud', async () => {
      const onClick = vi.fn();
      const element = renderGated(onClick);
      click(element);
      expect(onClick).not.toHaveBeenCalled();
      expect(bubble()?.textContent).toBe('Needs a connection');
      expect(bubble()?.getAttribute('aria-hidden')).toBe('true');
      advance(50);
      expect(document.querySelector('[data-itsm-live-region="polite"]')?.textContent).toBe('Needs a connection');
      advance(3900);
      expect(bubble()).not.toBeNull();
      advance(200);
      expect(bubble()).toBeNull();
    });

    it('does not submit its form', () => {
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
          <Button type="submit" disabledReason="Fix the errors first">
            Save
          </Button>
        </form>,
      );
      click(button('Save'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows on hover after a delay, never for touch, and Escape puts it away', () => {
      const element = renderGated();
      pointer(element, 'pointerover', 'touch');
      advance(1000);
      expect(bubble()).toBeNull();

      pointer(element, 'pointerover');
      advance(400);
      expect(bubble()).toBeNull();
      advance(200);
      expect(bubble()?.textContent).toBe('Needs a connection');
      press(document.body, 'Escape');
      expect(bubble()).toBeNull();
    });

    it('goes when the gate lifts', () => {
      const view = render(<Button disabledReason="Needs a connection">Publish rule</Button>);
      click(button('Publish rule'));
      expect(bubble()).not.toBeNull();
      view.rerender(<Button>Publish rule</Button>);
      expect(bubble()).toBeNull();
      expect(button('Publish rule').getAttribute('aria-disabled')).toBeNull();
    });
  });

  it('with plain `disabled` is natively disabled and explains nothing', () => {
    render(<Button disabled>Save</Button>);
    expect(button('Save').disabled).toBe(true);
    expect(button('Save').getAttribute('aria-describedby')).toBeNull();
  });

  describe('disabledIcon (the demo-locked action)', () => {
    it('draws a decorative 14 px lock after the label while the action is unavailable, with the reason as its description', () => {
      render(
        <Button disabledReason="Uploads are turned off in the demo" disabledIcon="lock" iconStart="plus">
          Attach a file
        </Button>,
      );
      const element = button('Attach a file');
      expect(element.getAttribute('aria-disabled')).toBe('true');
      expect(element.hasAttribute('data-locked')).toBe(true);
      const lock = element.querySelector('.itsm-Button__lock')!;
      expect(lock.getAttribute('data-icon')).toBe('lock');
      expect(lock.getAttribute('aria-hidden')).toBe('true');
      expect(lock.getAttribute('data-size')).toBe('xs');
      // After the label, the last thing in the button.
      expect(element.querySelector('.itsm-Button__label')?.compareDocumentPosition(lock)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(element.textContent).toBe('Attach a file');
      const describedBy = element.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent).toBe('Uploads are turned off in the demo');
    });

    it('takes the end icon’s place, and shows on a plain disabled button too', () => {
      render(
        <>
          <Button disabledIcon="lock" disabledReason="Turned off in the demo" iconEnd="arrow-right">
            Export
          </Button>
          <Button disabledIcon="lock" disabled>
            Delete
          </Button>
        </>,
      );
      expect(button('Export').querySelector('[data-icon="arrow-right"]')).toBeNull();
      expect(button('Export').querySelector('[data-icon="lock"]')).not.toBeNull();
      expect(button('Delete').querySelector('[data-icon="lock"]')).not.toBeNull();
    });

    it('is not drawn while the action is available, or while it is only busy', () => {
      const view = render(
        <Button disabledIcon="lock" iconEnd="arrow-right">
          Export
        </Button>,
      );
      expect(button('Export').querySelector('[data-icon="lock"]')).toBeNull();
      expect(button('Export').querySelector('[data-icon="arrow-right"]')).not.toBeNull();
      expect(button('Export').hasAttribute('data-locked')).toBe(false);
      view.rerender(
        <Button disabledIcon="lock" loading>
          Export
        </Button>,
      );
      expect(button('Export').querySelector('[data-icon="lock"]')).toBeNull();
    });

    it('keeps a link that is locked a button, with the lock', () => {
      render(
        <Button href="/reports/export" disabledIcon="lock" disabledReason="Turned off in the demo">
          Export
        </Button>,
      );
      expect(document.querySelector('a')).toBeNull();
      expect(button('Export').querySelector('[data-icon="lock"]')).not.toBeNull();
    });
  });

  describe('the v3 look (§2.14)', () => {
    it('paints primary with the brand gradient over the solid colour, the xs shadow and the inner highlight', () => {
      const primary = rule(buttonStyles, '.itsm-Button--primary');
      expect(primary).toContain('background-color: var(--itsm-colour-brand-solid)');
      expect(primary).toContain('background-image: var(--itsm-gradient-brand)');
      expect(primary).toContain('box-shadow: var(--itsm-elevation-xs), var(--itsm-highlight-inset)');
      expect(rule(buttonStyles, '.itsm-Button--primary:hover,\n.itsm-Button--primary:active')).toContain('var(--itsm-gradient-brand-hover)');
    });

    it('makes secondary a raised button with a border.soft edge, firming under the pointer', () => {
      const secondary = rule(buttonStyles, '.itsm-Button--secondary');
      expect(secondary).toContain('border-color: var(--itsm-colour-border-soft)');
      expect(secondary).toContain('background-color: var(--itsm-colour-surface-raised)');
      expect(secondary).toContain('box-shadow: var(--itsm-elevation-xs)');
      const hover = rule(buttonStyles, '.itsm-Button--secondary:hover');
      expect(hover).toContain('var(--itsm-colour-border-interactive)');
      expect(hover).toContain('var(--itsm-colour-surface-raisedAlt)');
      expect(rule(buttonStyles, '.itsm-Button--ghost:hover')).toContain('var(--itsm-colour-surface-hover)');
    });

    it('sets 600 13/20 labels, 12/16 small, 14/20 large, and the item radius at 44 px', () => {
      const base = rule(buttonStyles, '.itsm-Button');
      expect(base).toContain('font-weight: var(--itsm-font-weight-semibold)');
      expect(base).toContain('font-size: var(--itsm-text-callout-size)');
      expect(base).toContain('border-radius: var(--itsm-radius-lg)');
      expect(rule(buttonStyles, '.itsm-Button--sm')).toContain('font-size: var(--itsm-text-footnote-size)');
      const large = rule(buttonStyles, '.itsm-Button--lg');
      expect(large).toContain('border-radius: var(--itsm-radius-item)');
      expect(large).toContain('font-size: var(--itsm-text-body-size)');
      expect(large).toContain('line-height: var(--itsm-text-callout-line)');
    });

    it('draws unavailable on the opaque sunken surface, never with opacity', () => {
      const unavailable = rule(buttonStyles, '.itsm-Button:disabled,\n.itsm-Button[aria-disabled="true"]:not([aria-busy="true"])');
      expect(unavailable).toContain('background-color: var(--itsm-colour-surface-sunken)');
      expect(unavailable).toContain('color: var(--itsm-colour-text-disabled)');
      expect(buttonStyles).not.toMatch(/opacity:\s*0?\.\d/);
    });

    it('gives the icon button the same corners and variants', () => {
      expect(rule(iconButtonStyles, '.itsm-IconButton--lg')).toContain('border-radius: var(--itsm-radius-item)');
      expect(rule(iconButtonStyles, '.itsm-IconButton--secondary')).toContain('border-color: var(--itsm-colour-border-soft)');
      expect(rule(iconButtonStyles, '.itsm-IconButton--ghost:hover')).toContain('var(--itsm-colour-surface-hover)');
      expect(iconButtonStyles).not.toContain('fill-secondary');
    });
  });
});

describe('IconButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('is named by its label and announces its shortcut', () => {
    render(<IconButton label="Search" icon="search" shortcut="mod+k" />);
    const element = button('Search');
    expect(element.getAttribute('aria-label')).toBe('Search');
    expect(element.getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
    expect(element.querySelector('svg[data-icon="search"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a toggle with `pressed`', () => {
    const view = render(<IconButton label="Pin" icon="pin" pressed={false} />);
    expect(button('Pin').getAttribute('aria-pressed')).toBe('false');
    view.rerender(<IconButton label="Pin" icon="pin" pressed />);
    expect(button('Pin').getAttribute('aria-pressed')).toBe('true');
  });

  it('still draws a legacy glyph string as text', () => {
    render(<IconButton label="Close" icon="✕" />);
    expect(button('Close').textContent).toBe('✕');
  });

  it('becomes a link with `href`', () => {
    render(
      <TestProvider>
        <IconButton label="Settings" icon="settings" href="/settings" />
      </TestProvider>,
    );
    expect(document.querySelector('a')?.getAttribute('aria-label')).toBe('Settings');
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/settings');
  });

  describe('tooltip', () => {
    it('is fetched only once somebody points at the button, then shows after the delay', async () => {
      render(<IconButton label="Assign to me" icon="user-plus" shortcut="i" />);
      await flushLazy();
      expect(bubble()).toBeNull();
      // Nothing in this file has pointed at an icon button yet.
      expect(tooltipModule.loads).toBe(0);

      pointer(button('Assign to me'), 'pointerover');
      await flushLazy();
      expect(bubble()).toBeNull();
      advance(500);
      await flushLazy();
      const shown = bubble();
      expect(shown?.textContent).toContain('Assign to me');
      expect(shown?.querySelector('.itsm-Kbd')).not.toBeNull();
      expect(shown?.getAttribute('aria-hidden')).toBe('true');
      expect(tooltipModule.loads).toBe(1);
    });

    it('never shows for touch, or when switched off, or in an app that turns tooltips off', async () => {
      render(
        <>
          <IconButton label="One" icon="plus" />
          <IconButton label="Two" icon="plus" tooltip={false} />
          <TestProvider app="portal">
            <IconButton label="Three" icon="plus" />
          </TestProvider>
        </>,
      );
      pointer(button('One'), 'pointerover', 'touch');
      pointer(button('Two'), 'pointerover');
      pointer(button('Three'), 'pointerover');
      advance(1000);
      await flushLazy();
      expect(bubble()).toBeNull();
    });

    it('hides when the pointer leaves, after a moment to reach the bubble', async () => {
      render(<IconButton label="Filter" icon="list-filter" />);
      pointer(button('Filter'), 'pointerover');
      advance(500);
      await flushLazy();
      expect(bubble()).not.toBeNull();
      pointer(button('Filter'), 'pointerout');
      advance(50);
      expect(bubble()).not.toBeNull();
      advance(100);
      expect(bubble()).toBeNull();
    });

    it('goes on a press and on Escape', async () => {
      render(<IconButton label="Filter" icon="list-filter" />);
      pointer(button('Filter'), 'pointerover');
      advance(500);
      await flushLazy();
      expect(bubble()).not.toBeNull();
      pointer(button('Filter'), 'pointerdown');
      expect(bubble()).toBeNull();

      pointer(button('Filter'), 'pointerout');
      advance(200);
      pointer(button('Filter'), 'pointerover');
      advance(500);
      await flushLazy();
      expect(bubble()).not.toBeNull();
      press(document.body, 'Escape');
      expect(bubble()).toBeNull();
    });

    it('shows the next one at once while the last has only just closed', async () => {
      render(
        <>
          <IconButton label="Bold" icon="plus" />
          <IconButton label="Italic" icon="minus" />
        </>,
      );
      pointer(button('Bold'), 'pointerover');
      advance(500);
      await flushLazy();
      pointer(button('Bold'), 'pointerout');
      advance(150);
      expect(bubble()).toBeNull();
      pointer(button('Italic'), 'pointerover');
      await flushLazy();
      expect(bubble()?.textContent).toContain('Italic');
    });

    it('shows at once on keyboard focus, but not when the page moves focus', async () => {
      // jsdom never matches :focus-visible; here it means "has focus".
      const original = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : original.call(this, selector);
      });
      render(
        <>
          <IconButton label="First" icon="plus" />
          <IconButton label="Second" icon="minus" />
        </>,
      );
      // A dialog focusing its close button: no Tab was pressed.
      focus(button('First'));
      await flushLazy();
      expect(bubble()).toBeNull();

      press(button('First'), 'Tab');
      focus(button('Second'));
      await flushLazy();
      expect(bubble()?.textContent).toContain('Second');
    });
  });
});
