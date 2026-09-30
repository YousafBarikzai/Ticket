// @vitest-environment jsdom
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Banner } from '../Banner.js';
import { DISMISSAL_PREFIX, isDismissalKey, resetDismissals } from '../dismissal.js';
import { GlobalBanner } from '../GlobalBanner.js';
import { InlineAlert } from '../InlineAlert.js';

/*
 * Banner, GlobalBanner and InlineAlert (SPEC §4.5): icon and words together,
 * the right live-region role for how the notice arrived, actions described as
 * data, and dismissal that remembers without flashing.
 */

afterEach(() => {
  cleanupDocument();
  resetDismissals();
  window.localStorage.clear();
});

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const button = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  Array.from(root.querySelectorAll('button')).find((element) => (element.getAttribute('aria-label') ?? text(element)) === name);

describe('Banner', () => {
  it('is a polite status by default, an alert only when asked, and silent when told', () => {
    const { container } = render(
      <div>
        <Banner tone="info" title="Search is in reduced mode" />
        <Banner tone="danger" title="Couldn't publish the rule" live="assertive" />
        <Banner tone="warning" title="This policy goes live immediately" live={false} />
      </div>,
    );
    const banners = container.querySelectorAll('.itsm-Banner');
    expect(banners[0]?.getAttribute('role')).toBe('status');
    expect(banners[1]?.getAttribute('role')).toBe('alert');
    expect(banners[2]?.hasAttribute('role')).toBe(false);
  });

  it('carries the tone’s icon unless told otherwise, so colour is never the only signal', () => {
    const { container } = render(
      <div>
        <Banner tone="warning" title="a" />
        <Banner tone="success" title="b" icon="sparkles" />
        <Banner tone="danger" title="c" icon={false} />
      </div>,
    );
    const icons = Array.from(container.querySelectorAll('.itsm-Banner')).map((banner) => banner.querySelector('svg')?.getAttribute('data-icon') ?? null);
    expect(icons).toEqual(['triangle-alert', 'sparkles', null]);
  });

  it('renders an action spec: a link through the app’s Link, or a button that reports its id', () => {
    const onAction = vi.fn();
    const { container } = render(
      <TestProvider>
        <Banner tone="danger" title="Couldn't load failed deliveries" action={{ id: 'retry', label: 'Retry' }} onAction={onAction} />
        <Banner tone="info" title="A new rule is ready" action={{ id: 'view', label: 'View rule', href: '/rules/vip' }} />
      </TestProvider>,
    );
    click(button(container, 'Retry')!);
    expect(onAction).toHaveBeenCalledWith('retry');
    const link = Array.from(container.querySelectorAll('a')).find((a) => text(a) === 'View rule');
    expect(link?.getAttribute('href')).toBe('/rules/vip');
  });

  it('asks first when the action spec carries a confirmation', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <TestProvider>
        <Banner
          tone="warning"
          title="Two deliveries failed"
          action={{ id: 'discard', label: 'Discard both', confirm: { title: 'Discard both deliveries?', confirmLabel: 'Discard both', tone: 'danger' } }}
          onAction={onAction}
        />
      </TestProvider>,
    );
    await act(async () => {
      click(button(container, 'Discard both')!);
    });
    // The dialog is loaded on demand from the overlays subpath, and the first
    // load of that chunk (Radix and all) takes as long as it takes: wait for
    // it rather than for a fixed time.
    for (let waited = 0; waited < 3000 && !document.querySelector('[role="alertdialog"], [role="dialog"]'); waited += 25) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).not.toBeNull();
  });

  it('shows a state-gated action as unavailable, with its reason, and never runs it', () => {
    const onAction = vi.fn();
    const { container } = render(
      <Banner tone="neutral" title="Draft" action={{ id: 'publish', label: 'Publish', disabled: true, disabledReason: 'Needs a connection' }} onAction={onAction} />,
    );
    const publish = button(container, 'Publish')!;
    // A state gate stays focusable so its reason can be reached (SPEC §1.10, D19).
    expect(publish.disabled).toBe(false);
    expect(publish.getAttribute('aria-disabled')).toBe('true');
    const described = (publish.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Needs a connection');
    // Visible text, not a tooltip (X-80).
    expect(text(container.querySelector('.itsm-FeedbackAction__reason'))).toBe('Needs a connection');
    click(publish);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('dismisses: calls back, goes away, and hands focus to what comes next rather than the top of the page', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <div>
        <Banner tone="info" title="Tip" onDismiss={onDismiss} />
        <button type="button">Next</button>
      </div>,
    );
    const close = button(container, 'Dismiss')!;
    close.focus();
    click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.itsm-Banner')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Next');
  });

  it('remembers a dismissal on this device, across mounts and in other banners with the same key', () => {
    const first = render(<Banner tone="info" title="Keyboard shortcuts are on" dismissKey="shortcuts-tip" />);
    click(button(first.container, 'Dismiss')!);
    expect(window.localStorage.getItem(`${DISMISSAL_PREFIX}shortcuts-tip`)).not.toBeNull();
    first.unmount();

    const again = render(<Banner tone="info" title="Keyboard shortcuts are on" dismissKey="shortcuts-tip" />);
    expect(again.container.innerHTML).toBe('');
    const other = render(<Banner tone="info" title="Another tip" dismissKey="other-tip" />);
    expect(other.container.querySelector('.itsm-Banner')).not.toBeNull();
    expect(isDismissalKey(`${DISMISSAL_PREFIX}shortcuts-tip`)).toBe(true);
  });

  it('never server-renders a dismissible banner, so one already closed cannot flash on load', () => {
    expect(renderToStaticMarkup(<Banner tone="info" title="Tip" dismissKey="tip" />)).toBe('');
    expect(renderToStaticMarkup(<Banner tone="info" title="Tip" />)).toContain('Tip');
  });

  it('keeps closing when storage is blocked', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { container } = render(<Banner tone="info" title="Tip" dismissKey="blocked-tip" />);
      click(button(container, 'Dismiss')!);
      expect(container.querySelector('.itsm-Banner')).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('GlobalBanner', () => {
  it('maps live to the role, and has no close button without a dismissKey', () => {
    const { container } = render(
      <div>
        <GlobalBanner tone="warning" title="Your session ended" body="Sign in again to save changes." live="assertive" />
        <GlobalBanner tone="neutral" title="Offline" body="Showing the copy from 10:42." live={false} />
      </div>,
    );
    const [session, offline] = Array.from(container.querySelectorAll('.itsm-GlobalBanner'));
    expect(session?.getAttribute('role')).toBe('alert');
    expect(offline?.hasAttribute('role')).toBe(false);
    expect(text(session)).toBe('Your session ended Sign in again to save changes.');
    expect(button(container, 'Dismiss')).toBeUndefined();
  });

  it('runs its action: "Reload" for a new version reports its id; a link goes through the app', () => {
    const onAction = vi.fn();
    const router = testRouter();
    const { container } = render(
      <TestProvider router={router}>
        <GlobalBanner tone="info" title="A new version is ready" action={{ id: 'reload', label: 'Reload' }} onAction={onAction} />
        <GlobalBanner tone="danger" title="Major incident: email is delayed" action={{ id: 'status', label: 'Status page', href: 'https://status.example', external: true }} />
      </TestProvider>,
    );
    click(button(container, 'Reload')!);
    expect(onAction).toHaveBeenCalledWith('reload');
    const external = Array.from(container.querySelectorAll('a')).find((a) => text(a).startsWith('Status page'));
    expect(external?.getAttribute('target')).toBe('_blank');
    expect(text(external)).toContain('(opens in a new tab)');
  });

  it('can be dismissed with a dismissKey, and stays dismissed', () => {
    const view = render(<GlobalBanner tone="danger" title="Major incident" dismissKey="incident-42" />);
    click(button(view.container, 'Dismiss')!);
    expect(view.container.querySelector('.itsm-GlobalBanner')).toBeNull();
    view.unmount();
    expect(render(<GlobalBanner tone="danger" title="Major incident" dismissKey="incident-42" />).container.innerHTML).toBe('');
  });
});

describe('InlineAlert', () => {
  it('renders on the server with its tone’s icon and no live role of its own', () => {
    const html = renderToStaticMarkup(<InlineAlert tone="warning">Monthly AI budget reached</InlineAlert>);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-icon="triangle-alert"');
    expect(html).not.toContain('role=');
  });

  it('takes a role from the caller who knows how it arrived', () => {
    const html = renderToStaticMarkup(
      <InlineAlert tone="danger" role="alert" icon="circle-x">
        Couldn't draft a reply
      </InlineAlert>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-icon="circle-x"');
  });
});
