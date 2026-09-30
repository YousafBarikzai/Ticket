// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { Button } from '../Button.js';
import { Checkbox } from '../Checkbox.js';
import { FormField } from '../FormField.js';
import { IconButton } from '../IconButton.js';
import { Input } from '../Input.js';
import { RadioGroup } from '../RadioGroup.js';
import { Select } from '../Select.js';
import { Switch } from '../Switch.js';
import { Tabs } from '../Tabs.js';
import { Textarea } from '../Textarea.js';
import { expectNoViolations } from './support/audit.js';
import { cleanupDocument, click, render, typeInto } from './support/render.js';

/*
 * The actions and inputs as they are after the redesign (SPEC §8.0 rule 5),
 * read by axe in the states the frozen `audit.test.tsx` never renders: links
 * that look like buttons, a button explaining why it is unavailable, an icon
 * button with its tooltip up, fields with adornments, counters and the
 * inline layout, cards for radios, switches in every state. Audited on the
 * whole document, because the tooltip and reason bubbles are placed in the
 * top layer rather than inside their container.
 */

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

async function audit(element: ReactElement): Promise<void> {
  render(<TestProvider>{element}</TestProvider>);
  await expectNoViolations(document.body);
}

describe('actions', () => {
  it('Button: every variant, as a link, external, busy and gated with a reason', async () => {
    await audit(
      <div>
        <Button variant="primary" iconStart="plus">
          New ticket
        </Button>
        <Button variant="tinted">Filter</Button>
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
        <Button variant="danger">Delete rule</Button>
        <Button variant="dangerTinted" shape="capsule" size="lg">
          Archive
        </Button>
        <Button href="/rules/new">Write a rule</Button>
        <Button href="https://status.example.com" external>
          Status page
        </Button>
        <Button loading loadingLabel="Publishing" iconStart="send">
          Publish rule
        </Button>
        <Button loading>Save</Button>
        <Button disabledReason="Needs a connection">Publish form</Button>
        <Button disabled>Unavailable</Button>
      </div>,
    );
  });

  it('Button: with its reason showing', async () => {
    render(
      <TestProvider>
        <Button disabledReason="Publish the form first">New request type</Button>
      </TestProvider>,
    );
    click(document.querySelector('button')!);
    await expectNoViolations(document.body);
  });

  it('IconButton: toggle, shortcut, link, legacy glyph, and with its tooltip up', async () => {
    vi.useFakeTimers();
    render(
      <TestProvider>
        <div role="toolbar" aria-label="Formatting">
          <IconButton label="Pin" icon="pin" pressed />
          <IconButton label="Search" icon="search" shortcut="mod+k" variant="secondary" />
          <IconButton label="Close" icon="✕" variant="tinted" size="sm" />
          <IconButton label="Disabled" icon="trash" disabled />
        </div>
        <IconButton label="Settings" icon="settings" href="/settings" />
      </TestProvider>,
    );
    const search = document.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!;
    act(() => {
      search.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    vi.useRealTimers();
    await expectNoViolations(document.body);
  });
});

describe('inputs', () => {
  it('Input: prefix, suffix, clear button, sizes, invalid and read-only', async () => {
    render(
      <TestProvider>
        <FormField label="Amount" hint="Before tax.">
          <Input prefix="search" suffix="GBP" clearable defaultValue="12" />
        </FormField>
        <FormField label="Key" error="Keys are lower case.">
          <Input size="sm" defaultValue="VIP" />
        </FormField>
        <FormField label="Reference">
          <Input size="lg" readOnly defaultValue="INC-000123" />
        </FormField>
      </TestProvider>,
    );
    typeInto(document.querySelector('input')!, '15');
    await expectNoViolations(document.body);
  });

  it('FormField: optional, a counter near and over its limit, and the inline layout', async () => {
    await audit(
      <form>
        <FormField label="Phone" optional>
          <Input type="tel" />
        </FormField>
        <FormField label="Summary" counter={{ max: 10 }}>
          <Input defaultValue="Printer is jammed again" />
        </FormField>
        <FormField label="Time zone" hint="An IANA name, like Europe/London." layout="inline">
          <Input />
        </FormField>
      </form>,
    );
  });

  it('Textarea: counter and submit shortcut, inside a field', async () => {
    await audit(
      <form>
        <FormField label="Reply" hint="Markdown is supported.">
          <Textarea counter={{ max: 500 }} submitShortcut="mod+enter" submitHint="to send" defaultValue="Thanks — on it." />
        </FormField>
        <button type="submit">Send</button>
      </form>,
    );
  });

  it('Select: with its chevron, a placeholder and an error', async () => {
    await audit(
      <FormField label="Team" error="Choose a team.">
        <Select placeholder="Choose…" options={[{ value: 'desk', label: 'Service desk' }]} />
      </FormField>,
    );
  });

  it('Checkbox: with a hidden label, as a table row uses it', async () => {
    await audit(
      <div>
        <Checkbox label="Select INC-12" labelHidden />
        <Checkbox label="Select all 50 loaded rules" labelHidden indeterminate />
        <Checkbox label="Notify the requester" description="They get an email." aria-invalid />
      </div>,
    );
  });

  it('RadioGroup: cards with icons, a disabled card and an error', async () => {
    await audit(
      <RadioGroup
        label="Who sees it"
        variant="cards"
        columns={2}
        value="team"
        onChange={() => undefined}
        error="Choose who sees it."
        options={[
          { value: 'everyone', label: 'Everyone', description: 'Requesters and agents.', icon: 'people' },
          { value: 'team', label: 'The team', description: 'Agents only.', icon: 'lock' },
          { value: 'me', label: 'Only me', icon: 'user', disabled: true },
        ]}
      />,
    );
  });

  it('Switch: sizes, the row layout, busy, disabled and with a confirmation', async () => {
    await audit(
      <div>
        <Switch label="AI triage" checked onChange={() => undefined} size="sm" />
        <Switch label="Rules engine" description="Runs rules on every change." checked={false} onChange={() => undefined} layout="row" />
        <Switch label="Nightly digest" checked disabled onChange={() => undefined} />
        <Switch
          label="Kill switch"
          labelHidden
          checked
          onChange={() => undefined}
          confirm={{ off: { title: 'Turn off AI for everyone?', confirmLabel: 'Turn off AI', tone: 'danger' } }}
        />
      </div>,
    );
  });

  it('Tabs: the segmented look', async () => {
    await audit(
      <Tabs
        label="Views"
        variant="segmented"
        items={[
          { id: 'chart', label: 'Chart', content: <p>A chart.</p> },
          { id: 'table', label: 'Table', content: <p>A table.</p> },
        ]}
      />,
    );
  });
});
