// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import type { ActionSpec } from '../../types.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { AttentionList, type AttentionItem, type AttentionTab } from '../AttentionList.js';
import { attentionListStyles } from '../AttentionList.styles.js';

/*
 * `AttentionList` and its row actions (v3 §2.13, A1 §7.4): the grid
 * columns, unassigned rows, overdue styling and the spoken "overdue", tabs
 * with counts and `aria-current`, the empty good-news state, the quick
 * actions as a client island, and axe. The list is server-safe, so most
 * cases render it the way a server component does: to static markup, with
 * no provider.
 */

afterEach(() => cleanupDocument());

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const items: readonly AttentionItem[] = [
  {
    id: 'a',
    severity: 'danger',
    ref: 'INC-000123',
    title: 'Laptop will not boot after the update',
    href: '/tickets/INC-000123',
    reason: { label: 'Breached', tone: 'danger' },
    owner: { name: 'Alex Morgan' },
    due: { label: 'Yesterday', at: '2026-10-01T15:10:00Z', overdue: true, slip: '+1d' },
    meta: 'Hardware · Alex Morgan',
  },
  {
    id: 'b',
    severity: 'warning',
    ref: 'REQ-000456',
    title: 'New starter needs SharePoint access',
    href: '/tickets/REQ-000456',
    reason: { label: 'Breaches in 43 min' },
    owner: null,
    due: { label: '16:00' },
  },
  { id: 'c', severity: 'info', title: 'Customer replied', href: '/tickets/INC-000789', reason: { label: 'Replied' } },
  { id: 'd', severity: 'neutral', ref: 'INC-000790', title: 'Printer queue stuck', href: '/tickets/INC-000790' },
];

const tabs: readonly AttentionTab[] = [
  { id: 'all', label: 'All', count: 9, href: '/overview?attention=all', current: true },
  { id: 'breached', label: 'Breached', count: 1, href: '/overview?attention=breached' },
  { id: 'unassigned', label: 'Unassigned urgent', count: null, href: '/overview?attention=unassigned' },
];

function server(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  document.body.append(host);
  return host;
}

describe('AttentionList rows', () => {
  it('renders on the server, with no provider, one list item per row and the title as its link', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    const list = host.querySelector('ul.itsm-AttentionList__rows')!;
    expect(list.getAttribute('aria-label')).toBe('Needs you');
    const rows = [...list.querySelectorAll(':scope > li.itsm-AttentionList__row')];
    expect(rows).toHaveLength(4);
    const first = rows[0]!;
    const link = first.querySelector<HTMLAnchorElement>('a.itsm-AttentionList__link')!;
    expect(link.getAttribute('href')).toBe('/tickets/INC-000123');
    expect(link.textContent).toBe('Laptop will not boot after the update');
    expect(first.querySelector('.itsm-AttentionList__ref')!.textContent).toBe('INC-000123');
    expect(first.querySelectorAll('a')).toHaveLength(1);
  });

  it('draws one cell per column in order, so the rows line up as subgrids of the list', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    for (const row of host.querySelectorAll('.itsm-AttentionList__row')) {
      expect([...row.children].map((cell) => cell.getAttribute('class')!.replace('itsm-', ''))).toEqual([
        'Icon itsm-AttentionList__severity',
        'AttentionList__ref',
        'AttentionList__main',
        'AttentionList__reason',
        'AttentionList__owner',
        'AttentionList__due',
      ]);
    }
    expect(attentionListStyles).toContain('--_itsm-attention-columns: 1.25rem minmax(5.5rem, auto) minmax(0, 1fr) auto 9.25rem 4rem;');
    expect(attentionListStyles).toMatch(/\.itsm-AttentionList__row \{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: subgrid;[^}]*min-block-size: 3\.125rem;/);
    expect(attentionListStyles).toMatch(/@supports not \(grid-template-columns: subgrid\)/);
  });

  it('adapts to its container: owner names hidden under 38.75rem, two lines under 30rem', () => {
    expect(attentionListStyles).toContain('container: itsm-attention / inline-size;');
    const medium = /@container itsm-attention \(width < 38\.75rem\) \{([\s\S]*?)\n\}/.exec(attentionListStyles)?.[1] ?? '';
    expect(medium).toContain('.itsm-AttentionList__ownerName');
    expect(medium).toContain('clip-path: inset(50%);');
    expect(medium).not.toContain('display: none');
    const narrow = /@container itsm-attention \(width < 30rem\) \{([\s\S]*?)\n\}/.exec(attentionListStyles)?.[1] ?? '';
    expect(narrow).toContain('grid-template-columns: 1.25rem minmax(0, 1fr) auto 3.25rem;');
    expect(narrow).toContain('.itsm-AttentionList__meta {\n    display: block;');
  });

  it('marks severity with its own icon', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    const icons = [...host.querySelectorAll('.itsm-AttentionList__severity')].map((icon) => icon.getAttribute('data-icon'));
    expect(icons).toEqual(['circle-alert', 'triangle-alert', 'info', 'dot']);
    expect([...host.querySelectorAll<HTMLElement>('.itsm-AttentionList__row')].map((row) => row.dataset.severity)).toEqual([
      'danger',
      'warning',
      'info',
      'neutral',
    ]);
  });

  it('draws a toned reason as a status pill and a plain one as a chip', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    const [breached, soon] = [...host.querySelectorAll('.itsm-AttentionList__reason')];
    expect(breached!.querySelector('.itsm-StatusPill')!.getAttribute('data-tone')).toBe('danger');
    expect(breached!.textContent).toBe('Breached');
    expect(soon!.querySelector('.itsm-StatusPill')).toBeNull();
    expect(soon!.querySelector('.itsm-AttentionList__chip')!.textContent).toBe('Breaches in 43 min');
  });

  it('says "Unassigned" beside a dashed avatar, in muted text and never amber', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    const [owned, nobody, absent] = [...host.querySelectorAll('.itsm-AttentionList__owner')];
    expect(owned!.textContent).toBe('AMAlex Morgan');
    expect(owned!.querySelector('.itsm-Avatar')!.getAttribute('aria-hidden')).toBe('true');
    expect(nobody!.querySelector('.itsm-Avatar')!.getAttribute('data-kind')).toBe('unassigned');
    const name = nobody!.querySelector('.itsm-AttentionList__ownerName')!;
    expect(name.textContent).toBe('Unassigned');
    expect(name.hasAttribute('data-unassigned')).toBe(true);
    expect(nobody!.innerHTML).not.toContain('warning');
    expect(attentionListStyles).toMatch(/\.itsm-AttentionList__ownerName\[data-unassigned\] \{\s*color: var\(--itsm-colour-text-muted\);/);
    expect(absent!.childElementCount).toBe(0);
  });

  it('styles an overdue row in danger with its slip, and says "overdue"', () => {
    const host = server(<AttentionList label="Needs you" items={items} />);
    const [late, onTime] = [...host.querySelectorAll<HTMLElement>('.itsm-AttentionList__row')];
    expect(late!.hasAttribute('data-overdue')).toBe(true);
    const due = late!.querySelector('.itsm-AttentionList__due')!;
    expect(due.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-01T15:10:00Z');
    expect(due.querySelector('.itsm-AttentionList__slip')!.textContent).toBe('+1d');
    expect(due.querySelector('.itsm-visually-hidden')!.textContent).toBe(', overdue');
    expect(due.textContent).toBe('Yesterday+1d, overdue');
    expect(onTime!.hasAttribute('data-overdue')).toBe(false);
    expect(onTime!.querySelector('.itsm-AttentionList__due')!.textContent).toBe('16:00');
    expect(attentionListStyles).toMatch(
      /\.itsm-AttentionList__row\[data-overdue\] \.itsm-AttentionList__due \{\s*color: var\(--itsm-colour-danger-subtleText\);\s*font-weight: var\(--itsm-font-weight-semibold\);/,
    );
  });

  it('stops at max and links to the rest', () => {
    const host = server(<AttentionList label="Needs you" items={items} max={2} moreHref="/inbox/attention" />);
    expect(host.querySelectorAll('.itsm-AttentionList__row')).toHaveLength(2);
    const more = host.querySelector<HTMLAnchorElement>('a.itsm-AttentionList__more')!;
    expect(more.getAttribute('href')).toBe('/inbox/attention');
    expect(more.textContent).toBe('Show all');
  });
});

describe('AttentionList tabs', () => {
  it('are links with counts, the current one marked with aria-current', () => {
    const host = server(<AttentionList label="Needs you" items={items} tabs={tabs} />);
    const nav = host.querySelector('nav.itsm-AttentionList__tabs')!;
    expect(nav.getAttribute('aria-label')).toBe('Needs you: filters');
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a.itsm-AttentionList__tab')];
    expect(links.map((link) => link.textContent)).toEqual(['All9, 9', 'Breached1, 1', 'Unassigned urgent']);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual(['page', null, null]);
    expect(links[0]!.querySelector('.itsm-Count')!.getAttribute('data-tone')).toBe('accent');
    expect(links[1]!.querySelector('.itsm-Count')!.getAttribute('data-tone')).toBe('neutral');
    expect(links[2]!.querySelector('.itsm-Count')).toBeNull();
  });
});

describe('AttentionList when empty', () => {
  it('is good news by default', () => {
    const host = server(<AttentionList label="Needs you" items={[]} />);
    const empty = host.querySelector<HTMLElement>('.itsm-EmptyState')!;
    expect(empty.dataset.tone).toBe('success');
    expect(empty.dataset.size).toBe('sm');
    expect(empty.querySelector('h3')!.textContent).toBe('Nothing needs attention right now');
    expect(host.querySelector('ul')).toBeNull();
  });

  it('says what the caller asks, at the heading level asked', () => {
    const host = server(
      <AttentionList label="Needs you" items={[]} headingLevel={4} empty={{ title: 'Nothing needs you right now', description: 'Checked 1 min ago' }} />,
    );
    expect(host.querySelector('h4')!.textContent).toBe('Nothing needs you right now');
    expect(host.querySelector('.itsm-EmptyState__body')!.textContent).toBe('Checked 1 min ago');
  });
});

describe('AttentionList row actions', () => {
  const actions: readonly ActionSpec[] = [
    { id: 'assign', label: 'Assign to me' },
    { id: 'open', label: 'Open', href: '/tickets/open' },
  ];

  it('draws a group per row, named for the row, and hands the chosen action back with the row', () => {
    const onAction = vi.fn();
    const { container } = render(
      <TestProvider>
        <AttentionList label="Needs you" items={items.slice(0, 2)} rowActions={actions} onAction={onAction} />
      </TestProvider>,
    );
    const groups = [...container.querySelectorAll('.itsm-AttentionList__actions')];
    expect(groups.map((group) => group.getAttribute('role'))).toEqual(['group', 'group']);
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Actions for INC-000123', 'Actions for REQ-000456']);
    const assign = [...groups[1]!.querySelectorAll('button')].find((button) => button.textContent === 'Assign to me')!;
    click(assign);
    expect(onAction).toHaveBeenCalledWith('assign', items[1]);
  });

  it('renders link actions from a server component, with no handler', () => {
    const host = server(<AttentionList label="Needs you" items={items.slice(0, 1)} rowActions={[actions[1]!]} />);
    const group = host.querySelector('.itsm-AttentionList__actions')!;
    expect(group.querySelector('a')!.getAttribute('href')).toBe('/tickets/open');
  });

  it('draws no island when there are no actions', () => {
    const host = server(<AttentionList label="Needs you" items={items} rowActions={[]} />);
    expect(host.querySelector('.itsm-AttentionList__actions')).toBeNull();
  });

  it('reveals the actions on hover and on focus within the row, and always on a coarse pointer', () => {
    expect(attentionListStyles).toMatch(/\.itsm-AttentionList__actions \{[^}]*opacity: 0;[^}]*pointer-events: none;/);
    expect(attentionListStyles).toMatch(
      /\.itsm-AttentionList__row:hover \.itsm-AttentionList__actions,\n\.itsm-AttentionList__row:focus-within \.itsm-AttentionList__actions \{\s*opacity: 1;/,
    );
    expect(attentionListStyles).toMatch(/@media \(pointer: coarse\) \{\s*\.itsm-AttentionList__actions \{[^}]*opacity: 1;/);
  });
});

describe('AttentionList modules', () => {
  it('keeps the list server-safe and the actions a client island', () => {
    const list = readFileSync(join(SRC, 'display/AttentionList.tsx'), 'utf8');
    const actions = readFileSync(join(SRC, 'display/AttentionRowActions.tsx'), 'utf8');
    expect(list.startsWith("'use client'")).toBe(false);
    expect(actions.startsWith("'use client';")).toBe(true);
  });

  it('reads only variables the tokens emit and rings the focused row in the accent', () => {
    expect(unknownVariables(attentionListStyles)).toEqual([]);
    expect(attentionListStyles).toContain(
      '.itsm-AttentionList__row:has(.itsm-AttentionList__link:focus-visible) {\n  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-border-focus);',
    );
    expect(attentionListStyles).toMatch(/\.itsm-AttentionList__row \+ \.itsm-AttentionList__row::before \{[^}]*inset-inline: var\(--itsm-space-xs\);[^}]*var\(--itsm-colour-border-divider\)/);
  });
});

describe('AttentionList audit', () => {
  it('has no axe violations with tabs, every kind of row and quick actions', async () => {
    render(
      <TestProvider>
        <section aria-labelledby="needs-you">
          <h2 id="needs-you">Needs you</h2>
          <AttentionList label="Needs you" items={items} tabs={tabs} rowActions={[{ id: 'assign', label: 'Assign to me' }]} onAction={() => undefined} moreHref="/inbox" />
        </section>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('has no axe violations when empty', async () => {
    render(
      <TestProvider>
        <section aria-labelledby="needs-you">
          <h2 id="needs-you">Needs you</h2>
          <AttentionList label="Needs you" items={[]} tabs={tabs} />
        </section>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });
});
