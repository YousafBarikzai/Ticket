// @vitest-environment jsdom
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Banner } from '../Banner.js';
import { bannerStyles } from '../Banner.styles.js';
import { DISMISSAL_PREFIX, isDismissalKey, resetDismissals } from '../dismissal.js';
import { GlobalBanner } from '../GlobalBanner.js';
import { globalBannerStyles } from '../GlobalBanner.styles.js';
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

/** The declarations of every top-level rule whose selector is exactly `selector`, in `css`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

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

describe('Banner v3', () => {
  it('puts a kicker over the title, in its own element, so only the kicker is set in capitals', () => {
    const { container } = render(
      <Banner tone="danger" kicker="Major incident" title="MI-0004 · VPN sign-in failures for remote staff">
        Mitigating · Next update 14:52
      </Banner>,
    );
    const content = container.querySelector('.itsm-Banner__content')!;
    expect(Array.from(content.children).map((child) => child.className)).toEqual(['itsm-Banner__kicker', 'itsm-Banner__title', 'itsm-Banner__body']);
    expect(text(content.querySelector('.itsm-Banner__kicker'))).toBe('Major incident');
    // The words are written in sentence case; the stylesheet draws the capitals.
    expect(rule(bannerStyles, '.itsm-Banner__kicker')).toContain('text-transform: uppercase;');
    expect(rule(bannerStyles, '.itsm-Banner__title')).not.toContain('text-transform');
    expect(render(<Banner tone="info" title="No kicker" />).container.querySelector('.itsm-Banner__kicker')).toBeNull();
  });

  it('takes the hold and high tones, each with its own icon', () => {
    const { container } = render(
      <div>
        <Banner tone="hold" title="Waiting on the requester" />
        <Banner tone="high" title="Raised to P2" />
      </div>,
    );
    const banners = Array.from(container.querySelectorAll('.itsm-Banner'));
    expect(banners.map((banner) => banner.getAttribute('data-tone'))).toEqual(['hold', 'high']);
    expect(banners.map((banner) => banner.querySelector('svg')?.getAttribute('data-icon'))).toEqual(['pause', 'flag']);
    expect(bannerStyles).toContain('.itsm-Banner[data-tone="hold"]');
    expect(bannerStyles).toContain('.itsm-Banner[data-tone="high"]');
  });

  it('is a 12 px card with a 40 % tone edge, 10/12/10/14 padding and a 16 px icon', () => {
    const box = rule(bannerStyles, '.itsm-Banner');
    expect(box).toContain('border-radius: var(--itsm-radius-xl);');
    expect(box).toContain('border: var(--itsm-border-hair) solid color-mix(in srgb, var(--_itsm-tone-border) 40%, transparent);');
    expect(box).toContain(
      'padding: calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) var(--itsm-space-sm) calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) calc(var(--itsm-space-sm) + var(--itsm-space-3xs));',
    );
    expect(render(<Banner tone="info" title="a" />).container.querySelector('.itsm-Banner__icon')?.getAttribute('data-size')).toBe('sm');
    // Where the person asked for more contrast, the edge takes the full tone border.
    expect(bannerStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-Banner { border-color: var(--_itsm-tone-border); }');
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

describe('GlobalBanner v3', () => {
  it('reads the kicker before the title, as one sentence', () => {
    const { container } = render(
      <GlobalBanner tone="danger" emphasis="strong" kicker="Major incident" title="Email is delayed" body="We're working on it." live={false} />,
    );
    const strip = container.querySelector<HTMLElement>('.itsm-GlobalBanner')!;
    expect(text(strip)).toBe('Major incident Email is delayed We\'re working on it.');
    expect(strip.querySelector('.itsm-GlobalBanner__text')?.firstElementChild?.className).toBe('itsm-GlobalBanner__kicker');
    expect(rule(globalBannerStyles, '.itsm-GlobalBanner__kicker')).toContain('text-transform: uppercase;');
  });

  it('marks its start with a 3 px bar in the tone, solid for a major incident', () => {
    const subtle = render(<GlobalBanner tone="warning" title="Your access changed" />).container.querySelector<HTMLElement>('.itsm-GlobalBanner')!;
    expect(subtle.dataset.emphasis).toBe('subtle');
    const strong = render(<GlobalBanner tone="danger" emphasis="strong" title="Major incident" />).container.querySelector<HTMLElement>('.itsm-GlobalBanner')!;
    expect(strong.dataset.emphasis).toBe('strong');
    const bar = rule(globalBannerStyles, '.itsm-GlobalBanner::before');
    expect(bar).toContain('inset-inline-start: 0;');
    expect(bar).toContain('inline-size: 3px;');
    expect(bar).toContain('background: var(--_itsm-tone-border);');
    expect(rule(globalBannerStyles, '.itsm-GlobalBanner[data-emphasis="strong"]::before')).toContain('background: var(--_itsm-tone-solid);');
    expect(rule(globalBannerStyles, '.itsm-GlobalBanner__inner')).toContain('min-block-size: var(--itsm-control-height-lg);');
    expect(rule(globalBannerStyles, '.itsm-GlobalBanner__inner')).toContain('padding: var(--itsm-space-xs) var(--itsm-page-gutter);');
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
