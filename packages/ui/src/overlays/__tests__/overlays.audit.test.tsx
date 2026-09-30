// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { notify, resetNotifications } from '../../provider/notify.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { Combobox, type ComboboxOption } from '../../web/Combobox.js';
import { DatePicker } from '../../web/DatePicker.js';
import { Dialog } from '../../web/Dialog.js';
import { Tooltip } from '../../web/Tooltip.js';
import { ConfirmDialog } from '../ConfirmDialog.js';
import { ConflictDialog } from '../ConflictDialog.js';
import { ContextMenu } from '../ContextMenu.js';
import { DateRangePicker } from '../DateRangePicker.js';
import { Menu, type MenuItemSpec } from '../Menu.js';
import { PersonPicker } from '../PersonPicker.js';
import { Popover } from '../Popover.js';
import { Sheet } from '../Sheet.js';
import { SplitButton } from '../SplitButton.js';
import { Toaster } from '../Toaster.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => {
  cleanupDocument();
  resetNotifications();
});

/**
 * Every overlay, open, audited from the document: they portal to the body,
 * so a container-scoped audit would pass by finding nothing. The page around
 * each one keeps its trigger, as a real page would — a modal overlay must
 * leave nothing focusable inside the parts it hides.
 */

const items: MenuItemSpec[] = [
  { type: 'label', label: 'Ticket' },
  { id: 'assign', label: 'Assign to me', icon: 'user', shortcut: 'a' },
  { id: 'open', label: 'Open full page', href: '/tickets/1' },
  { id: 'merge', label: 'Merge into…', disabled: true, disabledReason: 'Needs a second ticket' },
  { type: 'separator' },
  { type: 'checkbox', id: 'watch', label: 'Watch', checked: true, onCheckedChange: () => undefined },
  { type: 'radio', id: 'priority', label: 'Priority', value: 'p2', items: [{ value: 'p1', label: 'P1' }, { value: 'p2', label: 'P2' }], onValueChange: () => undefined },
  { type: 'submenu', id: 'move', label: 'Move to', items: [{ id: 'desk', label: 'Service desk' }] },
  { type: 'separator' },
  { id: 'delete', label: 'Delete ticket', tone: 'danger', icon: 'trash' },
];

function Page({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <TestProvider>
      <main>
        <h1>Tickets</h1>
        {children}
      </main>
    </TestProvider>
  );
}

async function openByKeyboard(label: string): Promise<void> {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label || button.getAttribute('aria-label') === label)!;
  focus(trigger);
  press(trigger, 'Enter');
  await settle();
}

describe('overlays pass axe while open', () => {
  it('a dialog as a bottom sheet or centred, with the page behind it', async () => {
    function Open(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <Page>
          <button type="button" onClick={() => setOpen(true)}>
            Resolve
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Resolve ticket" description="The requester is told." footer={<button type="button">Resolve ticket</button>}>
            <label>
              Note <input />
            </label>
          </Dialog>
        </Page>
      );
    }
    render(<Open />);
    click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Resolve')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('a menu with every kind of entry, and its submenu', async () => {
    render(
      <Page>
        <Menu label="Actions for INC-000123" trigger={<button type="button">Actions</button>} items={items} />
      </Page>,
    );
    await openByKeyboard('Actions');
    await expectNoViolations(document.body);
    // Into the submenu: the item before last-but-one is "Move to".
    const move = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Move to'))!;
    focus(move);
    press(move, 'ArrowRight');
    await settle();
    await expectNoViolations(document.body);
  });

  it('a context menu', async () => {
    render(
      <Page>
        <ContextMenu items={items} label="Actions for INC-000123">
          <div id="row">INC-000123</div>
        </ContextMenu>
      </Page>,
    );
    act(() => {
      document.querySelector('#row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
    await settle();
    await expectNoViolations(document.body);
  });

  it('a popover, with and without a title', async () => {
    render(
      <Page>
        <Popover title="View only" trigger={<button type="button">View only</button>}>
          <p>You need the Rules permission to change this.</p>
        </Popover>
        <Popover trigger={<button type="button">Why?</button>}>
          <p>Set by the catalogue.</p>
        </Popover>
      </Page>,
    );
    click([...document.querySelectorAll('button')].find((button) => button.textContent === 'View only')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('a modal sheet with header actions and a footer, and the discard prompt over it', async () => {
    function Open(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <Page>
          <button type="button" onClick={() => setOpen(true)}>
            Open rule
          </button>
          <Sheet
            open={open}
            onOpenChange={setOpen}
            dirty
            title="VIP requester"
            description="Routes tickets from the board."
            headerMeta={<span>Live</span>}
            headerActions={<button type="button">Copy link</button>}
            footer={<button type="button">Save rule</button>}
          >
            <label>
              Name <input />
            </label>
          </Sheet>
        </Page>
      );
    }
    render(<Open />);
    click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Open rule')!);
    await settle();
    await expectNoViolations(document.body);
    press(activeElement()!, 'Escape');
    await settle();
    await expectNoViolations(document.body);
  });

  it('a non-modal inspector sheet beside a usable page', async () => {
    render(
      <Page>
        <button type="button">Next ticket</button>
        <Sheet open onOpenChange={() => undefined} modal={false} title="Details" footer={<button type="button">Save</button>}>
          <p>Requester: Ada Lovelace</p>
        </Sheet>
      </Page>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('confirmations: danger with reason, typed name, consequences and an error', async () => {
    function Open(): ReactNode {
      const [open, setOpen] = useState(true);
      return (
        <Page>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            spec={{
              title: 'Delete the tenant?',
              body: 'Everything it holds is removed.',
              confirmLabel: 'Delete tenant',
              tone: 'danger',
              requireReason: { label: 'Reason', hint: 'Kept in the audit log.' },
              typeToConfirm: 'acme',
              consequences: [{ label: 'Used by 2 rules', href: '/rules' }],
            }}
            onConfirm={async () => {
              throw new Error('The tenant has open tickets.');
            }}
          />
        </Page>
      );
    }
    render(<Open />);
    await settle();
    await expectNoViolations(document.body);
    typeInto(document.querySelector<HTMLTextAreaElement>('.itsm-ConfirmDialog textarea')!, 'Closing the account');
    typeInto(document.querySelector<HTMLInputElement>('.itsm-ConfirmDialog input')!, 'acme');
    click([...document.querySelectorAll<HTMLButtonElement>('.itsm-ConfirmDialog button')].find((button) => button.textContent === 'Delete tenant')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('a conflict', async () => {
    render(
      <Page>
        <ConflictDialog
          open
          onOpenChange={() => undefined}
          entityLabel="INC-000123"
          changes={[{ field: 'Status', theirs: 'In progress', mine: 'Resolved', by: 'Jo', at: '2026-09-30T09:00:00Z' }]}
          onApplyMine={async () => undefined}
          onKeepTheirs={() => undefined}
        />
      </Page>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('toasts of every kind', async () => {
    installAnnouncer(document);
    try {
      render(
        <Page>
          <Toaster />
        </Page>,
      );
      await settle();
      act(() => {
        notify('Ticket closed', { undo: async () => undefined });
        notify('Too many requests', { tone: 'warning', retryAt: Date.now() + 20_000, action: { label: 'Retry', onClick: () => undefined } });
        notify('Couldn’t save', { tone: 'danger', description: 'The server did not answer.' });
        notify.progress('bulk', { label: 'Closing 40 tickets', done: 10, total: 40, onCancel: () => undefined });
      });
      await settle(60);
      await expectNoViolations(document.body);
    } finally {
      destroyAnnouncer();
    }
  });

  it('comboboxes open: grouped, several at once, and people', async () => {
    const options: ComboboxOption[] = [
      { value: 'laptop', label: 'Laptop', group: 'Hardware', icon: 'assets' },
      { value: 'vpn', label: 'VPN access', group: 'Access', description: 'Remote working' },
    ];
    function Fields(): ReactNode {
      const [one, setOne] = useState<ComboboxOption | null>(null);
      const [many, setMany] = useState<ComboboxOption[]>([options[0]!]);
      return (
        <Page>
          <label htmlFor="service">Service</label>
          <Combobox id="service" value={one} onChange={setOne} options={options} />
          <Combobox aria-label="Services" multiple value={many} onChange={setMany} options={options} creatable={{ label: (query) => `Create “${query}”` }} />
          <PersonPicker aria-label="Assignee" value={null} onChange={() => undefined} loadPeople={async () => [{ id: 'u1', name: 'Jo Resolver', detail: 'Network' }]} availability={{ u1: 'busy' }} />
        </Page>
      );
    }
    render(<Fields />);
    const [single, multiple, person] = [...document.querySelectorAll<HTMLInputElement>('[role="combobox"]')];
    focus(single!);
    press(single!, 'ArrowDown');
    await settle();
    await expectNoViolations(document.body);

    focus(multiple!);
    typeInto(multiple!, 'Printer');
    await settle();
    await expectNoViolations(document.body);

    focus(person!);
    typeInto(person!, 'jo');
    await settle(250);
    await expectNoViolations(document.body);
  });

  it('the date pickers with their calendars open', async () => {
    render(
      <Page>
        <DatePicker aria-label="Needed by" locale="en-GB" value="2026-03-14" onChange={() => undefined} presets={[{ label: 'Today', value: '2026-09-30' }]} />
        <DateRangePicker locale="en-GB" value={{ from: '2026-03-01', to: '2026-03-07' }} onChange={() => undefined} presets={[{ label: 'Last 7 days', value: { from: '2026-09-23', to: '2026-09-30' } }]} />
      </Page>,
    );
    await expectNoViolations(document.body);
    click(document.querySelectorAll<HTMLButtonElement>('.itsm-DatePicker__toggle')[0]!);
    await settle();
    await expectNoViolations(document.body);
    press(activeElement()!, 'Escape');
    await settle();
    click(document.querySelectorAll<HTMLButtonElement>('.itsm-DatePicker__toggle')[1]!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('a split button, closed and with its menu open', async () => {
    render(
      <Page>
        <SplitButton primary={{ id: 'send', label: 'Send' }} items={[{ id: 'resolve', label: 'Send and resolve' }]} />
      </Page>,
    );
    await expectNoViolations(document.body);
    await openByKeyboard('More options for Send');
    await expectNoViolations(document.body);
  });

  it('a tooltip while it is up', async () => {
    render(
      <Page>
        <Tooltip content="Copy the ticket link" shortcut="mod+shift+c">
          <button type="button">Copy</button>
        </Tooltip>
      </Page>,
    );
    const trigger = document.querySelector<HTMLButtonElement>('main button')!;
    press(document.body, 'Tab');
    focus(trigger);
    await settle();
    await expectNoViolations(document.body);
  });
});
