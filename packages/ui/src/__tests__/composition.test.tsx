// @vitest-environment jsdom
import { crossAreaHref } from '@itsm/contracts/areas';
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer, installAnnouncer } from '../a11y/announcer.js';
import { FilterPills } from '../controls/FilterPills.js';
import { SearchField } from '../controls/SearchField.js';
import { SegmentedControl } from '../controls/SegmentedControl.js';
import { DataTable } from '../data/DataTable.js';
import { Form, FormActions } from '../formkit/Form.js';
import { Sheet } from '../overlays/Sheet.js';
import { navigation, noun, resetLocation, ruleColumns, rules, UrlProvider, type Rule } from '../data/__tests__/support/table.js';
import { TestProvider } from '../provider/__tests__/support/provider.js';
import { notify, resetNotifications } from '../provider/notify.js';
import { resetRecentsForTesting } from '../provider/recents.js';
import { useAreas } from '../shell/areas-context.js';
import { PageHeader } from '../shell/PageHeader.js';
import { resetShortcutsDialog } from '../shell/shortcuts.js';
import { resetSidebarMemoryForTesting } from '../shell/Sidebar.js';
import { TabNav } from '../shell/TabNav.js';
import { adminAreas, createLocation, setViewport, sidebarProps } from '../shell/__tests__/support.js';
import { componentStylesheet } from '../styles/index.js';
import type { ActionSpec } from '../types.js';
import { AppShell } from '../web/AppShell.js';
import { Button } from '../web/Button.js';
import { CommandPalette } from '../web/CommandPalette.js';
import { Dialog } from '../web/Dialog.js';
import { EmptyState } from '../web/EmptyState.js';
import { FormField } from '../web/FormField.js';
import { Input } from '../web/Input.js';
import { Tabs } from '../web/Tabs.js';
import { expectNoViolations } from '../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../web/__tests__/support/render.js';

/**
 * The seams between the design system's groups, each built by a different
 * package against the others' signatures: the provider and the toaster, the
 * data table and the toaster's undo, a button in a dialog's footer, one
 * action spec in two places, the frame and the palette an application hosts
 * in it. Each group tests itself with its neighbours mocked; these render
 * them together, unmocked, the way an application page does.
 */

vi.mock('../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
  resetSidebarMemoryForTesting();
  installAnnouncer(document);
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  resetNotifications();
  resetShortcutsDialog();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Waits, inside `act`, until `found` returns something — for chunks loaded with `import()` on first use. */
async function waitFor<T>(found: () => T | null | undefined, what: string, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const value = found();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await settle(25);
  }
}

const buttonNamed = (name: string, within: ParentNode = document): HTMLButtonElement | undefined =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === name);

describe('provider ↔ toaster', () => {
  it('shows a notify() made before the toaster has loaded, once it has, and says it once', async () => {
    render(
      <TestProvider>
        <p>Page</p>
      </TestProvider>,
    );
    act(() => {
      notify('Rule saved', { tone: 'success' });
    });
    const toast = await waitFor(
      () => [...document.querySelectorAll('.itsm-Toaster li, .itsm-Toaster [data-sonner-toast]')].find((node) => node.textContent?.includes('Rule saved')),
      'the toast',
    );
    expect(toast).toBeTruthy();
    expect(announcerText('polite')).toContain('Rule saved');
  });
});

describe('data table ↔ toaster undo', () => {
  it('clears a large selection with Escape, and the toast’s Undo brings it back', async () => {
    resetLocation();
    const nav = navigation();
    const rendered = render(
      <UrlProvider nav={nav}>
        <DataTable<Rule>
          caption="Rules"
          columns={ruleColumns}
          rows={rules}
          rowKey="key"
          selection="multiple"
          countNoun={noun}
          bulkActions={[{ id: 'archive', label: 'Archive' }]}
          onAction={vi.fn()}
        />
      </UrlProvider>,
    );
    const checkbox = (index: number): HTMLInputElement =>
      rendered.container.querySelectorAll<HTMLInputElement>('tbody tr[data-itsm-row] [data-itsm-control="select"]')[index]!;
    const primary = rendered.container.querySelector<HTMLElement>('tbody tr[data-itsm-row] [data-itsm-control="primary"]')!;

    focus(primary);
    press(primary, 'a', { ctrlKey: true });
    expect(rules.map((_, index) => checkbox(index).checked)).toEqual([true, true, true, true]);
    press(activeElement()!, 'Escape');
    expect(rendered.container.querySelector('[role="toolbar"]')).toBeNull();

    const undo = await waitFor(() => buttonNamed('Undo', document.querySelector('.itsm-Toaster') ?? document), 'the Undo button');
    click(undo);
    await waitFor(() => (checkbox(0).checked ? true : null), 'the selection to come back');
    expect(rules.map((_, index) => checkbox(index).checked)).toEqual([true, true, true, true]);
    expect(rendered.container.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Bulk actions for 4 selected rules');
  });
});

describe('buttons in a dialog’s footer', () => {
  function Confirm({ onClose }: { readonly onClose: () => void }): ReactNode {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Publish the form"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabledReason="Needs a connection" disabledIcon="lock">
              Publish
            </Button>
          </>
        }
      >
        <p>It goes live for every requester.</p>
      </Dialog>
    );
  }

  it('keeps a gated action reachable inside the modal, and explains it there', async () => {
    const onClose = vi.fn();
    render(
      <TestProvider>
        <Confirm onClose={onClose} />
      </TestProvider>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const footer = dialog.querySelector('.itsm-Dialog__footer')!;
    const publish = buttonNamed('Publish', footer)!;
    expect(buttonNamed('Cancel', footer)).toBeTruthy();

    // Focusable, described, and never the thing that closes the dialog.
    expect(publish.disabled).toBe(false);
    expect(publish.getAttribute('aria-disabled')).toBe('true');
    const described = (publish.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Needs a connection');
    focus(publish);
    click(publish);
    expect(onClose).not.toHaveBeenCalled();
    // The announcer's regions sit outside the dialog; the modal hides the page
    // behind it, but must leave them exposed or nothing is said while it is open.
    for (const region of document.querySelectorAll('[data-itsm-live-region]')) {
      expect(region.closest('[aria-hidden="true"], [inert]')).toBeNull();
    }
    await settle(50);
    expect(announcerText('polite')).toContain('Needs a connection');
    // The bubble is drawn inside the dialog, so the page the modal made inert does not swallow it.
    const bubble = [...dialog.querySelectorAll<HTMLElement>('*')].find((node) => node.textContent === 'Needs a connection' && !node.hidden);
    expect(bubble).toBeTruthy();
    expect(activeElement()).toBe(publish);
    // The lock is decoration beside the words; the name stays the label.
    expect(publish.querySelector('.itsm-Button__lock')?.getAttribute('aria-hidden')).toBe('true');
    expect(publish.textContent).toBe('Publish');
    await expectNoViolations(document.body);
  });
});

describe('one count, four controls', () => {
  it('draws and speaks a count the same in a tab, a route tab, a segment and a filter pill', () => {
    const location = createLocation('/rules');
    render(
      <TestProvider>
        <location.Provider>
          <Tabs label="Sections" items={[{ id: 'a', label: 'Rules', count: 5, content: <p>Rules</p> }]} />
          <TabNav label="Pages" items={[{ id: 'a', label: 'Rules', href: '/rules', count: 5 }]} />
          <SegmentedControl label="Scope" mode="value" value="a" options={[{ value: 'a', label: 'Rules', count: 5 }]} />
          <FilterPills label="Filter" mode="nav" value="a" options={[{ value: 'a', label: 'Rules', count: 5, href: '/rules' }]} />
        </location.Provider>
      </TestProvider>,
    );
    const spoken = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
      return [...node.childNodes].map(spoken).join('');
    };
    const controls = [
      document.querySelector('[role="tab"]')!,
      document.querySelector('.itsm-TabNav a')!,
      document.querySelector('[role="radio"]')!,
      document.querySelector('.itsm-FilterPills a')!,
    ];
    expect(controls.map((control) => spoken(control))).toEqual(['Rules, 5', 'Rules, 5', 'Rules, 5', 'Rules, 5']);
    // The current one in each carries the accent count, at the small size.
    for (const control of controls) {
      const count = control.querySelector('.itsm-Count')!;
      expect(count.getAttribute('data-size')).toBe('sm');
      expect(count.getAttribute('data-tone')).toBe('accent');
    }
  });
});

describe('form ↔ sheet', () => {
  function EditRule({ onSubmit }: { readonly onSubmit: () => Promise<void> }): ReactNode {
    const [open, setOpen] = useState(true);
    const [dirty, setDirty] = useState(false);
    return (
      <TestProvider>
        <Sheet open={open} onOpenChange={setOpen} title="VIP requester" dirty={dirty}>
          <Form onSubmit={onSubmit} onDirtyChange={setDirty}>
            <FormField label="Name">
              <Input name="name" defaultValue="VIP requester" />
            </FormField>
            <FormActions>
              <Button type="submit" variant="primary">
                Save rule
              </Button>
            </FormActions>
          </Form>
        </Sheet>
      </TestProvider>
    );
  }

  it('asks before discarding only while the form inside it has unsaved changes', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<EditRule onSubmit={onSubmit} />);
    const name = document.querySelector<HTMLInputElement>('input[name="name"]')!;
    focus(name);
    typeInto(name, 'VIP requester (EMEA)');
    await settle();

    press(name, 'Escape');
    const prompt = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Discard changes?');
    click(buttonNamed('Keep editing', prompt!)!);
    expect(document.querySelector('.itsm-Sheet')).not.toBeNull();

    // Saved: the form is clean again, and closing no longer asks.
    click(buttonNamed('Save rule')!);
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    press(document.querySelector('input[name="name"]')!, 'Escape');
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('.itsm-Sheet')).toBeNull();
  });
});

describe('one action spec, two places', () => {
  const gated: ActionSpec = { id: 'publish', label: 'Publish', disabled: true, disabledReason: 'Publish the form first' };
  const link: ActionSpec = { id: 'new', label: 'New rule', href: '/rules/new', icon: 'plus' };

  it('draws a state gate and a link the same in a page header and an empty state', () => {
    const onAction = vi.fn();
    render(
      <TestProvider>
        <PageHeader title="Rules" primaryAction={gated} secondaryActions={[link]} onAction={onAction} />
        <EmptyState title="No rules yet" action={gated} secondaryAction={link} onAction={onAction} />
      </TestProvider>,
    );
    const gates = [...document.querySelectorAll<HTMLButtonElement>('[data-action="publish"]')];
    expect(gates).toHaveLength(2);
    for (const gate of gates) {
      expect(gate.tagName).toBe('BUTTON');
      expect(gate.disabled).toBe(false);
      expect(gate.getAttribute('aria-disabled')).toBe('true');
      const described = (gate.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
      expect(described).toContain('Publish the form first');
      click(gate);
    }
    expect(onAction).not.toHaveBeenCalled();

    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-action="new"]')];
    expect(links).toHaveLength(2);
    for (const anchor of links) {
      expect(anchor.tagName).toBe('A');
      expect(anchor.getAttribute('href')).toBe('/rules/new');
      expect(anchor.classList.contains('itsm-Button')).toBe(true);
      expect(anchor.querySelector('svg[data-icon="plus"]')).not.toBeNull();
    }
  });
});

describe('one activity indicator', () => {
  it('is what a busy button and a searching field both draw', () => {
    render(
      <TestProvider>
        <Button loading>Save</Button>
        <SearchField label="Search rules" value="vpn" onValueChange={() => undefined} loading />
      </TestProvider>,
    );
    expect(document.querySelector('.itsm-Button .itsm-Spinner')).not.toBeNull();
    expect(document.querySelector('.itsm-SearchField .itsm-Spinner')).not.toBeNull();
  });

  it('is the only thing in the stylesheet that turns', () => {
    const turning = [...componentStylesheet.matchAll(/@keyframes ([\w-]+) \{([^{}]|\{[^{}]*\})*\}/g)]
      .filter(([rule]) => rule.includes('rotate('))
      .map(([, name]) => name);
    expect(turning).toEqual(['itsm-spin']);
    // A duplicate of the shared keyframes under another name is how the looks drift apart.
    const pulses = [...componentStylesheet.matchAll(/@keyframes ([\w-]+) \{\s*0%, 100% \{ opacity: 1; \}/g)].map(([, name]) => name);
    expect(pulses).toEqual(['itsm-pulse']);
  });
});

describe('the bottom edge', () => {
  it('is cleared once: the dock’s height already counts the safe area', () => {
    // Adding the two floats a bar a home indicator's height above a tab bar.
    expect(componentStylesheet).not.toMatch(/bottom-dock-height[^;]*\+\s*var\(--itsm-safe-area-bottom\)/);
    expect(componentStylesheet).not.toMatch(/safe-area-bottom\)[^;]*\+\s*var\(--itsm-bottom-dock-height/);
  });
});

describe('frame ↔ page header ↔ sidebar', () => {
  it('agree on the page: the sidebar’s current item, the top bar’s title and purpose, and the page’s hidden h1', async () => {
    setViewport(1440);
    const location = createLocation('/rules');
    render(
      <location.Provider>
        <AppShell {...sidebarProps()}>
          <PageHeader title="Rules" purpose="Route and update tickets as they arrive" primaryAction={{ id: 'new', label: 'New rule', href: '/rules/new' }} />
        </AppShell>
      </location.Provider>,
    );
    await settle();
    expect(document.querySelector('.itsm-Sidebar [aria-current="page"]')?.textContent).toBe('Rules3, 3 drafts');
    expect(document.querySelector('.itsm-AppTopBar__title')?.textContent).toBe('Rules');
    expect(document.querySelector('.itsm-AppTopBar__purpose')?.textContent).toBe('Route and update tickets as they arrive');
    const h1 = document.querySelector('main h1')!;
    expect(h1.className).toContain('itsm-visually-hidden-focusable');
    // The visible row keeps the page's action: "the title is in the top bar; content starts with a toolbar row".
    expect(document.querySelector('main .itsm-PageHeader__actions [data-action="new"]')).not.toBeNull();
  });

  it('lets a page reach the other areas through the frame’s model, never an origin of its own', async () => {
    function OpenInDesk(): ReactNode {
      const areas = useAreas();
      const href = areas ? crossAreaHref(areas, 'workbench', '/tickets/INC-000004') : null;
      return href ? <a href={href}>Open in Service Desk</a> : null;
    }
    setViewport(1440);
    const location = createLocation('/tickets');
    render(
      <location.Provider>
        <AppShell {...sidebarProps({ areas: adminAreas })}>
          <OpenInDesk />
        </AppShell>
      </location.Provider>,
    );
    expect(document.querySelector('main a')?.getAttribute('href')).toBe('https://desk.example/tickets/INC-000004');
  });
});

describe('frame ↔ palette', () => {
  function Desk({ location }: { readonly location: ReturnType<typeof createLocation> }): ReactNode {
    const [open, setOpen] = useState(false);
    return (
      <location.Provider>
        <AppShell {...sidebarProps({ onOpenSearch: () => setOpen(true) })}>
          <PageHeader title="Rules" />
          <label htmlFor="name">Name</label>
          <input id="name" />
        </AppShell>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          providers={[{ id: 'go', group: 'Go to', items: [{ id: 'sla', label: 'Service levels', href: '/sla' }] }]}
        />
      </location.Provider>
    );
  }

  it('opens the application’s palette from a text field with mod+K, keeps ? as text inside it, and hands focus back', async () => {
    setViewport(1440);
    render(<Desk location={createLocation('/rules')} />);
    await settle();
    const field = document.getElementById('name') as HTMLInputElement;
    focus(field);
    press(field, 'k', { ctrlKey: true });
    const input = await waitFor(() => document.querySelector<HTMLInputElement>('.itsm-CommandPalette__input'), 'the palette');
    expect(activeElement()).toBe(input);

    // `?` typed into the palette is a character, not the shortcuts dialog.
    press(input, '?');
    await settle();
    expect([...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.textContent?.includes('Keyboard shortcuts'))).toBe(false);

    press(input, 'Escape');
    await settle();
    expect(document.querySelector('.itsm-CommandPalette__input')).toBeNull();
    expect(activeElement()).toBe(field);
  });
});
