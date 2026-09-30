// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeElement,
  cleanupDocument,
  click,
  focus,
  pointerDown,
  pointerMove,
  pointerUp,
  press,
  render,
  settle,
} from '../../web/__tests__/support/render.js';
import { Sheet, type SheetCloseReason, type SheetProps } from '../Sheet.js';
import { sheetStyles } from '../Sheet.styles.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

interface HarnessProps extends Partial<Omit<SheetProps, 'open' | 'onOpenChange' | 'children' | 'title'>> {
  readonly onClose?: (reason: SheetCloseReason | undefined) => void;
  readonly children?: ReactNode;
}

function Harness({ onClose, children, ...props }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open rule
      </button>
      <button type="button" id="outside">
        Elsewhere
      </button>
      <Sheet
        {...props}
        open={open}
        title="VIP requester"
        description="Routes tickets from the board to the VIP desk."
        onOpenChange={(next, reason) => {
          if (!next) onClose?.(reason);
          setOpen(next);
        }}
        footer={<button type="button">Save rule</button>}
      >
        {children ?? <input aria-label="Rule name" id="name" />}
      </Sheet>
    </div>
  );
}

function open(): { readonly opener: HTMLButtonElement; readonly sheet: HTMLElement } {
  const opener = document.querySelector<HTMLButtonElement>('#opener')!;
  focus(opener);
  click(opener);
  const sheet = document.querySelector<HTMLElement>('.itsm-Sheet');
  if (!sheet) throw new Error('sheet did not open');
  return { opener, sheet };
}

describe('Sheet (modal)', () => {
  it('is a named modal dialog that takes focus', () => {
    render(<Harness />);
    const { sheet } = open();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(sheet.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('VIP requester');
    expect(document.getElementById(sheet.getAttribute('aria-describedby') ?? '')?.textContent).toContain('VIP desk');
    expect(sheet.contains(activeElement())).toBe(true);
    expect(document.querySelector('.itsm-Sheet__scrim')).not.toBeNull();
  });

  it('closes with a reason — Escape, the close button, the scrim — and gives focus back', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    let { opener } = open();
    press(activeElement()!, 'Escape');
    expect(onClose).toHaveBeenLastCalledWith('escape');
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
    expect(activeElement()).toBe(opener);

    ({ opener } = open());
    click(document.querySelector<HTMLElement>('.itsm-Sheet__close')!);
    expect(onClose).toHaveBeenLastCalledWith('close-button');
    expect(activeElement()).toBe(opener);

    open();
    pointerDown(document.querySelector<HTMLElement>('.itsm-Sheet__scrim')!);
    expect(onClose).toHaveBeenLastCalledWith('scrim');
  });

  it('asks "Discard changes?" before closing a dirty sheet, focusing Keep editing', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    open();

    press(activeElement()!, 'Escape');
    const prompt = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Discard changes?');
    expect(activeElement()?.textContent).toBe('Keep editing');
    expect(onClose).not.toHaveBeenCalled();

    click(activeElement()!);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('.itsm-Sheet')).not.toBeNull();

    click(document.querySelector<HTMLElement>('.itsm-Sheet__close')!);
    const discard = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent === 'Discard changes');
    click(discard!);
    await settle();
    expect(onClose).toHaveBeenCalledWith('close-button');
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
  });
});

describe('Sheet (non-modal inspector)', () => {
  it('is a dialog that says it is not modal, with no scrim, and leaves the page usable', () => {
    const { container } = render(<Harness modal={false} />);
    const { sheet } = open();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('false');
    expect(document.querySelector('.itsm-Sheet__scrim')).toBeNull();
    expect(container.hasAttribute('aria-hidden')).toBe(false);
    expect(sheet.contains(activeElement())).toBe(true);

    // No trap: focus can leave for the page and stays there.
    const outside = document.querySelector<HTMLButtonElement>('#outside')!;
    focus(outside);
    expect(activeElement()).toBe(outside);
  });

  it('closes on Escape inside it, returning focus to the invoker; Escape on the page leaves it open', () => {
    const onClose = vi.fn();
    render(<Harness modal={false} onClose={onClose} />);
    const { opener, sheet } = open();

    const outside = document.querySelector<HTMLButtonElement>('#outside')!;
    focus(outside);
    press(outside, 'Escape');
    expect(onClose).not.toHaveBeenCalled();

    const field = sheet.querySelector<HTMLInputElement>('#name')!;
    focus(field);
    press(field, 'Escape');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it('is an F6 region', () => {
    render(<Harness modal={false} />);
    const { sheet } = open();
    const outside = document.querySelector<HTMLButtonElement>('#outside')!;
    focus(outside);
    press(outside, 'F6');
    expect(sheet.contains(activeElement())).toBe(true);
  });
});

describe('Sheet from the bottom', () => {
  function belowMd(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  }

  it('rises from the bottom below md, with a grab handle and two heights', async () => {
    belowMd();
    render(<Harness side="auto" />);
    await settle();
    const { sheet } = open();
    const handle = sheet.querySelector<HTMLElement>('.itsm-Sheet__handle');
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute('aria-hidden')).toBe('true');
    expect(sheet.dataset.snap).toBe('full');

    // A tap on the handle switches height (the single-pointer alternative to dragging).
    pointerDown(handle!, { clientY: 100 });
    pointerUp(handle!, { clientY: 101 });
    expect(sheet.dataset.snap).toBe('half');
  });

  it('opens half-height when small, and dismisses on a swipe down, saying so', async () => {
    belowMd();
    const onClose = vi.fn();
    render(<Harness side="bottom" size="sm" onClose={onClose} />);
    await settle();
    const { sheet } = open();
    expect(sheet.dataset.snap).toBe('half');

    const handle = sheet.querySelector<HTMLElement>('.itsm-Sheet__handle')!;
    pointerDown(handle, { clientY: 100 });
    pointerMove(handle, { clientY: 260 });
    pointerUp(handle, { clientY: 400 });
    expect(onClose).toHaveBeenCalledWith('swipe');
  });

  it('comes from the end edge at md and up, with no handle', async () => {
    render(<Harness side="auto" />);
    await settle();
    const { sheet } = open();
    expect(sheet.querySelector('.itsm-Sheet__handle')).toBeNull();
    expect(sheet.hasAttribute('data-snap')).toBe(false);
  });
});

describe('Sheet widths on a phone', () => {
  /** The rules inside the below-md media query, in order. */
  function belowMdRules(): string {
    const start = sheetStyles.indexOf('@media (max-width: 47.9375rem) {');
    expect(start).toBeGreaterThan(-1);
    return sheetStyles.slice(start, sheetStyles.indexOf('\n}\n', start));
  }

  it('caps an edge sheet one inset short of each side', () => {
    expect(belowMdRules()).toMatch(/\.itsm-Sheet--md,\s*\.itsm-Sheet--lg \{\s*max-inline-size: calc\(100vw - 2 \* var\(--_inset\)\);/);
  });

  it('lets a bottom or auto sheet of any size span the screen, with no strip at the side', () => {
    const rules = belowMdRules();
    const cap = rules.indexOf('max-inline-size: calc(100vw');
    const uncap = rules.search(/\.itsm-Sheet--auto,\s*\.itsm-Sheet--bottom \{\s*max-inline-size: none;/);
    // Same specificity as the size classes' cap, so it has to come after it.
    expect(uncap).toBeGreaterThan(cap);
  });
});
