// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDocument, press, render } from './support/render.js';
import { expectNoViolations } from './support/audit.js';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Input,
  RadioGroup,
  Select,
  Switch,
  Table,
  Tile,
  TileGrid,
  Metric,
  MetricGrid,
  Tabs,
  Textarea,
  Timeline,
} from '../index.js';

/**
 * Every component, read by a rule engine.
 *
 * The hand-written tests in this package assert the properties somebody thought
 * to assert. This one asserts the ones nobody did — an icon-only control with no
 * name, an `aria-labelledby` pointing at an id that no longer exists, a listbox
 * whose options are not its children, two elements sharing an id after a
 * re-render. Those survive review because the component looks right on screen,
 * and they are exactly what axe finds without being asked.
 *
 * Each case renders the component the way an application actually uses it. A
 * fixture contrived to pass is worth nothing: the point is to check the shape
 * that ships, including the awkward states — a field in error, a table that
 * sorts, a dialog that is open.
 *
 * What axe cannot see in jsdom, and what covers it instead, is in
 * `support/audit.ts`. The short version: colour contrast is computed from the
 * tokens themselves in `tokens/__tests__/contrast.test.ts`, which is a stronger
 * test than axe could run in a browser, and page-level rules belong to an
 * application rather than to a component rendered into a bare div.
 */

afterEach(() => cleanupDocument());

describe('controls', () => {
  it('a button, including the busy state that replaces its label', async () => {
    const { container } = render(
      <div>
        <Button>Save</Button>
        <Button variant="secondary" loading loadingLabel="Saving">
          Save
        </Button>
        <Button disabled>Unavailable</Button>
      </div>,
    );
    await expectNoViolations(container);
  });

  it('an icon-only button, which is the most common 4.1.2 failure there is', async () => {
    const { container } = render(<IconButton label="Close" icon={<svg aria-hidden="true" />} />);
    await expectNoViolations(container);
  });

  it('a switch, whose role carries its state', async () => {
    const { container } = render(
      <div>
        <Switch label="Email me about this ticket" checked onChange={() => undefined} />
        <Switch label="Also text me" checked={false} onChange={() => undefined} description="Standard rates apply." />
      </div>,
    );
    await expectNoViolations(container);
  });

  it('a checkbox, including the indeterminate state a table header uses', async () => {
    const { container } = render(
      <div>
        <Checkbox label="Include closed tickets" />
        <Checkbox label="Select all" indeterminate />
        <Checkbox label="Notify the requester" description="They receive an email immediately." />
      </div>,
    );
    await expectNoViolations(container);
  });

  it('a radio group built from divs rather than inputs', async () => {
    const { container } = render(
      <RadioGroup
        label="Priority"
        options={[
          { value: 'P1', label: 'Critical' },
          { value: 'P2', label: 'High' },
          { value: 'P3', label: 'Normal', description: 'The default for a new ticket.' },
        ]}
        value="P3"
        onChange={() => undefined}
      />,
    );
    await expectNoViolations(container);
  });

  it('a select with grouped options and a placeholder', async () => {
    const { container } = render(
      <FormField label="Assign to">
        {(control) => (
          <Select
            {...control}
            placeholder="Nobody yet"
            options={[
              { label: 'Service Desk', options: [{ value: 'u1', label: 'Sam Agent' }] },
              { value: 'u2', label: 'Jo Resolver' },
            ]}
          />
        )}
      </FormField>,
    );
    await expectNoViolations(container);
  });

  it('a combobox, which is a listbox this package builds by hand', async () => {
    const { container } = render(
      <Combobox
        value={null}
        onChange={() => undefined}
        placeholder="Search people"
        options={[
          { value: 'u1', label: 'Sam Agent', description: 'Service Desk' },
          { value: 'u2', label: 'Jo Resolver' },
        ]}
      />,
    );
    await expectNoViolations(container);
  });

  it('a combobox with its list open, which is when the ARIA actually matters', async () => {
    const { container } = render(
      <Combobox
        aria-label="Assign to"
        value={null}
        onChange={() => undefined}
        options={[
          { value: 'u1', label: 'Sam Agent' },
          { value: 'u2', label: 'Jo Resolver' },
        ]}
      />,
    );
    const input = container.querySelector('input');
    if (input) press(input, 'ArrowDown');
    await expectNoViolations(container);
  });

  /**
   * A combobox can be named three ways — an `id` matched by a `<label for>`
   * (what `FormField` does, and what the only production caller uses), an
   * `aria-label`, or an `aria-labelledby`. All three are optional props, so a
   * combobox with none of them compiles and renders and has no accessible
   * name at all. `IconButton` in this same package makes that impossible by
   * making its `label` required; `Combobox` cannot, because `id` only makes a
   * label *possible* rather than guaranteeing one exists.
   *
   * So the audit is the enforcement, and this test is what makes that claim
   * true rather than hopeful. It found this on its first run — with a
   * `placeholder` masking it in the closed state, which is a name that
   * vanishes the moment somebody types.
   */
  it('catches a combobox that was given no name at all', async () => {
    const { container } = render(
      <Combobox value={null} onChange={() => undefined} options={[{ value: 'u1', label: 'Sam Agent' }]} />,
    );
    const input = container.querySelector('input');
    if (input) press(input, 'ArrowDown');

    const failure = await expectNoViolations(container).catch((error: Error) => error.message);
    expect(failure).toContain('label');
  });
});

describe('fields, including the states a form is usually screenshotted without', () => {
  it('a field carrying a hint', async () => {
    const { container } = render(
      <FormField label="Summary" hint="One line. The detail goes below.">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    await expectNoViolations(container);
  });

  it('a required field in error, wired to its message', async () => {
    const { container } = render(
      <FormField label="Summary" required error="Give the ticket a summary.">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    await expectNoViolations(container);
  });

  it('a textarea with a visually hidden label', async () => {
    const { container } = render(
      <FormField label="Reply" labelHidden hint="Markdown is supported.">
        {(control) => <Textarea {...control} />}
      </FormField>,
    );
    await expectNoViolations(container);
  });

  it('two fields at once, because duplicate ids only appear in pairs', async () => {
    const { container } = render(
      <form>
        <FormField label="Summary" error="Required.">
          {(control) => <Input {...control} />}
        </FormField>
        <FormField label="Description" hint="What happened?">
          {(control) => <Textarea {...control} />}
        </FormField>
      </form>,
    );
    await expectNoViolations(container);
  });
});

describe('structure', () => {
  const rows = [
    { id: 't-1', number: 'INC-1', title: 'VPN will not connect', priority: 'P2' },
    { id: 't-2', number: 'INC-2', title: 'Printer is jammed', priority: 'P4' },
  ];
  const columns = [
    { key: 'number', header: 'Ticket', cell: (row: (typeof rows)[number]) => row.number, sortable: true },
    { key: 'title', header: 'Summary', cell: (row: (typeof rows)[number]) => row.title },
    { key: 'priority', header: 'Priority', cell: (row: (typeof rows)[number]) => <Badge srPrefix="Priority">{row.priority}</Badge> },
  ];

  it('a sortable table', async () => {
    const { container } = render(
      <Table
        caption="Open tickets"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ columnKey: 'number', direction: 'ascending' }}
        onSortChange={() => undefined}
      />,
    );
    await expectNoViolations(container);
  });

  it('a grid, which is what the table becomes when rows are activatable', async () => {
    const { container } = render(
      <Table caption="Queue" columns={columns} rows={rows} rowKey={(row) => row.id} onRowActivate={() => undefined} />,
    );
    await expectNoViolations(container);
  });

  it('an empty table, whose empty state is inside the grid', async () => {
    const { container } = render(<Table caption="Queue" columns={columns} rows={[]} rowKey={(row) => row.id} />);
    await expectNoViolations(container);
  });

  it('a tile, which is a whole-surface target rather than a card with a link in it', async () => {
    const { container } = render(
      <TileGrid>
        <Tile title="Access and accounts" description="Passwords, permissions, joining a team" href="/catalogue/access" />
        <Tile title="Devices and equipment" description="Laptops, phones, screens, anything that plugs in" href="/catalogue/devices" />
        <Tile title="Something else" description="Tell us in your own words and we will route it" href="/catalogue" />
      </TileGrid>,
    );
    await expectNoViolations(container);
  });

  it('a tile with a decorative icon, which must not be announced twice', async () => {
    const { container } = render(<Tile title="New request" description="Start here" icon={<span>+</span>} href="/new" />);
    await expectNoViolations(container);
  });

  it('a tile that acts rather than navigates, so it is a button', async () => {
    const { container } = render(<Tile title="Dictate a request" onClick={() => undefined} />);
    await expectNoViolations(container);
  });

  it('metrics, including the tones that must not carry the meaning alone', async () => {
    const { container } = render(
      <MetricGrid>
        <Metric label="Open tickets" value="128" note="12 more than yesterday" tone="bad" />
        <Metric label="Breaching SLA" value="3" note="Two fewer than yesterday" tone="good" />
        <Metric label="Unassigned" value="7" note="Longest waiting 2 hours" />
        <Metric label="Awaiting approval" value="4" href="/approvals" />
      </MetricGrid>,
    );
    await expectNoViolations(container);
  });

  it('tabs and their panel', async () => {
    const { container } = render(
      <Tabs
        label="Ticket detail sections"
        items={[
          { id: 'activity', label: 'Activity', content: <p>Nothing yet.</p> },
          { id: 'related', label: 'Related', content: <p>No links.</p> },
        ]}
      />,
    );
    await expectNoViolations(container);
  });

  it('a timeline, and the empty one', async () => {
    const { container } = render(
      <div>
        <Timeline
          label="Ticket history"
          events={[
            { id: 'e1', timestamp: new Date().toISOString(), title: 'Created', actor: 'Ada Requester' },
            {
              id: 'e2',
              timestamp: new Date().toISOString(),
              title: 'Assigned',
              actor: 'Sam Agent',
              body: 'Taken from the queue.',
            },
          ]}
        />
        <Timeline label="Empty history" events={[]} />
      </div>,
    );
    await expectNoViolations(container);
  });

  it('an empty state, including the error tone that is a live region', async () => {
    const { container } = render(
      <div>
        <EmptyState title="Nothing here" description="No open ticket matches this view." />
        <EmptyState
          tone="error"
          title="This queue could not be loaded"
          description="The API could not be reached."
          action={<Button variant="secondary">Try again</Button>}
        />
      </div>,
    );
    await expectNoViolations(container);
  });
});

describe('a dialog, which renders outside its container', () => {
  it('passes with its title, description and footer wired', async () => {
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="Close this ticket?"
        description="The requester is told when a ticket is closed."
        footer={<Button>Close ticket</Button>}
      >
        <p>This cannot be undone from the portal.</p>
      </Dialog>,
    );
    // Audited from the document, not the container: a dialog portals to the
    // body, so a container-scoped audit would pass by finding nothing.
    await expectNoViolations(document.body);
  });

  it('passes as an alertdialog, which is what a destructive confirmation uses', async () => {
    render(
      <Dialog open role="alertdialog" dismissible={false} onClose={() => undefined} title="Discard your draft?">
        <p>Your reply has not been sent.</p>
      </Dialog>,
    );
    await expectNoViolations(document.body);
  });
});

describe('the audit itself', () => {
  it('fails on a violation, so a passing suite means something', async () => {
    // Without this, every test above would pass just as happily against an
    // audit that never looked. A button whose only content is an image with no
    // alternative text has no accessible name.
    const { container } = render(
      <button type="button">
        <img src="/close.png" />
      </button>,
    );
    await expect(expectNoViolations(container)).rejects.toThrow(/accessibility violation/);
  });

  it('names the rule and points at the element', async () => {
    const { container } = render(
      <button type="button">
        <img src="/close.png" />
      </button>,
    );
    const failure = await expectNoViolations(container).catch((error: Error) => error.message);
    expect(failure).toContain('image-alt');
    expect(failure).toContain('https://dequeuniversity.com');
  });
});
