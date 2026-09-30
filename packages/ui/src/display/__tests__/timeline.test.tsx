// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { buildTimeline, Timeline, type TimelineEvent, type TimelineProps } from '../../web/Timeline.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';

/*
 * Timeline v2 (SPEC §4.6, X-68, X-73): entries are articles named "Ada, by
 * email, 09:14"; day separators and "New since your last visit" are `h3`s;
 * runs of system events fold into a `button[aria-expanded]`; internal notes
 * say so in words; the conversation variant sides messages by perspective and
 * never colours them blue; times come from `RelativeTime`, so the server HTML
 * and the first client render agree.
 */

const NOW = Date.parse('2026-09-29T12:00:00Z');

const ticket: readonly TimelineEvent[] = [
  { id: 'd', kind: 'description', timestamp: '2026-09-28T08:14:00Z', title: 'Original request', body: 'The VPN drops every hour.', actor: 'Ada Lovelace', author: 'requester', channel: 'email' },
  { id: 'r1', timestamp: '2026-09-28T09:02:00Z', title: 'Reply', body: 'Could you try the new profile?', actor: 'Sam Agent', author: 'agent', channel: 'portal' },
  { id: 's1', kind: 'event', timestamp: '2026-09-29T09:00:00Z', title: 'changed the status', actor: 'Jo Lead', from: 'New', to: 'In progress' },
  { id: 's2', kind: 'event', timestamp: '2026-09-29T09:03:00Z', title: 'set the priority to P2', actor: 'Jo Lead' },
  { id: 's3', kind: 'event', timestamp: '2026-09-29T09:05:00Z', title: 'assigned it to Network', actor: 'Jo Lead' },
  { id: 'n1', timestamp: '2026-09-29T10:02:00Z', title: 'Internal note', body: 'Probably the MTU again.', actor: 'Sam Agent', author: 'agent', visibility: 'internal' },
  { id: 'r2', timestamp: '2026-09-29T11:30:00Z', title: 'Reply', body: 'Still dropping, sorry.', actor: 'Ada Lovelace', author: 'requester', channel: 'email', attachments: [{ name: 'trace.log', size: 2048 }] },
];

function inProvider(element: ReactElement): ReactElement {
  return <TestProvider timeZone="Europe/London">{element}</TestProvider>;
}

function show(props: Partial<TimelineProps> = {}) {
  return render(inProvider(<Timeline label="Conversation" events={ticket} {...props} />));
}

function articleNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('article')].map((article) => article.getAttribute('aria-label') ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

describe('entries', () => {
  it('are articles named by who, how and when, in the reader’s time zone (X-68)', () => {
    const { container } = show({ variant: 'conversation', groupBy: 'day' });
    expect(articleNames(container)).toEqual([
      'Ada Lovelace, original request, by email, 09:14',
      'Sam Agent, by portal, 10:02',
      'Jo Lead, 10:00',
      'Jo Lead, 10:03',
      'Jo Lead, 10:05',
      'Sam Agent, internal note, 11:02',
      'Ada Lovelace, by email, 12:30',
    ]);
  });

  it('spell the date into the name when there are no day headings to give it', () => {
    const { container } = show();
    expect(articleNames(container)[0]).toMatch(/^Ada Lovelace, original request, by email, 28 Sept? 2026, 09:14$/);
  });

  it('mark an internal note three ways: the words, a lock and the tint', () => {
    const { container } = show({ variant: 'conversation' });
    const note = [...container.querySelectorAll('article')].find((article) => article.textContent?.includes('MTU'))!;
    expect(note.getAttribute('aria-label')).toContain('internal note');
    expect(note.querySelector('.itsm-Badge')!.textContent).toBe('Internal note');
    expect(note.querySelector('.itsm-Badge svg[data-icon="lock"]')).not.toBeNull();
    expect(note.querySelector('.itsm-Timeline__bubble')!.getAttribute('data-surface')).toBe('internal');
  });

  it('say a change as words, not only an arrow', () => {
    const { container } = show();
    const change = container.querySelector('.itsm-Timeline__change')!;
    expect(change.textContent).toBe('from New to In progress');
    expect(change.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('carry their attachments as file chips in a labelled list', () => {
    const { container } = show();
    const list = container.querySelector('ul[aria-label="Attachments"]')!;
    expect(list.querySelector('.itsm-FileChip')!.textContent).toContain('trace.log');
  });
});

describe('day headings', () => {
  it('are h3s: dated on the server, then Today and Yesterday in the browser', () => {
    const html = renderToString(inProvider(<Timeline label="Conversation" events={ticket} groupBy="day" />));
    expect(html).toMatch(/<h3[^>]*>Mon,? 28 Sept? 2026<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Tue,? 29 Sept? 2026<\/h3>/);

    const { container } = show({ groupBy: 'day' });
    expect([...container.querySelectorAll('.itsm-Timeline__dayHeading')].map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ['H3', 'Yesterday'],
      ['H3', 'Today'],
    ]);
  });

  it('take the level asked for', () => {
    const { container } = show({ groupBy: 'day', headingLevel: 4 });
    expect(container.querySelector('.itsm-Timeline__dayHeading')!.tagName).toBe('H4');
  });

  it('hydrate without a mismatch, with the relative words arriving after', async () => {
    const element = inProvider(<Timeline label="Conversation" events={ticket} variant="conversation" groupBy="day" collapseSystem={{ withinMinutes: 10 }} newSinceId="n1" />);
    const container = document.createElement('div');
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('.itsm-Timeline__dayHeading')!.textContent).toBe('Yesterday');
    consoleError.mockRestore();
    act(() => root!.unmount());
  });
});

describe('new since your last visit', () => {
  it('is an h3 skip-link target before the first unseen entry, with a jump link at the top', () => {
    const { container } = show({ newSinceId: 'n1', newSinceTargetId: 'ticket-new' });
    const heading = container.querySelector('#ticket-new')!;
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('New since your last visit');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    const next = heading.closest('li')!.nextElementSibling!;
    expect(next.querySelector('article')!.textContent).toContain('MTU');
    expect(container.querySelector('.itsm-Timeline__jump')!.getAttribute('href')).toBe('#ticket-new');
  });

  it('needs no jump link when the new entries start at the top', () => {
    const { container } = show({ newSinceId: 'd' });
    expect(container.querySelector('.itsm-Timeline__newHeading')).not.toBeNull();
    expect(container.querySelector('.itsm-Timeline__jump')).toBeNull();
  });

  it('derives an id when none is given, so the jump link always has a target', () => {
    const { container } = show({ newSinceId: 'r2' });
    const href = container.querySelector('.itsm-Timeline__jump')!.getAttribute('href')!;
    expect(container.querySelector(href)!.textContent).toBe('New since your last visit');
  });
});

describe('collapsed system events', () => {
  it('fold into a button that says how many and by whom, and open in place', () => {
    const { container } = show({ collapseSystem: { withinMinutes: 10 } });
    const toggle = container.querySelector<HTMLButtonElement>('.itsm-Timeline__runToggle')!;
    expect(toggle.textContent).toBe('3 updates by Jo Lead');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const list = container.querySelector(`#${toggle.getAttribute('aria-controls')}`)!;
    expect(list.hasAttribute('hidden')).toBe(true);
    expect(list.querySelectorAll('article')).toHaveLength(3);

    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(list.hasAttribute('hidden')).toBe(false);
    click(toggle);
    expect(list.hasAttribute('hidden')).toBe(true);
  });

  it('stay apart when they are further apart than the window', () => {
    const { container } = show({ collapseSystem: { withinMinutes: 1 } });
    expect(container.querySelector('.itsm-Timeline__runToggle')).toBeNull();
    expect(articleNames(container).filter((name) => name.startsWith('Jo Lead'))).toHaveLength(3);
  });
});

describe('filter and order', () => {
  it('keeps messages, notes or activity', () => {
    const texts = (filter: TimelineProps['filter']) => articleNames(show({ filter, groupBy: 'day' }).container).map((name) => name.split(',')[0]);
    expect(texts('messages')).toEqual(['Ada Lovelace', 'Sam Agent', 'Ada Lovelace']);
    cleanupDocument();
    expect(texts('notes')).toEqual(['Sam Agent']);
    cleanupDocument();
    expect(texts('activity')).toEqual(['Jo Lead', 'Jo Lead', 'Jo Lead']);
  });

  it('says so when a filter leaves nothing', () => {
    const { container } = render(inProvider(<Timeline label="History" events={ticket.slice(0, 2)} filter="notes" />));
    expect(container.querySelector('.itsm-Timeline__empty')!.textContent).toBe('No internal notes yet');
  });

  it('can put the newest first', () => {
    const { container } = show({ order: 'newest' });
    expect(articleNames(container)[0]).toMatch(/^Ada Lovelace, by email/);
    expect(articleNames(container).at(-1)).toMatch(/original request/);
  });
});

describe('the conversation variant', () => {
  it('sides the requester at the start on raised, agents at the end on sunken, notes on the warning tint (workbench)', () => {
    const { container } = show({ variant: 'conversation' });
    const placed = [...container.querySelectorAll<HTMLElement>('.itsm-Timeline__item')].map((item) => [
      item.dataset.side,
      item.querySelector('.itsm-Timeline__bubble')?.getAttribute('data-surface') ?? null,
    ]);
    expect(placed).toEqual([
      ['start', 'raised'],
      ['end', 'sunken'],
      ['center', null],
      ['center', null],
      ['center', null],
      ['end', 'internal'],
      ['start', 'raised'],
    ]);
  });

  it('puts your own messages at the end on the bubble surface and names them You (portal)', () => {
    const events: TimelineEvent[] = [
      { id: 'a', timestamp: '2026-09-29T09:00:00Z', title: 'You', body: 'Printer is jammed.', mine: true },
      { id: 'b', timestamp: '2026-09-29T09:30:00Z', title: 'The service desk', body: 'On our way.', intent: 'info' },
    ];
    const { container } = render(inProvider(<Timeline label="Conversation" events={events} variant="conversation" perspective="requester" />));
    const items = [...container.querySelectorAll<HTMLElement>('.itsm-Timeline__item')];
    expect(items.map((item) => item.dataset.side)).toEqual(['end', 'start']);
    expect(items.map((item) => item.querySelector('.itsm-Timeline__bubble')!.getAttribute('data-surface'))).toEqual(['bubble', 'raised']);
    expect(articleNames(container)[0]).toMatch(/^You, /);
    expect(articleNames(container)[1]).toMatch(/^The service desk, /);
  });

  it('never draws a message in blue: no brand or accent surface exists (X-73)', () => {
    const { container } = show({ variant: 'conversation', perspective: 'requester' });
    const surfaces = new Set([...container.querySelectorAll('.itsm-Timeline__bubble')].map((bubble) => bubble.getAttribute('data-surface')));
    for (const surface of surfaces) expect(['bubble', 'raised', 'sunken', 'internal']).toContain(surface);
  });

  it('runs a burst from one author together, dropping the repeated name but not from the article', () => {
    const events: TimelineEvent[] = [
      { id: 'a', timestamp: '2026-09-29T09:00:00Z', title: 'Reply', body: 'One.', actor: 'Ada Lovelace', author: 'requester' },
      { id: 'b', timestamp: '2026-09-29T09:02:00Z', title: 'Reply', body: 'Two.', actor: 'Ada Lovelace', author: 'requester' },
      { id: 'c', timestamp: '2026-09-29T09:30:00Z', title: 'Reply', body: 'Three.', actor: 'Ada Lovelace', author: 'requester' },
    ];
    const { container } = render(inProvider(<Timeline label="Conversation" events={events} variant="conversation" />));
    const items = [...container.querySelectorAll<HTMLElement>('.itsm-Timeline__item')];
    expect(items.map((item) => item.dataset.continued ?? null)).toEqual([null, '', null]);
    expect(items[1]!.querySelector('.itsm-Timeline__sender')).toBeNull();
    expect(items[1]!.querySelector('.itsm-Avatar')).toBeNull();
    expect(articleNames(container)[1]).toMatch(/^Ada Lovelace, /);
  });
});

describe('the thread variant with today’s callers', () => {
  it('renders the workbench’s events: one "Internal note", the tinted body, the channel in meta', () => {
    const events: TimelineEvent[] = [
      { id: '1', timestamp: '2026-09-29T11:00:00Z', title: 'Internal note', body: 'Check the MTU.', visibility: 'internal', actor: 'Sam Agent', meta: 'portal' },
      { id: '2', timestamp: '2026-09-29T11:10:00Z', title: 'status · changed', actor: 'Jo Lead' },
    ];
    const { container } = render(inProvider(<Timeline label="Ticket history" events={events} />));
    const [note, event] = [...container.querySelectorAll('article')];
    expect(note!.textContent!.match(/Internal note/g)).toHaveLength(1);
    expect(note!.querySelector('.itsm-Timeline__body--internal')!.textContent).toBe('Check the MTU.');
    expect(note!.querySelector('.itsm-Timeline__extra')!.textContent).toBe('portal');
    expect(event!.querySelector('.itsm-Timeline__glyph svg')!.getAttribute('data-icon')).toBe('history');
  });

  it('renders the portal’s messages, tinting the desk’s marker from the deprecated intent', () => {
    const events: TimelineEvent[] = [{ id: '1', timestamp: '2026-09-29T11:00:00Z', title: 'The service desk', body: 'On our way.', intent: 'info' }];
    const { container } = render(inProvider(<Timeline label="Conversation" events={events} emptyMessage="Nobody has replied yet." />));
    expect(container.querySelector('.itsm-Timeline__glyph')!.getAttribute('data-tone')).toBe('info');
    expect(container.querySelector('time')!.textContent).toBe('1 hr ago');
  });

  it('shows the empty message it is given', () => {
    const { container } = render(inProvider(<Timeline label="Conversation" events={[]} emptyMessage="Nobody has replied yet." />));
    expect(container.querySelector('.itsm-Timeline__empty')!.textContent).toBe('Nobody has replied yet.');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('has no inline style anywhere: tones are attributes', () => {
    const html = renderToString(inProvider(<Timeline label="History" events={ticket} variant="conversation" groupBy="day" />));
    expect(html).not.toContain('style=');
  });
});

describe('buildTimeline', () => {
  it('never runs across a message, the new marker or a day', () => {
    const events: TimelineEvent[] = [
      { id: 'e1', kind: 'event', timestamp: '2026-09-28T22:58:00Z', title: 'a', actor: 'Jo' },
      { id: 'e2', kind: 'event', timestamp: '2026-09-28T23:01:00Z', title: 'b', actor: 'Jo' },
      { id: 'e3', kind: 'event', timestamp: '2026-09-28T23:02:00Z', title: 'c', actor: 'Jo' },
      { id: 'm', timestamp: '2026-09-28T23:03:00Z', title: 'Reply', body: 'x', actor: 'Ada' },
      { id: 'e4', kind: 'event', timestamp: '2026-09-28T23:04:00Z', title: 'd', actor: 'Jo' },
      { id: 'e5', kind: 'event', timestamp: '2026-09-28T23:05:00Z', title: 'e', actor: 'Jo' },
      { id: 'e6', kind: 'event', timestamp: '2026-09-28T23:06:00Z', title: 'f', actor: 'Sam' },
    ];
    // 23:00 UTC is midnight in London: e1 is on the 28th there, e2 onwards on the 29th.
    const groups = buildTimeline(events, { groupBy: 'day', timeZone: 'Europe/London', collapseMinutes: 10, newSinceId: 'e5' });
    expect(groups.map((group) => group.key)).toEqual(['2026-09-28', '2026-09-29']);
    const shape = groups.map((group) =>
      group.rows.map((row) => (row.type === 'entry' ? row.event.id : row.type === 'run' ? `run(${row.events.map((event) => event.id).join(',')})` : 'new')),
    );
    expect(shape).toEqual([['e1'], ['run(e2,e3)', 'm', 'e4', 'new', 'e5', 'e6']]);
  });

  it('keeps the order it was given unless asked to sort', () => {
    const events: TimelineEvent[] = [
      { id: 'late', timestamp: '2026-09-29T11:00:00Z', title: 'x' },
      { id: 'early', timestamp: '2026-09-29T09:00:00Z', title: 'y' },
    ];
    const ids = (order?: 'oldest' | 'newest') =>
      buildTimeline(events, { order })[0]!.rows.map((row) => (row.type === 'entry' ? row.event.id : row.type));
    expect(ids()).toEqual(['late', 'early']);
    expect(ids('oldest')).toEqual(['early', 'late']);
    expect(ids('newest')).toEqual(['late', 'early']);
  });
});
