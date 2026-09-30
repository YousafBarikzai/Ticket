// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption } from '../../web/Combobox.js';
import { Dialog } from '../../web/Dialog.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { Menu } from '../Menu.js';
import { Popover } from '../Popover.js';
import { Sheet } from '../Sheet.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

/**
 * SPEC §8.1 WP4: "Escape closes only the innermost layer". Every overlay is
 * on the same layer stack, whichever component drew it, so one Escape peels
 * one layer — and never reaches the page's own Escape handlers.
 */

const menuItems = [
  { id: 'copy', label: 'Copy link' },
  { id: 'delete', label: 'Delete rule', tone: 'danger' as const },
];

function SheetWithMenu({ modal, onPageEscape }: { readonly modal: boolean; readonly onPageEscape?: () => void }): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onPageEscape?.();
      }}
    >
      <Sheet open={open} onOpenChange={setOpen} title="Rule" modal={modal}>
        <Menu trigger={<button type="button">Rule actions</button>} items={menuItems} />
      </Sheet>
    </div>
  );
}

async function openMenuIn(scope: ParentNode): Promise<void> {
  const trigger = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Rule actions')!;
  focus(trigger);
  press(trigger, 'Enter');
  await settle();
}

describe('Escape closes only the innermost layer', () => {
  it('a menu in a modal sheet: first the menu, then the sheet', async () => {
    render(<SheetWithMenu modal />);
    await openMenuIn(document);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    press(activeElement()!, 'Escape');
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('.itsm-Sheet')).not.toBeNull();
    // Back on the menu's trigger, inside the sheet.
    expect(activeElement()?.textContent).toBe('Rule actions');

    press(activeElement()!, 'Escape');
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
  });

  it('a menu in a non-modal sheet: first the menu, then the sheet, and never the page', async () => {
    const onPageEscape = vi.fn();
    render(<SheetWithMenu modal={false} onPageEscape={onPageEscape} />);
    await openMenuIn(document);

    press(activeElement()!, 'Escape');
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('.itsm-Sheet')).not.toBeNull();

    press(activeElement()!, 'Escape');
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
    expect(onPageEscape).not.toHaveBeenCalled();
  });

  it('a combobox list in a dialog: first the list, then the dialog', async () => {
    const options: ComboboxOption[] = [
      { value: 'sam', label: 'Sam Agent' },
      { value: 'jo', label: 'Jo Resolver' },
    ];
    function DialogWithCombobox(): ReactNode {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState<ComboboxOption | null>(null);
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Assign ticket">
          <Combobox aria-label="Assignee" value={value} onChange={setValue} options={options} />
        </Dialog>
      );
    }
    render(<DialogWithCombobox />);
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    focus(input);
    press(input, 'ArrowDown');
    await settle();
    expect(input.getAttribute('aria-expanded')).toBe('true');

    press(input, 'Escape');
    await settle();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    press(input, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a popover in a dialog: first the popover, focus back on its trigger, then the dialog', async () => {
    function DialogWithPopover(): ReactNode {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Edit field">
          <Popover title="Why is this read-only?" trigger={<button type="button">Why?</button>}>
            <p>Set by the service catalogue.</p>
          </Popover>
        </Dialog>
      );
    }
    render(<DialogWithPopover />);
    const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Why?')!;
    focus(trigger);
    click(trigger);
    await settle();
    expect(document.querySelector('.itsm-Popover')).not.toBeNull();

    press(activeElement()!, 'Escape');
    await settle();
    expect(document.querySelector('.itsm-Popover')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(activeElement()).toBe(trigger);

    press(activeElement()!, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
