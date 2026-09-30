// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import {
  MAX_RECENTS,
  isRecentsKey,
  recentsStorageKey,
  resetRecentsForTesting,
  usePins,
  useRecents,
  useRecordRecent,
  type Pins,
  type RecentItem,
} from '../recents.js';
import { TestProvider } from './support/provider.js';

/*
 * Recents and pins (SPEC §4.1): at most eight recents per app, newest first;
 * pins "on this device"; keys and labels only, same-origin links only; never
 * a throw when storage is blocked; nothing on the server.
 */

const ticket = (n: number): RecentItem => ({ id: `t-${n}`, label: `INC-${n}`, href: `/tickets/${n}`, kind: 'ticket' });

function Visit({ item }: { item: RecentItem }): null {
  useRecordRecent(item);
  return null;
}

function Recents(): ReactElement {
  return <output>{useRecents().map((item) => item.label).join(',')}</output>;
}

let pins: Pins | null = null;
function PinList(): ReactElement {
  pins = usePins();
  return <output data-pins="">{pins.pins.map((item) => item.label).join(',')}</output>;
}

beforeEach(() => {
  localStorage.clear();
  resetRecentsForTesting();
});
afterEach(() => {
  cleanupDocument();
  localStorage.clear();
  resetRecentsForTesting();
  vi.restoreAllMocks();
  pins = null;
});

describe('recents', () => {
  it('records visits newest first, moving a repeat to the top', () => {
    const { container, rerender } = render(
      <TestProvider app="workbench">
        <Visit item={ticket(1)} />
        <Recents />
      </TestProvider>,
    );
    for (const n of [2, 3, 1]) {
      rerender(
        <TestProvider app="workbench">
          <Visit item={ticket(n)} />
          <Recents />
        </TestProvider>,
      );
    }
    expect(container.querySelector('output')!.textContent).toBe('INC-1,INC-3,INC-2');
    expect(JSON.parse(localStorage.getItem('itsm-recents:workbench')!)).toHaveLength(3);
  });

  it('keeps at most eight', () => {
    const { container, rerender } = render(<TestProvider><Recents /></TestProvider>);
    for (let n = 1; n <= 12; n++) {
      rerender(
        <TestProvider>
          <Visit item={ticket(n)} />
          <Recents />
        </TestProvider>,
      );
    }
    const labels = container.querySelector('output')!.textContent!.split(',');
    expect(labels).toHaveLength(MAX_RECENTS);
    expect(labels[0]).toBe('INC-12');
  });

  it('refuses links that leave the site, and trims what it stores to keys and labels', () => {
    const { container } = render(
      <TestProvider>
        <Visit item={{ id: 'x', label: 'Elsewhere', href: 'https://example.com/', kind: 'link' }} />
        <Visit item={{ id: 'y', label: 'Protocol-relative', href: '//example.com/', kind: 'link' }} />
        <Visit item={{ ...ticket(1), extra: 'secret' } as RecentItem} />
        <Recents />
      </TestProvider>,
    );
    expect(container.querySelector('output')!.textContent).toBe('INC-1');
    expect(localStorage.getItem('itsm-recents:admin')).not.toContain('secret');
  });

  it('keeps one person’s recents apart from the next on a shared machine', () => {
    render(
      <TestProvider storageScope="actor-1">
        <Visit item={ticket(1)} />
      </TestProvider>,
    );
    expect(localStorage.getItem('itsm-recents:admin:actor-1')).toContain('INC-1');
    expect(localStorage.getItem('itsm-recents:admin')).toBeNull();
    expect(isRecentsKey('itsm-recents:admin:actor-1')).toBe(true);
    expect(isRecentsKey(recentsStorageKey('pins', 'portal'))).toBe(true);
    expect(isRecentsKey('itsm-prefs')).toBe(false);
  });

  it('ignores stored rubbish rather than failing', () => {
    localStorage.setItem('itsm-recents:admin', '{"not":"a list"}');
    const { container } = render(<TestProvider><Recents /></TestProvider>);
    expect(container.querySelector('output')!.textContent).toBe('');
    resetRecentsForTesting();
    localStorage.setItem('itsm-recents:admin', 'not json');
    cleanupDocument();
    const again = render(<TestProvider><Recents /></TestProvider>);
    expect(again.container.querySelector('output')!.textContent).toBe('');
  });

  it('works for the page when storage refuses, and does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    const { container } = render(
      <TestProvider>
        <Visit item={ticket(1)} />
        <Recents />
      </TestProvider>,
    );
    expect(container.querySelector('output')!.textContent).toBe('INC-1');
  });

  it('renders nothing on the server, whatever this device stored', () => {
    localStorage.setItem('itsm-recents:admin', JSON.stringify([ticket(1)]));
    const html = renderToString(<TestProvider><Recents /></TestProvider>);
    expect(html).toContain('<output></output>');
  });

  it('follows another tab', () => {
    const { container } = render(<TestProvider><Recents /></TestProvider>);
    localStorage.setItem('itsm-recents:admin', JSON.stringify([ticket(7)]));
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'itsm-recents:admin' })));
    expect(container.querySelector('output')!.textContent).toBe('INC-7');
  });
});

describe('pins', () => {
  it('pins and unpins on this device, in the order pinned, without duplicates', () => {
    const { container } = render(
      <TestProvider app="workbench">
        <PinList />
      </TestProvider>,
    );
    act(() => pins!.pin(ticket(2)));
    act(() => pins!.pin(ticket(1)));
    act(() => pins!.pin(ticket(2)));
    expect(container.querySelector('[data-pins]')!.textContent).toBe('INC-2,INC-1');
    expect(pins!.isPinned('t-1')).toBe(true);
    act(() => pins!.unpin('t-2'));
    expect(container.querySelector('[data-pins]')!.textContent).toBe('INC-1');
    expect(pins!.isPinned('t-2')).toBe(false);
    expect(JSON.parse(localStorage.getItem('itsm-pins:workbench')!)).toEqual([ticket(1)]);
  });
});
