// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../../web/Dialog.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { Sheet } from '../Sheet.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

/**
 * Focus goes back to the opener however a modal overlay leaves: closed with
 * `open={false}` (the usual way), or unmounted while it was still open — a
 * holder that renders `{wanted ? <Dialog open … /> : null}` and drops it on
 * close. The second used to leave focus on `<body>`: on unmount React runs
 * the overlay's own cleanup (focus back) before its children's (`InertOutside`
 * lifting `inert`), and a browser will not focus an inert element.
 *
 * jsdom does not implement `inert`, so a browser's refusal is stood in for:
 * `focus()` on anything inside an `[inert]` subtree does nothing.
 */

const realFocus = HTMLElement.prototype.focus;

beforeEach(() => {
  HTMLElement.prototype.focus = function focusUnlessInert(this: HTMLElement, options?: FocusOptions) {
    if (this.closest('[inert]')) return;
    realFocus.call(this, options);
  };
});

afterEach(() => {
  HTMLElement.prototype.focus = realFocus;
  cleanupDocument();
});

type How = 'closed' | 'unmounted';

function SheetHolder({ how }: { readonly how: How }): ReactNode {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        id="opener"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        Open
      </button>
      {mounted ? (
        <Sheet
          open={open}
          title="Approval"
          onOpenChange={(next) => {
            if (next) return;
            if (how === 'unmounted') setMounted(false);
            else setOpen(false);
          }}
        >
          <input aria-label="Note" />
        </Sheet>
      ) : null}
    </div>
  );
}

function DialogHolder({ how }: { readonly how: How }): ReactNode {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        id="opener"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        Open
      </button>
      {mounted ? (
        <Dialog
          open={open}
          role="alertdialog"
          title="Your session ended"
          onClose={() => {
            if (how === 'unmounted') setMounted(false);
            else setOpen(false);
          }}
          footer={<button type="button">Sign in again</button>}
        >
          {null}
        </Dialog>
      ) : null}
    </div>
  );
}

async function openThenEscape(): Promise<HTMLButtonElement> {
  const opener = document.querySelector<HTMLButtonElement>('#opener')!;
  focus(opener);
  click(opener);
  await settle();
  const inside = activeElement();
  expect(inside).not.toBe(opener);
  // The page behind is inert while the overlay is open.
  expect(opener.closest('[inert]')).not.toBeNull();
  press(inside!, 'Escape');
  await settle();
  return opener;
}

describe.each([
  ['Sheet', SheetHolder],
  ['Dialog', DialogHolder],
] as const)('%s gives focus back to its opener', (_name, Holder) => {
  it('when closed with open={false}', async () => {
    render(<Holder how="closed" />);
    const opener = await openThenEscape();
    expect(opener.closest('[inert]')).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it('when unmounted while open', async () => {
    render(<Holder how="unmounted" />);
    const opener = await openThenEscape();
    expect(opener.closest('[inert]')).toBeNull();
    expect(activeElement()).toBe(opener);
  });
});
