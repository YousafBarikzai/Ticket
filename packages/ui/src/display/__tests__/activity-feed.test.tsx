// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { ActivityFeed, type ActivityItem } from '../ActivityFeed.js';

/*
 * ActivityFeed (SPEC §4.6): an ordered list under day `h3`s, each item a
 * sentence with the change spoken as words, new items held behind "N new ·
 * Show" (announced, never auto-inserted), times from `RelativeTime`.
 */

const NOW = Date.parse('2026-09-29T12:00:00Z');

const items: readonly ActivityItem[] = [
  {
    id: 'a',
    at: '2026-09-29T11:57:00Z',
    actor: { name: 'Jo Lead' },
    verb: 'changed the status of',
    object: { label: 'INC-000123', href: '/tickets/123' },
    from: 'New',
    to: 'In progress',
    channel: 'email',
  },
  { id: 'b', at: '2026-09-29T09:00:00Z', actor: { name: 'Rules', kind: 'system' }, verb: 'routed', object: { label: 'INC-000124' }, tone: 'success' },
  { id: 'c', at: '2026-09-28T16:00:00Z', verb: 'Delivery failed', detail: 'The endpoint answered 503.', tone: 'danger', icon: 'webhook' },
];

function inProvider(element: ReactElement): ReactElement {
  return <TestProvider timeZone="Europe/London">{element}</TestProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

describe('ActivityFeed', () => {
  it('groups items under day h3s inside one labelled ordered list', () => {
    const { container } = render(inProvider(<ActivityFeed label="Recent activity" items={items} />));
    const list = container.querySelector('ol[aria-label="Recent activity"]')!;
    const days = [...list.children].map((day) => [day.querySelector('h3')!.textContent, day.querySelectorAll('li').length]);
    expect(days).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ]);
  });

  it('reads each item as a sentence, a change as words, and a channel as a word', () => {
    const { container } = render(inProvider(<ActivityFeed label="Recent activity" items={items} groupBy="none" />));
    const first = container.querySelector('.itsm-ActivityFeed__item')!;
    expect(first.querySelector('.itsm-ActivityFeed__sentence')!.textContent).toBe('Jo Lead changed the status of INC-000123 from New to In progress');
    expect(first.querySelector('a')!.getAttribute('href')).toBe('/tickets/123');
    expect(first.querySelector('.itsm-ActivityFeed__meta')!.textContent).toBe('3 min ago · , by Email');
    expect(first.querySelector('.itsm-Avatar')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks automation with a glyph tinted by tone, and quotes a detail', () => {
    const { container } = render(inProvider(<ActivityFeed label="Recent activity" items={items} groupBy="none" />));
    const [, routed, failed] = [...container.querySelectorAll<HTMLElement>('.itsm-ActivityFeed__item')];
    expect(routed!.dataset.tone).toBe('success');
    expect(routed!.querySelector('svg')!.getAttribute('data-icon')).toBe('bot');
    expect(failed!.querySelector('.itsm-ActivityFeed__glyph svg')!.getAttribute('data-icon')).toBe('webhook');
    expect(failed!.querySelector('.itsm-ActivityFeed__detail')!.textContent).toBe('The endpoint answered 503.');
  });

  it('shows the first max items and a link to the rest', () => {
    const { container } = render(inProvider(<ActivityFeed label="Recent activity" items={items} max={2} viewAllHref="/audit" />));
    expect(container.querySelectorAll('.itsm-ActivityFeed__item')).toHaveLength(2);
    const all = container.querySelector('.itsm-ActivityFeed__allLink')!;
    expect(all.textContent).toBe('View all activity');
    expect(all.getAttribute('href')).toBe('/audit');
  });

  it('shows its empty state, with the default words when given none', () => {
    const { container } = render(inProvider(<ActivityFeed label="Recent activity" items={[]} />));
    expect(container.querySelector('.itsm-EmptyState h3')!.textContent).toBe('No activity yet');
    cleanupDocument();
    const custom = render(inProvider(<ActivityFeed label="Recent activity" items={[]} empty={{ title: 'Quiet so far' }} />));
    expect(custom.container.textContent).toContain('Quiet so far');
  });

  it('holds new items behind "N new · Show", announces them, and moves focus to the list after', () => {
    function Live(): ReactElement {
      const [shown, setShown] = useState<readonly ActivityItem[]>(items.slice(1));
      const [pending, setPending] = useState(1);
      return (
        <ActivityFeed
          label="Recent activity"
          items={shown}
          newCount={pending}
          onShowNew={() => {
            setShown(items);
            setPending(0);
          }}
        />
      );
    }
    const { container } = render(inProvider(<Live />));
    expect(container.querySelector('[role="status"]')!.textContent).toBe('1 new update');
    const show = container.querySelector<HTMLButtonElement>('.itsm-ActivityFeed__show')!;
    expect(show.textContent).toBe('1 new update,·Show');
    expect(container.querySelectorAll('.itsm-ActivityFeed__item')).toHaveLength(2);

    show.focus();
    click(show);
    expect(container.querySelectorAll('.itsm-ActivityFeed__item')).toHaveLength(3);
    expect(container.querySelector('.itsm-ActivityFeed__show')).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    expect(document.activeElement).toBe(container.querySelector('ol[aria-label="Recent activity"]'));
  });

  it('renders on the server with absolute times, so the first client render agrees', () => {
    const html = renderToString(inProvider(<ActivityFeed label="Recent activity" items={items} />));
    expect(html).not.toContain('ago');
    expect(html).toMatch(/<h3[^>]*>Tue,? 29 Sept? 2026<\/h3>/);
  });
});
