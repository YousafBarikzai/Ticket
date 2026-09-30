// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render, settle } from '../../web/__tests__/support/render.js';
import { useItsm, useOptionalItsm } from '../ItsmProvider.js';
import { defaultMessages, mergeMessages } from '../messages.js';
import { notify, resetNotifications, subscribeToNotifications } from '../notify.js';
import { TestProvider } from './support/provider.js';

/*
 * `ItsmProvider` (SPEC §4.1, D11): the app's context with defaults applied,
 * the announcer's regions installed, and the `Toaster` mounted lazily — on
 * the first `notify()` or when the page is idle, never on the server.
 */

// The real Toaster is the overlays package's; this one only proves it was
// mounted, with the label the provider passes, and drains the queue as the
// real one does.
vi.mock('../../overlays/Toaster.js', async () => {
  const { useEffect } = await import('react');
  const { subscribeToNotifications: subscribe } = await import('../notify.js');
  return {
    Toaster: ({ label }: { label?: string }) => {
      useEffect(() => subscribe(() => undefined), []);
      return <section data-toaster="" aria-label={label} />;
    },
  };
});

function Reader(): ReactElement {
  const context = useItsm();
  return (
    <output
      data-app={context.app}
      data-locale={context.locale}
      data-zone={context.timeZone}
      data-tooltips={String(context.features.tooltips)}
      data-single={String(context.features.singleKeyShortcuts)}
      data-close={context.messages.closeDialog}
      data-clear={context.messages.clearSearch}
    />
  );
}

beforeEach(() => resetNotifications());
afterEach(() => {
  cleanupDocument();
  resetNotifications();
  vi.useRealTimers();
});

describe('the context', () => {
  it('applies the defaults: features on in admin and the workbench, off in the portal', () => {
    const admin = render(
      <TestProvider app="admin">
        <Reader />
      </TestProvider>,
    );
    const output = admin.container.querySelector('output')!;
    expect(output.dataset).toMatchObject({ app: 'admin', locale: 'en-GB', zone: 'Europe/London', tooltips: 'true', single: 'true' });
    const portal = render(
      <TestProvider app="portal">
        <Reader />
      </TestProvider>,
    );
    expect(portal.container.querySelector('output')!.dataset).toMatchObject({ tooltips: 'false', single: 'false' });
  });

  it('lets an app switch a feature explicitly', () => {
    const { container } = render(
      <TestProvider app="portal" features={{ singleKeyShortcuts: true }}>
        <Reader />
      </TestProvider>,
    );
    expect(container.querySelector('output')!.dataset).toMatchObject({ tooltips: 'false', single: 'true' });
  });

  it('merges the app’s copy over the defaults', () => {
    const { container } = render(
      <TestProvider messages={{ closeDialog: 'Close window' }}>
        <Reader />
      </TestProvider>,
    );
    expect(container.querySelector('output')!.dataset).toMatchObject({ close: 'Close window', clear: 'Clear search' });
  });

  it('never lets a blank or unknown message through', () => {
    const merged = mergeMessages({ close: '  ', retry: 'Try that again', nonsense: 'x' } as never);
    expect(merged.close).toBe(defaultMessages.close);
    expect(merged.retry).toBe('Try that again');
    expect('nonsense' in merged).toBe(false);
  });

  it('is null to the optional reader outside the provider, and a loud error to useItsm', () => {
    function Optional(): ReactElement {
      return <output>{useOptionalItsm() === null ? 'none' : 'some'}</output>;
    }
    const { container } = render(<Optional />);
    expect(container.textContent).toBe('none');
    function Strict(): ReactElement {
      useItsm();
      return <span />;
    }
    expect(() => renderToString(<Strict />)).toThrow(/ItsmProvider/);
  });

  it('installs the live regions before anything is announced', () => {
    render(
      <TestProvider>
        <span />
      </TestProvider>,
    );
    expect(document.querySelector('[data-itsm-live-region="polite"]')).not.toBeNull();
    expect(document.querySelector('[data-itsm-live-region="assertive"]')).not.toBeNull();
  });
});

describe('the lazily mounted toaster', () => {
  it('is not rendered on the server', () => {
    const html = renderToString(
      <TestProvider>
        <span />
      </TestProvider>,
    );
    expect(html).not.toContain('data-toaster');
  });

  it('mounts on the first notify(), and receives what was queued before it', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <TestProvider messages={{ notifications: 'Alerts' }}>
        <span />
      </TestProvider>,
    );
    expect(container.querySelector('[data-toaster]')).toBeNull();
    act(() => void notify('Rule published', { tone: 'success' }));
    vi.useRealTimers();
    await settle(20);
    const toaster = container.querySelector('[data-toaster]');
    expect(toaster?.getAttribute('aria-label')).toBe('Alerts');
    // The queue was drained into the toaster: a new subscriber sees nothing waiting.
    const late: unknown[] = [];
    subscribeToNotifications((event) => late.push(event))();
    expect(late).toEqual([]);
  });

  it('mounts on its own once the page is idle', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <TestProvider>
        <span />
      </TestProvider>,
    );
    act(() => void vi.advanceTimersByTime(3000));
    vi.useRealTimers();
    await settle(20);
    expect(container.querySelector('[data-toaster]')).not.toBeNull();
  });
});

describe('notify', () => {
  it('makes a danger toast persistent unless told otherwise', () => {
    const events: unknown[] = [];
    const stop = subscribeToNotifications((event) => events.push(event));
    notify('Could not save', { tone: 'danger' });
    notify('Could not save', { tone: 'danger', duration: 8000 });
    stop();
    expect(events).toMatchObject([{ options: { duration: 'persistent' } }, { options: { duration: 8000 } }]);
  });

  it('drops a queued toast dismissed before any toaster showed it', () => {
    notify('Saving…', { id: 'save' });
    notify('Kept');
    notify.dismiss('save');
    const events: unknown[] = [];
    subscribeToNotifications((event) => events.push(event))();
    expect(events).toMatchObject([{ type: 'show', message: 'Kept' }]);
  });

  it('dismisses everything when called without an id', () => {
    const events: unknown[] = [];
    const stop = subscribeToNotifications((event) => events.push(event));
    notify.dismiss();
    stop();
    expect(events).toEqual([{ type: 'dismiss' }]);
  });
});
