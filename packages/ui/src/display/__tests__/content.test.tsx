// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Avatar } from '../../web/Avatar.js';
import { Badge } from '../../web/Badge.js';
import { RichText } from '../../web/RichText.js';
import { Table, type TableColumn } from '../../web/Table.js';
import { tableStyles } from '../../web/Table.styles.js';
import { Tile, TileGrid } from '../../web/Tile.js';
import { AvatarStack } from '../AvatarStack.js';
import { DescriptionList } from '../DescriptionList.js';
import { Disclosure } from '../Disclosure.js';
import { disclosureStorageKey } from '../disclosure-keys.js';
import { FileChip } from '../FileChip.js';
import { Prose } from '../Prose.js';
import { StatusPill } from '../StatusPill.js';
import { Stepper } from '../Stepper.js';
import { Surface } from '../Surface.js';

afterEach(() => {
  cleanupDocument();
  window.localStorage.clear();
});

describe('server-safe display components', () => {
  it('render on the server with no provider, no hooks and no inline style', () => {
    const cases: readonly ReactElement[] = [
      <Surface>x</Surface>,
      <Badge tone="info">x</Badge>,
      <StatusPill label="Open" tone="info" />,
      <Avatar name="Ada Lovelace" status="online" />,
      <AvatarStack people={[{ name: 'Ada' }, { name: 'Grace' }, { name: 'Alan' }, { name: 'Edsger' }, { name: 'Barbara' }]} />,
      <DescriptionList items={[{ id: 'p', label: 'Priority', value: 'P2' }]} />,
      <Disclosure summary="More">x</Disclosure>,
      <Prose size="lg">x</Prose>,
      <RichText content={[{ type: 'paragraph', content: [{ text: 'x' }] }]} />,
      <Stepper label="Progress" steps={[{ id: 'a', label: 'Raised', status: 'complete' }]} />,
      <FileChip name="trace.log" size={2048} href="/files/1" />,
    ];
    for (const element of cases) {
      const html = renderToStaticMarkup(element);
      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toContain('style=');
    }
  });
});

describe('Surface', () => {
  it('renders the element asked for with its settings as attributes', () => {
    const html = renderToStaticMarkup(
      <Surface as="article" tone="outline" padding="lg" radius="3xl" elevation="md" aria-label="Summary">
        x
      </Surface>,
    );
    expect(html).toBe(
      '<article aria-label="Summary" class="itsm-Surface" data-tone="outline" data-padding="lg" data-radius="3xl" data-elevation="md">x</article>',
    );
  });

  it('defaults to a raised card-radius div with medium padding and no elevation', () => {
    expect(renderToStaticMarkup(<Surface>x</Surface>)).toBe(
      '<div class="itsm-Surface" data-tone="raised" data-padding="md" data-radius="2xl" data-elevation="none">x</div>',
    );
  });
});

describe('DescriptionList', () => {
  it('is a real dl, each pair grouped, empty values spoken as "Not set"', () => {
    const { container } = render(
      <DescriptionList
        layout="inline"
        dense
        items={[
          { id: 'p', label: 'Priority', value: 'P2', hint: 'Set by rule' },
          { id: 't', label: 'Team', value: null },
          { id: 'o', label: 'Owner', value: '' },
        ]}
      />,
    );
    const list = container.querySelector('dl')!;
    expect(list.dataset).toMatchObject({ layout: 'inline', dense: '' });
    const groups = [...list.children];
    expect(groups.map((group) => group.tagName)).toEqual(['DIV', 'DIV', 'DIV']);
    expect(groups[0]!.querySelector('dt')!.textContent).toBe('Priority');
    expect(groups[0]!.querySelector('dd')!.textContent).toBe('P2Set by rule');
    expect(groups[1]!.querySelector('dd')!.textContent).toBe('—Not set');
    expect(groups[1]!.querySelector('[aria-hidden="true"]')!.textContent).toBe('—');
    expect(groups[2]!.querySelector('.itsm-visually-hidden')!.textContent).toBe('Not set');
  });
});

describe('Disclosure', () => {
  it('is a native details element with a summary, closed unless asked', () => {
    const { container } = render(
      <div>
        <Disclosure summary="Details">Reference INC-000123</Disclosure>
        <Disclosure summary="Open" defaultOpen>
          Shown
        </Disclosure>
      </div>,
    );
    const [closed, open] = [...container.querySelectorAll('details')];
    expect(closed!.open).toBe(false);
    expect(open!.open).toBe(true);
    expect(closed!.querySelector('summary')!.textContent).toBe('Details');
    expect(closed!.querySelector('summary svg')!.getAttribute('aria-hidden')).toBe('true');
    // No persistKey, no client half.
    expect(container.querySelector('.itsm-Disclosure__memory')).toBeNull();
  });

  it('with persistKey, restores the state this device remembers and records toggles', async () => {
    window.localStorage.setItem(disclosureStorageKey('ticket.details'), 'open');
    const { container } = render(<Disclosure summary="Details" persistKey="ticket.details">Body</Disclosure>);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(true);

    details.open = false;
    await act(async () => {
      details.dispatchEvent(new Event('toggle'));
    });
    expect(window.localStorage.getItem(disclosureStorageKey('ticket.details'))).toBe('closed');
  });

  it('keeps working when storage is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { container } = render(<Disclosure summary="Details" persistKey="x" defaultOpen>Body</Disclosure>);
    expect(container.querySelector('details')!.open).toBe(true);
    getItem.mockRestore();
  });
});

describe('Prose and RichText', () => {
  it('sets reading size by attribute and styles RichText’s plain elements', () => {
    const { container } = render(
      <Prose size="lg">
        <RichText
          content={[
            { type: 'paragraph', content: [{ text: 'Restart the ' }, { text: 'VPN', bold: true }, { text: 'help', href: 'https://example.com/help' }] },
            { type: 'list', ordered: true, items: [[{ text: 'One' }], [{ text: 'Two' }]] },
          ]}
        />
      </Prose>,
    );
    const prose = container.querySelector<HTMLElement>('.itsm-Prose')!;
    expect(prose.dataset.size).toBe('lg');
    const rich = prose.querySelector('.itsm-RichText')!;
    expect(rich.querySelector('strong')!.textContent).toBe('VPN');
    expect(rich.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(rich.querySelectorAll('ol li')).toHaveLength(2);
  });
});

describe('Stepper', () => {
  it('is a labelled ordered list with the current step marked and every status spoken', () => {
    const { container } = render(
      <Stepper
        label="Request progress"
        steps={[
          { id: 'r', label: 'Received', status: 'complete', description: '28 Sept' },
          { id: 'w', label: 'Being worked on', status: 'current' },
          { id: 'y', label: 'Waiting for you', status: 'waiting' },
          { id: 'f', label: 'Approval', status: 'error' },
          { id: 's', label: 'Survey', status: 'skipped' },
          { id: 'c', label: 'Closed', status: 'upcoming' },
        ]}
      />,
    );
    const list = container.querySelector('ol[aria-label="Request progress"]')!;
    const steps = [...list.querySelectorAll('li')];
    expect(steps.map((step) => step.querySelector('.itsm-Stepper__label')!.textContent)).toEqual([
      'Received, completed',
      'Being worked on, current step',
      'Waiting for you, waiting',
      'Approval, needs attention',
      'Survey, skipped',
      'Closed, not started',
    ]);
    expect(steps.filter((step) => step.getAttribute('aria-current') === 'step').map((step) => step.dataset.status)).toEqual(['current']);
    expect(steps[0]!.querySelector('.itsm-Stepper__description')!.textContent).toBe('28 Sept');
    expect(steps[0]!.querySelector('.itsm-Stepper__track')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('carries orientation and size as attributes on its container', () => {
    const html = renderToStaticMarkup(<Stepper label="Steps" steps={[]} orientation="vertical" size="sm" />);
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain('data-size="sm"');
  });
});

describe('FileChip', () => {
  it('is one link when it can be opened, with the size, and the extension kept apart', () => {
    const { container } = render(<FileChip name="annual-report.pdf" size={1_536_000} href="/files/1" />);
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/files/1');
    expect(link.querySelector('.itsm-FileChip__base')!.textContent).toBe('annual-report');
    expect(link.querySelector('.itsm-FileChip__extension')!.textContent).toBe('.pdf');
    expect(link.textContent).toBe('annual-report.pdf, 1.5 MB');
  });

  it('is not a link until it is ready, and says why in words (X-80)', () => {
    const { container } = render(
      <div>
        <FileChip name="a.png" size={10} href="/files/a" state="scanning" />
        <FileChip name="b.png" href="/files/b" state="blocked" />
        <FileChip name="c.png" size={2048} state="unavailable" />
      </div>,
    );
    expect(container.querySelector('a')).toBeNull();
    expect([...container.querySelectorAll('.itsm-FileChip__meta')].map((meta) => meta.textContent)).toEqual([
      ', 10 bytes · , Scanning…',
      ', Blocked by the virus scan',
      ', 2 kB · , preview soon',
    ]);
  });

  it('offers a labelled remove button beside the link, never inside it', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <TestProvider>
        <FileChip name="trace.log" href="/files/1" onRemove={onRemove} />
      </TestProvider>,
    );
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Remove trace.log');
    expect(button.closest('a')).toBeNull();
    click(button);
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('Table', () => {
  type Row = { readonly id: string; readonly name: string; readonly count: number };
  const rows: Row[] = [
    { id: '1', name: 'VIP requester', count: 12 },
    { id: '2', name: 'After hours', count: 3 },
  ];
  const columns: TableColumn<Row>[] = [
    { key: 'name', header: 'Rule', cell: (row) => row.name, width: '60%' },
    { key: 'count', header: 'Matched', cell: (row) => row.count, align: 'end' },
  ];

  it('aligns by attribute and keeps inline style for widths only', () => {
    const html = renderToStaticMarkup(<Table caption="Rules" columns={columns} rows={rows} rowKey={(row) => row.id} />);
    expect(html).toContain('<th scope="col" style="inline-size:60%">');
    expect(html).toContain('<th scope="col" data-align="end">');
    expect(html).toContain('<td data-align="end">12</td>');
    expect(html).not.toContain('text-align');
    expect(html).not.toContain('cursor');
  });

  it('marks activatable rows by attribute for the pointer', () => {
    const { container } = render(
      <Table caption="Rules" columns={columns} rows={rows} rowKey={(row) => row.id} rowHandles={() => ({ onClick: () => undefined, tabIndex: -1 })} />,
    );
    expect([...container.querySelectorAll('tbody tr')].every((row) => row.hasAttribute('data-activatable'))).toBe(true);
  });

  it('shows skeleton rows while loading and its empty text when there are none', () => {
    const loading = render(<Table caption="Rules" columns={columns} rows={[]} rowKey={(row) => row.id} loading skeletonRows={2} />);
    expect(loading.container.querySelectorAll('.itsm-Table__skeletonRow')).toHaveLength(2);
    expect(loading.container.querySelector('table')!.getAttribute('aria-busy')).toBe('true');
    const empty = render(<Table caption="Rules" columns={columns} rows={[]} rowKey={(row) => row.id} empty="No rules yet" />);
    expect(empty.container.querySelector('.itsm-Table__emptyRow td')!.textContent).toBe('No rules yet');
  });

  it('never moves a row: hover is a background, so reduced motion has nothing to undo', () => {
    expect(tableStyles).not.toMatch(/transform|translate/);
    expect(tableStyles).toMatch(/tbody tr:hover \{\s*background: var\(--itsm-colour-surface-hover\);\s*\}/);
  });
});

describe('Tile', () => {
  it('is a link through the provider, named by its title and described by the rest', () => {
    const { container } = render(
      <TestProvider>
        <Tile title="Something is broken" description="Report an issue." href="/report" icon="compose" meta="Usually 2 days" badge={<Badge>New</Badge>} />
      </TestProvider>,
    );
    const tile = container.querySelector('a.itsm-Tile')!;
    expect(tile.getAttribute('href')).toBe('/report');
    const title = container.querySelector(`#${tile.getAttribute('aria-labelledby')}`)!;
    expect(title.textContent).toBe('Something is broken');
    const described = tile
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => container.querySelector(`#${id}`)!.textContent);
    expect(described).toEqual(['Report an issue.', 'Usually 2 days', 'New']);
    expect(tile.querySelector('.itsm-Tile__icon svg')!.getAttribute('data-icon')).toBe('compose');
  });

  it('is a button when it acts, and still accepts a node for its icon', () => {
    const onClick = vi.fn();
    const { container } = render(<Tile title="Dictate a request" onClick={onClick} icon={<span>+</span>} />);
    const tile = container.querySelector('button.itsm-Tile')!;
    expect(tile.getAttribute('type')).toBe('button');
    expect(tile.querySelector('.itsm-Tile__icon')!.textContent).toBe('+');
    click(tile);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lays out as many columns as asked, at most', () => {
    expect(renderToStaticMarkup(<TileGrid columns={3}>x</TileGrid>)).toBe('<div class="itsm-TileGrid" data-columns="3">x</div>');
  });
});
