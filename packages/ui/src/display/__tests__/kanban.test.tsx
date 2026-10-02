// @vitest-environment jsdom
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { KanbanCard, KanbanColumn } from '../Kanban.js';
import { kanbanStyles } from '../Kanban.styles.js';

/*
 * `KanbanColumn` and `KanbanCard` (v3 §2.13, A1 §7.12): the folded strip's
 * semantics ("Show Closed, 41" and the `data-folded` test hook of §7.0.1),
 * the stripe tone, the overdue chip spoken "overdue", unassigned cards, drop
 * states and axe. Both are server-safe, so most cases render them to static
 * markup with no provider, as a server component would.
 */

afterEach(() => cleanupDocument());

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The control's name as axe computes it (accessible name from content; `aria-hidden` digits left out). */
function accessibleName(element: Element): string {
  axe.setup(document);
  try {
    return axe.commons.text.accessibleText(element).trim();
  } finally {
    axe.teardown();
  }
}

function server(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  document.body.append(host);
  return host;
}

const card = (
  <KanbanCard
    href="/tickets/INC-000123"
    refId="INC-000123"
    title="Laptop will not boot after the update"
    priority="P1"
    tag="Hardware"
    assignee={{ name: 'Alex Morgan' }}
    due={{ label: 'Yesterday', overdue: true }}
    stripe="danger"
    progress={1.2}
    unread
  />
);

describe('KanbanColumn', () => {
  it('is a section with its heading, count and a list of cards named by the heading', () => {
    const host = server(
      <KanbanColumn id="in_progress" title="In progress" tone="info" icon="clock" count={12} sub="None overdue">
        {card}
      </KanbanColumn>,
    );
    const column = host.querySelector<HTMLElement>('section.itsm-KanbanColumn')!;
    expect(column.dataset.tone).toBe('info');
    expect(column.hasAttribute('data-folded')).toBe(false);
    expect(column.hasAttribute('data-drop-state')).toBe(false);
    const heading = column.querySelector('h3.itsm-KanbanColumn__title')!;
    expect(heading.textContent).toBe('In progress');
    expect(heading.id).toBe('itsm-kanban-in_progress');
    expect(column.querySelector('.itsm-KanbanColumn__head .itsm-Count')!.textContent).toBe('12, 12');
    expect(column.querySelector('.itsm-KanbanColumn__sub')!.textContent).toBe('None overdue');
    const list = column.querySelector('ul.itsm-KanbanColumn__cards')!;
    expect(list.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(list.querySelectorAll(':scope > li.itsm-KanbanCard')).toHaveLength(1);
  });

  it('makes a safe id from any column key, at the heading level asked', () => {
    const host = server(<KanbanColumn id="waiting on/others" title="Waiting" tone="hold" icon="pause" count={3} headingLevel={2} />);
    expect(host.querySelector('h2')!.id).toBe('itsm-kanban-waiting-on-others');
  });

  it('folds to a strip whose button is "Show Closed, 41", with data-folded on the column', () => {
    const onFoldedChange = vi.fn();
    const { container } = render(<KanbanColumn id="closed" title="Closed" tone="neutral" icon="archive" count={41} folded onFoldedChange={onFoldedChange} />);
    const column = container.querySelector<HTMLElement>('.itsm-KanbanColumn')!;
    expect(column.hasAttribute('data-folded')).toBe(true);
    const strip = column.querySelector('button.itsm-KanbanColumn__strip')!;
    expect(strip.getAttribute('type')).toBe('button');
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.textContent).toBe('Show Closed41, 41');
    expect(accessibleName(strip)).toBe('Show Closed, 41');
    expect(strip.querySelector('.itsm-Count__value')!.getAttribute('aria-hidden')).toBe('true');
    expect(column.querySelector('h3')).toBeNull();
    click(strip);
    expect(onFoldedChange).toHaveBeenCalledWith(false);
  });

  it('folds to a link when the board has no client to unfold it, and to a plain strip with neither', () => {
    const host = server(
      <div>
        <KanbanColumn id="resolved" title="Resolved" tone="success" icon="circle-check" count={7} folded foldHref="/inbox/mine?layout=board&open=resolved" />
        <KanbanColumn id="closed" title="Closed" tone="neutral" icon="archive" count={41} folded />
      </div>,
    );
    const [linked, plain] = [...host.querySelectorAll('.itsm-KanbanColumn')];
    const link = linked!.querySelector('a.itsm-KanbanColumn__strip')!;
    expect(link.getAttribute('href')).toBe('/inbox/mine?layout=board&open=resolved');
    expect(link.querySelector('.itsm-visually-hidden')!.textContent).toBe('Show ');
    expect(plain!.querySelector('button, a')).toBeNull();
    expect(plain!.hasAttribute('data-folded')).toBe(true);
    expect(plain!.textContent).toBe('Closed41, 41');
  });

  it('offers a "Hide" button in the header only when the board can fold it', () => {
    const onFoldedChange = vi.fn();
    const { container } = render(
      <div>
        <KanbanColumn id="resolved" title="Resolved" tone="success" icon="circle-check" count={7} onFoldedChange={onFoldedChange} />
        <KanbanColumn id="new" title="New" tone="neutral" icon="circle-dashed" count={2} />
      </div>,
    );
    const [foldable, fixed] = [...container.querySelectorAll('.itsm-KanbanColumn')];
    const hide = foldable!.querySelector<HTMLButtonElement>('button.itsm-KanbanColumn__fold')!;
    expect(hide.textContent).toBe('Hide Resolved');
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    click(hide);
    expect(onFoldedChange).toHaveBeenCalledWith(true);
    expect(fixed!.querySelector('button')).toBeNull();
  });

  it('says what an empty column holds, and draws no empty list', () => {
    const host = server(<KanbanColumn id="new" title="New" tone="neutral" icon="circle-dashed" count={0} empty="Nothing new" />);
    expect(host.querySelector('ul')).toBeNull();
    expect(host.querySelector('.itsm-KanbanColumn__empty')!.textContent).toBe('Nothing new');
  });

  it('does not draw an uncounted column as 0', () => {
    const host = server(<KanbanColumn id="closed" title="Closed" tone="neutral" icon="archive" count={null} />);
    expect(host.querySelector('.itsm-Count')).toBeNull();
  });

  it('marks drop states, and says why a refused one is refused', () => {
    const host = server(
      <div>
        <KanbanColumn id="a" title="Allowed" tone="info" icon="clock" count={1} dropState="allowed" />
        <KanbanColumn id="b" title="Blocked" tone="hold" icon="pause" count={1} dropState="blocked" />
        <KanbanColumn id="c" title="Over" tone="success" icon="circle-check" count={1} dropState="over" />
      </div>,
    );
    const [allowed, blocked, over] = [...host.querySelectorAll<HTMLElement>('.itsm-KanbanColumn')];
    expect([allowed!.dataset.dropState, blocked!.dataset.dropState, over!.dataset.dropState]).toEqual(['allowed', 'blocked', 'over']);
    expect(blocked!.querySelector('.itsm-KanbanColumn__blocked [data-icon="ban"]')).not.toBeNull();
    expect(blocked!.querySelector('.itsm-KanbanColumn__blocked')!.textContent).toBe("Can't move here");
    expect(allowed!.querySelector('.itsm-KanbanColumn__blocked')).toBeNull();
    expect(kanbanStyles).toMatch(/\.itsm-KanbanColumn\[data-drop-state="allowed"\] \{[^}]*background: var\(--itsm-colour-surface-accentHover\);/);
    expect(kanbanStyles).toMatch(/\.itsm-KanbanColumn\[data-drop-state="over"\] \{[^}]*background: var\(--itsm-colour-surface-selected\);/);
  });
});

describe('KanbanCard', () => {
  it('reads reference, priority, title, tag, assignee and due in order, with one link', () => {
    const host = server(<ul>{card}</ul>);
    const item = host.querySelector<HTMLElement>('li.itsm-KanbanCard')!;
    expect(item.querySelector('.itsm-KanbanCard__ref')!.textContent).toBe('INC-000123');
    expect(item.querySelector('.itsm-PriorityChip')!.getAttribute('data-size')).toBe('sm');
    expect(item.querySelector('.itsm-PriorityChip .itsm-visually-hidden')!.textContent).toBe('Priority 1, critical');
    const links = item.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/tickets/INC-000123');
    expect(links[0]!.textContent).toBe('Unread: Laptop will not boot after the update');
    expect(item.querySelector('.itsm-KanbanCard__unread')!.getAttribute('aria-hidden')).toBe('true');
    expect(item.querySelector('.itsm-KanbanCard__tag')!.textContent).toBe('Hardware');
    expect(item.querySelector('.itsm-KanbanCard__assignee')!.textContent).toBe('AMAlex Morgan');
  });

  it('draws the SLA stripe and the time used in the stripe’s tone, clamped to the card', () => {
    const host = server(<ul>{card}</ul>);
    const item = host.querySelector<HTMLElement>('.itsm-KanbanCard')!;
    expect(item.dataset.stripe).toBe('danger');
    expect(item.querySelector('.itsm-KanbanCard__progress')!.getAttribute('aria-hidden')).toBe('true');
    expect(item.querySelector<HTMLElement>('.itsm-KanbanCard__progressFill')!.style.inlineSize).toBe('100%');
    for (const stripe of ['success', 'warning', 'danger', 'neutral']) {
      expect(kanbanStyles).toContain(`.itsm-KanbanCard[data-stripe="${stripe}"] { --_itsm-kanban-stripe: var(--itsm-colour-${stripe}-border); }`);
    }
    expect(kanbanStyles).toMatch(/\.itsm-KanbanCard\[data-stripe\]::before \{[^}]*inset-block: var\(--itsm-space-xs\);[^}]*inline-size: 0\.1875rem;/);
  });

  it('turns a late due chip red with a clock and says "overdue"; a done one green', () => {
    const host = server(
      <ul>
        {card}
        <KanbanCard href="/t/2" refId="REQ-000002" title="Done" due={{ label: 'Today', done: true }} />
        <KanbanCard href="/t/3" refId="REQ-000003" title="Plain" due={{ label: '4 Oct' }} />
      </ul>,
    );
    const [late, done, plain] = [...host.querySelectorAll<HTMLElement>('.itsm-KanbanCard__due')];
    expect(late!.dataset.state).toBe('late');
    expect(late!.querySelector('svg')!.getAttribute('data-icon')).toBe('clock');
    expect(late!.textContent).toBe('Yesterday, overdue');
    expect(late!.closest('.itsm-KanbanCard')!.hasAttribute('data-late')).toBe(true);
    expect(done!.dataset.state).toBe('done');
    expect(done!.textContent).toBe('Today');
    expect(plain!.hasAttribute('data-state')).toBe(false);
    expect(plain!.querySelector('svg')!.getAttribute('data-icon')).toBe('calendar');
  });

  it('shows nobody as the dashed "Unassigned", and nothing when there is no assignee field', () => {
    const host = server(
      <ul>
        <KanbanCard href="/t/1" refId="INC-1" title="Nobody" assignee={null} />
        <KanbanCard href="/t/2" refId="INC-2" title="Unknown" />
      </ul>,
    );
    const [nobody, unknown] = [...host.querySelectorAll('.itsm-KanbanCard')];
    const assignee = nobody!.querySelector('.itsm-KanbanCard__assignee')!;
    expect(assignee.textContent).toBe('Unassigned');
    expect(assignee.hasAttribute('data-unassigned')).toBe(true);
    expect(assignee.querySelector('.itsm-Avatar')!.getAttribute('data-kind')).toBe('unassigned');
    expect(unknown!.querySelector('.itsm-KanbanCard__foot')).toBeNull();
  });

  it('marks selected and dragging cards, and puts the menu above the stretched link', () => {
    const host = server(
      <ul>
        <KanbanCard href="/t/1" refId="INC-1" title="Picked" selected dragging menu={<button type="button">Move INC-1 to</button>} />
      </ul>,
    );
    const item = host.querySelector<HTMLElement>('.itsm-KanbanCard')!;
    expect(item.hasAttribute('data-selected')).toBe(true);
    expect(item.hasAttribute('data-dragging')).toBe(true);
    expect(item.querySelector('.itsm-KanbanCard__menu button')!.textContent).toBe('Move INC-1 to');
    expect(kanbanStyles).toMatch(/\.itsm-KanbanCard\[data-dragging\] \{\s*opacity: 0\.45;/);
    expect(kanbanStyles).toMatch(/\.itsm-KanbanCard__menu \{\s*position: relative;\s*z-index: 1;/);
  });
});

describe('the board stylesheet', () => {
  it('edges the column with a 1px border.subtle (§2.9 card classes)', () => {
    const rule = /(?:^|\n)\s*\.itsm-KanbanColumn \{([^}]*)\}/.exec(kanbanStyles)?.[1] ?? '';
    expect(rule).toMatch(/border:\s*var\(--itsm-border-hair\)\s+solid\s+var\(--itsm-colour-border-subtle\)/);
    expect(rule).toContain('background: var(--itsm-colour-surface-raisedAlt);');
    expect(rule).toContain('border-radius: var(--itsm-radius-2xl);');
    expect(rule).toContain('min-block-size: 16.25rem;');
  });

  it('sticks a 44 px header, folds to 56 px and writes the folded title vertically', () => {
    expect(kanbanStyles).toMatch(/\.itsm-KanbanColumn__head \{[^}]*position: sticky;[^}]*min-block-size: 2\.75rem;/);
    expect(kanbanStyles).toMatch(/\.itsm-KanbanColumn\[data-folded\] \{[^}]*inline-size: 3\.5rem;/);
    expect(kanbanStyles).toMatch(/\.itsm-KanbanColumn__stripTitle \{[^}]*writing-mode: vertical-rl;/);
  });

  it('gives cards the item radius, the xs shadow, and room for the stripe', () => {
    const rule = /(?:^|\n)\.itsm-KanbanCard \{([^}]*)\}/.exec(kanbanStyles)?.[1] ?? '';
    expect(rule).toContain('border-radius: var(--itsm-radius-item);');
    expect(rule).toContain('box-shadow: var(--itsm-elevation-xs);');
    expect(rule).toContain('padding-inline: var(--itsm-space-md) var(--itsm-space-sm);');
  });

  it('reads only variables the tokens emit', () => {
    expect(unknownVariables(kanbanStyles)).toEqual([]);
  });

  it('keeps the module server-safe', () => {
    expect(readFileSync(join(SRC, 'display/Kanban.tsx'), 'utf8').startsWith("'use client'")).toBe(false);
  });
});

describe('Kanban audit', () => {
  it('has no axe violations on a board of open, folded, empty and blocked columns', async () => {
    render(
      <TestProvider>
        <h2>Board</h2>
        <div>
          <KanbanColumn id="new" title="New" tone="neutral" icon="circle-dashed" count={0} empty="Nothing new" />
          <KanbanColumn id="in_progress" title="In progress" tone="info" icon="clock" count={2} meta={<span>2 breaching</span>} onFoldedChange={() => undefined}>
            {card}
            <KanbanCard href="/t/2" refId="REQ-000002" title="Access request" priority="P3" assignee={null} due={{ label: '4 Oct' }} stripe="success" progress={0.4} />
          </KanbanColumn>
          <KanbanColumn id="waiting" title="Waiting" tone="hold" icon="pause" count={1} dropState="blocked">
            <KanbanCard href="/t/3" refId="INC-000003" title="Waiting on the vendor" priority="P4" tag="Network" selected />
          </KanbanColumn>
          <KanbanColumn id="resolved" title="Resolved" tone="success" icon="circle-check" count={7} folded foldHref="/board?open=resolved" />
          <KanbanColumn id="closed" title="Closed" tone="neutral" icon="archive" count={41} folded onFoldedChange={() => undefined} />
        </div>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });
});
