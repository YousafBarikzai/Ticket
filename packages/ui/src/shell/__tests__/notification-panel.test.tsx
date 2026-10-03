// @vitest-environment jsdom
import { act, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { NotificationCenter, resetEmergencyAnnouncement, type NotificationItem } from '../NotificationCenter.js';
import { notificationCenterStyles } from '../NotificationCenter.styles.js';
import { NOTIFICATION_SKELETON_DELAY_MS, NotificationPanel, notificationKind, sectionsOf } from '../NotificationPanel.js';

/**
 * The bell and its panel (v3 §2.15, X-M13): "Today" and "Earlier", rows that
 * are links named with their unread state, tiles toned by kind, the loading
 * placeholder that waits 200 ms, the error banner with Retry, the empty
 * state, focus back to the bell, and the phone sheet. These carry the
 * NotificationCenter cases that left `shell-parts.test.tsx` (rule 10).
 */

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

const REM = 16;

/** A `matchMedia` that answers the stylesheet's rem queries for a window `width` px wide. */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: [...query.matchAll(/\((min|max)-width:\s*([\d.]+)(rem|px)\)/g)].every(([, kind, value, unit]) => {
      const px = Number(value) * (unit === 'rem' ? REM : 1);
      return kind === 'min' ? width >= px : width <= px;
    }) && /width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  installAnnouncer(document);
  setViewport(1440);
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  resetEmergencyAnnouncement();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.itsmTheme;
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];
const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === label);

/** A row's name as a screen reader builds it: its text, `aria-hidden` parts left out. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function loaded(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

const now = Date.now();
const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();

const items: NotificationItem[] = [
  { id: 'n1', subject: 'Assigned to you: Printer jammed', eventType: 'ticket.assigned', ticketNumber: 'INC-004101', createdAt: ago(1), readAt: null },
  { id: 'n3', subject: 'Approved: Laptop', eventType: 'approval.decided', createdAt: ago(2), readAt: ago(1) },
  // A breach notice as the inbox serves it: the notifications module stores
  // the event's own type, never the key of the rule that sent it.
  { id: 'n2', subject: 'SLA breached: VPN down', eventType: 'sla.timer.breached', ticketNumber: 'INC-004102', createdAt: ago(3 * 24 * 60), readAt: null },
  { id: 'n4', subject: 'Customer replied on the VPN ticket', eventType: 'ticket.comment.added', createdAt: ago(4 * 24 * 60), readAt: ago(60) },
];

function Bell({
  emergency = false,
  unread = 2,
  load = async () => ({ items, unread: 2 }),
  markRead = vi.fn(async () => undefined),
  settingsHref,
}: Partial<Parameters<typeof NotificationCenter>[0]>): ReactNode {
  return (
    <TestProvider>
      <main>
        <h1>Home</h1>
        <NotificationCenter
          unread={unread}
          emergency={emergency}
          load={load}
          markRead={markRead}
          hrefFor={(item) => `/tickets/${item.id}`}
          {...(settingsHref ? { settingsHref } : {})}
        />
      </main>
    </TestProvider>
  );
}

async function openBell(): Promise<HTMLButtonElement> {
  const bell = q<HTMLButtonElement>('.itsm-NotificationCenter__bell')!;
  click(bell);
  await loaded();
  await settle();
  return bell;
}

/* ------------------------------------------------------------------ */

describe('the bell', () => {
  it('names the bell with its count, capped at 99+', () => {
    render(<Bell unread={140} />);
    const bell = q('.itsm-NotificationCenter__bell')!;
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 99+ unread');
    expect(bell.getAttribute('aria-haspopup')).toBe('dialog');
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(q('.itsm-NotificationCenter__count')?.textContent).toBe('99+');
  });

  it('announces an emergency once, assertively, however many bells there are', () => {
    vi.useFakeTimers();
    render(
      <>
        <Bell emergency />
        <Bell emergency />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const spokenRegion = q('[data-itsm-live-region="assertive"]')!;
    expect(spokenRegion.textContent).toContain('service level has been breached');
    expect(all('.itsm-NotificationCenter__bell').every((bell) => bell.getAttribute('aria-label')!.endsWith('urgent'))).toBe(true);
    spokenRegion.textContent = '';
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(spokenRegion.textContent).toBe('');
  });
});

describe('the panel', () => {
  it('notification panel groups by day and names unread rows', async () => {
    render(<Bell />);
    await openBell();

    const panel = q('[role="dialog"]')!;
    expect(panel.classList.contains('itsm-NotificationPanel__popover')).toBe(true);
    // The heading names the dialog, with the unread count in words.
    const title = q('.itsm-NotificationPanel__title')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id);
    expect(spoken(title).replace(/\s*,/, ',')).toBe('Notifications, 2 unread');

    expect(all('.itsm-NotificationPanel__day').map((heading) => heading.textContent)).toEqual(['Today', 'Earlier']);
    const lists = all('.itsm-NotificationPanel__list');
    expect(lists.map((list) => document.getElementById(list.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Today', 'Earlier']);

    // Rows are links, in the server's order within each day — except that an unread emergency leads its section.
    const rows = all('.itsm-NotificationPanel__item');
    expect(rows.every((row) => row.tagName === 'A')).toBe(true);
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/tickets/n1', '/tickets/n3', '/tickets/n2', '/tickets/n4']);

    // Unread is in the words as well as the dot and the weight.
    expect(spoken(rows[0]!)).toMatch(/^Assigned to you: Printer jammed, INC-004101, \d+ min ago, unread$/);
    expect(spoken(rows[1]!)).not.toContain('unread');
    expect(spoken(rows[2]!)).toMatch(/^Urgent: SLA breached: VPN down/);
    expect(spoken(rows[2]!)).toMatch(/, unread$/);
    expect(all('.itsm-NotificationPanel__item[data-unread] .itsm-NotificationPanel__dot')).toHaveLength(2);
    expect(all('.itsm-NotificationPanel__dot')).toHaveLength(2);
    // The ticket number is in the meta line, in the id style.
    expect(rows[0]!.querySelector('.itsm-NotificationPanel__meta .itsm-NotificationPanel__ref')?.textContent).toBe('INC-004101');
  });

  it('tones each row’s tile by its kind', async () => {
    render(<Bell />);
    await openBell();
    const tiles = all('.itsm-NotificationPanel__item').map((row) => {
      const tile = row.querySelector('.itsm-NotificationPanel__tile')!;
      return [row.dataset.kind, tile.getAttribute('data-tone'), tile.hasAttribute('data-solid')];
    });
    expect(tiles).toEqual([
      ['assigned', 'accent', false],
      ['approval', 'hold', false],
      ['breach', 'danger', false],
      ['reply', 'info', false],
    ]);
  });

  it('marks everything read from the header, and the bell forgets its count', async () => {
    const markRead = vi.fn(async () => undefined);
    render(<Bell markRead={markRead} />);
    const bell = await openBell();
    click(button('Mark all read')!);
    await settle();
    expect(markRead).toHaveBeenCalledWith('all');
    expect(all('.itsm-NotificationPanel__item[data-unread]')).toHaveLength(0);
    expect(button('Mark all read')).toBeUndefined();
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
  });

  it('marks one read and closes when it is followed', async () => {
    const markRead = vi.fn(async () => undefined);
    render(<Bell markRead={markRead} />);
    await openBell();
    const row = all('.itsm-NotificationPanel__item').find((link) => link.textContent?.includes('Printer jammed'))!;
    row.addEventListener('click', (event) => event.preventDefault());
    click(row);
    await settle();
    expect(markRead).toHaveBeenCalledWith('n1');
    expect(q('[role="dialog"]')).toBeNull();
    expect(q('.itsm-NotificationCenter__bell')!.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('gives focus back to the bell when Escape closes it', async () => {
    render(<Bell />);
    const bell = q<HTMLButtonElement>('.itsm-NotificationCenter__bell')!;
    focus(bell);
    await openBell();
    const first = q<HTMLElement>('.itsm-NotificationPanel__item')!;
    focus(first);
    expect(activeElement()).toBe(first);
    press(first, 'Escape');
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
    expect(activeElement()).toBe(bell);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
  });

  it('is all caught up when there is nothing', async () => {
    render(<Bell unread={0} load={async () => ({ items: [], unread: 0 })} />);
    await openBell();
    expect(q('[role="dialog"] .itsm-EmptyState')?.textContent).toContain('You’re all caught up');
    expect(button('Mark all read')).toBeUndefined();
    expect(q('.itsm-NotificationPanel__count')).toBeNull();
  });

  it('links to the notification settings when the app has a page for them, and closes on the way', async () => {
    render(<Bell settingsHref="/profile#notifications" />);
    await openBell();
    const link = [...document.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a')].find((anchor) => anchor.textContent === 'Notification settings')!;
    expect(link.getAttribute('href')).toBe('/profile#notifications');
    link.addEventListener('click', (event) => event.preventDefault());
    click(link);
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('has no settings link when the app gives none', async () => {
    render(<Bell />);
    await openBell();
    expect(q('.itsm-NotificationPanel__settings')).toBeNull();
  });

  it('is a bottom sheet on a phone, with the count beside its title', async () => {
    setViewport(390);
    render(<Bell />);
    await openBell();
    const sheet = q('[role="dialog"]')!;
    expect(sheet.classList.contains('itsm-NotificationPanel__sheet')).toBe(true);
    expect(sheet.textContent).toContain('Notifications');
    expect(sheet.querySelector('.itsm-NotificationPanel__count')?.textContent).toContain('2 unread');
    expect(all('.itsm-NotificationPanel__item')).toHaveLength(4);
    expect(button('Mark all read')).toBeDefined();
  });
});

describe('loading and errors', () => {
  function Panel({ load }: { readonly load: () => Promise<{ items: NotificationItem[]; unread: number }> }): ReactNode {
    const anchor = useRef<HTMLButtonElement>(null);
    return (
      <TestProvider>
        <button type="button" ref={anchor}>
          Bell
        </button>
        <NotificationPanel anchorRef={anchor} open onOpenChange={() => undefined} load={load} markRead={async () => undefined} hrefFor={(item) => `/t/${item.id}`} unread={0} onUnreadChange={() => undefined} />
      </TestProvider>
    );
  }

  it('shows three skeleton rows only once the load has taken 200 ms, on a busy list', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<Panel load={() => new Promise(() => undefined)} />);
    expect(q('[role="dialog"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(NOTIFICATION_SKELETON_DELAY_MS - 1);
    });
    expect(all('.itsm-NotificationPanel__skeletonRow')).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(NOTIFICATION_SKELETON_DELAY_MS).toBe(200);
    const list = q('.itsm-NotificationPanel__skeleton')!;
    expect(list.getAttribute('aria-busy')).toBe('true');
    const rows = all('.itsm-NotificationPanel__skeletonRow');
    expect(rows).toHaveLength(3);
    // Shaped like a row: a 28 px tile and two bars.
    expect(rows.every((row) => row.querySelectorAll('.itsm-Skeleton').length === 3)).toBe(true);
    expect(rows[0]!.querySelector<HTMLElement>('.itsm-Skeleton')!.style.inlineSize).toBe('28px');
  });

  it('never shows the placeholder when the answer comes quickly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let resolve: (value: { items: NotificationItem[]; unread: number }) => void = () => undefined;
    render(<Panel load={() => new Promise((done) => (resolve = done))} />);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => {
      resolve({ items, unread: 2 });
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(all('.itsm-NotificationPanel__skeletonRow')).toHaveLength(0);
    expect(all('.itsm-NotificationPanel__item')).toHaveLength(4);
  });

  it('says so in a danger banner when the list cannot load, hides Mark all read, and Retry fetches again', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { items: [], unread: 0 };
    });
    render(<Bell load={load} />);
    await openBell();
    const banner = q('[role="dialog"] .itsm-Banner')!;
    expect(banner.getAttribute('data-tone')).toBe('danger');
    expect(banner.textContent).toContain('Couldn’t load notifications');
    expect(button('Mark all read')).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);

    fail = false;
    click(button('Retry')!);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(q('[role="dialog"] .itsm-Banner')).toBeNull();
    expect(q('[role="dialog"]')?.textContent).toContain('You’re all caught up');
  });

  it('keeps what it had when a refresh fails, and says it is showing that', async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error('offline');
      return { items, unread: 2 };
    });
    render(<Bell load={load} />);
    const bell = await openBell();
    click(bell);
    await settle();
    click(bell);
    await settle();
    expect(q('[role="dialog"] .itsm-Banner')?.textContent).toContain('Showing what was loaded before.');
    expect(all('.itsm-NotificationPanel__item')).toHaveLength(4);
    expect(button('Mark all read')).toBeUndefined();
  });
});

describe('kinds and sections', () => {
  it('reads a kind from the event type, unless the item names one', () => {
    const kind = (eventType: string, override?: NotificationItem['kind']) => notificationKind({ eventType, ...(override ? { kind: override } : {}) });
    expect(kind('sla.timer.warning')).toBe('sla_warning');
    expect(kind('sla.timer.breached')).toBe('breach');
    expect(kind('sla.breached.lead')).toBe('breach');
    expect(kind('approval.requested')).toBe('approval');
    expect(kind('ticket.comment.added')).toBe('reply');
    expect(kind('incident.major.declared')).toBe('major_incident');
    expect(kind('ticket.assigned')).toBe('assigned');
    expect(kind('ticket.status.changed')).toBe('update');
    expect(kind('demo.sample', 'approval')).toBe('approval');
  });

  it('draws a major incident on the one solid tile', async () => {
    render(<Bell load={async () => ({ items: [{ id: 'mi', subject: 'MI-0004 declared: Email down', eventType: 'incident.major.declared', createdAt: ago(5), readAt: null }], unread: 1 })} />);
    await openBell();
    const tile = q('.itsm-NotificationPanel__tile')!;
    expect(tile.getAttribute('data-tone')).toBe('danger');
    expect(tile.hasAttribute('data-solid')).toBe(true);
    expect(tile.getAttribute('aria-hidden')).toBe('true');
  });

  it('splits by the reader’s calendar day, not by 24 hours', () => {
    const at = Date.parse('2026-10-03T09:00:00Z');
    const sections = sectionsOf(
      [
        { id: 'a', subject: 'a', eventType: 'x', createdAt: '2026-10-03T00:30:00Z' },
        { id: 'b', subject: 'b', eventType: 'x', createdAt: '2026-10-02T22:30:00Z' },
      ],
      'Europe/London',
      at,
    );
    // 23:30 London on 2 October is "Earlier"; 01:30 on the 3rd is "Today".
    expect(sections.map((section) => [section.label, section.items.map((item) => item.id)])).toEqual([
      ['Today', ['a']],
      ['Earlier', ['b']],
    ]);
  });
});

describe('the stylesheet', () => {
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return notificationCenterStyles.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('is a 380 px panel, radius 12, elevation md, with 56 px rows and a 6 px dot', () => {
    const popover = rule('.itsm-NotificationPanel__popover');
    expect(popover).toContain('inline-size: min(23.75rem,');
    expect(popover).toContain('border-radius: var(--itsm-radius-xl);');
    expect(popover).toContain('box-shadow: var(--itsm-elevation-md)');
    expect(rule('.itsm-NotificationPanel__item')).toContain('min-block-size: 3.5rem;');
    expect(rule('.itsm-NotificationPanel__dot')).toContain('inline-size: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));');
    expect(rule('.itsm-NotificationPanel__day')).toContain('color: var(--itsm-colour-text-muted);');
    expect(rule('.itsm-NotificationPanel__tile[data-solid]')).toContain('var(--itsm-colour-danger-solid)');
    expect(rule('.itsm-NotificationCenter__count')).toContain('background: var(--itsm-colour-danger-solid);');
  });

  it('reads only variables the tokens emit, and no colour literals', () => {
    expect(unknownVariables(notificationCenterStyles)).toEqual([]);
    expect(notificationCenterStyles).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });
});

describe('notification panel audit', () => {
  it.each(['apple', 'apple-dark'])('has no violations open with rows, in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(<Bell settingsHref="/profile" />);
    await openBell();
    await expectNoViolations(document.body);
  });

  it.each(['apple', 'apple-dark'])('has no violations in its error state, in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <Bell
        load={async () => {
          throw new Error('offline');
        }}
      />,
    );
    await openBell();
    await expectNoViolations(document.body);
  });

  it('has no violations as a phone sheet', async () => {
    setViewport(390);
    render(<Bell />);
    await openBell();
    await expectNoViolations(document.body);
  });
});
