// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItsmProvider } from '../../provider/ItsmProvider.js';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import type { LinkComponent } from '../../types.js';
import { Card } from '../../web/Card.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';

/*
 * Card (SPEC §4.6, §8.1 WP7): the header is a row with the actions beside the
 * title; a navigable card is a stretched link — the title is the `<a>`, the
 * heading stays a heading, nothing is nested in a button; and each card
 * loads, fails and empties on its own.
 */

afterEach(() => cleanupDocument());

describe('the header', () => {
  it('puts the icon, heading and meta, then the actions in one row, in that order', () => {
    const { container } = render(
      <Card title="Failed deliveries" subtitle="Last 24 hours" icon="webhook" meta="Updated 2 min ago" actions={<button type="button">More</button>}>
        <p>3 failed</p>
      </Card>,
    );
    const header = container.querySelector('.itsm-Card__header')!;
    expect([...header.children].map((child) => child.className)).toEqual(['itsm-Card__icon', 'itsm-Card__heading', 'itsm-Card__actions']);
    // The meta shares a wrapping row with the title block, so it can drop under it in a narrow card.
    expect([...header.querySelector('.itsm-Card__heading')!.children].map((child) => child.className)).toEqual([
      'itsm-Card__titles',
      'itsm-Card__meta',
    ]);
    expect(header.querySelector('h2')!.textContent).toBe('Failed deliveries');
    expect(header.querySelector('.itsm-Card__subtitle')!.textContent).toBe('Last 24 hours');
    expect(header.querySelector('.itsm-Card__actions button')!.textContent).toBe('More');
    expect(container.querySelector('.itsm-Card__body')!.textContent).toBe('3 failed');
  });

  it('uses the heading level asked for, h2 by default', () => {
    const { container } = render(
      <div>
        <Card title="Default">x</Card>
        <Card title="Nested" titleAs="h3">
          x
        </Card>
      </div>,
    );
    expect([...container.querySelectorAll('.itsm-Card__title')].map((heading) => heading.tagName)).toEqual(['H2', 'H3']);
  });

  it('renders as the element asked for, with Surface’s settings as attributes', () => {
    const { container } = render(
      <ul>
        <Card as="li" title="One" tone="sunken" padding="sm" radius="xl" elevation="none" headerDivider>
          x
        </Card>
      </ul>,
    );
    const card = container.querySelector<HTMLElement>('.itsm-Card')!;
    expect(card.tagName).toBe('LI');
    expect(card.classList.contains('itsm-Surface')).toBe(true);
    expect(card.dataset).toMatchObject({ tone: 'sunken', space: 'sm', radius: 'xl', elevation: 'none', divider: '' });
    expect(card.hasAttribute('style')).toBe(false);
  });

  it('has no header at all when there is nothing to put in one', () => {
    const { container } = render(<Card>Just content</Card>);
    expect(container.querySelector('.itsm-Card__header')).toBeNull();
    expect(container.querySelector('.itsm-Card')!.tagName).toBe('SECTION');
  });
});

describe('a navigable card', () => {
  it('is a stretched link: the title is the link, inside the heading, and nothing is a button', () => {
    const { container } = render(
      <TestProvider>
        <Card title="Rules" subtitle="12 live" href="/rules">
          <p>Automate routing and priorities.</p>
        </Card>
      </TestProvider>,
    );
    const card = container.querySelector<HTMLElement>('.itsm-Card')!;
    const link = card.querySelector('a')!;
    expect(card.dataset.interactive).toBe('');
    expect(link.closest('h2')).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/rules');
    expect(link.textContent).toBe('Rules');
    expect(link.classList.contains('itsm-Card__link')).toBe(true);
    expect(card.querySelectorAll('a')).toHaveLength(1);
    expect(card.querySelector('button')).toBeNull();
    // A chevron says "this goes somewhere" where there is no hover.
    expect(card.querySelector('.itsm-Card__chevron')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the link through the application’s Link', () => {
    const Link: LinkComponent = vi.fn(({ prefetch, replace, scroll, ...anchor }) => {
      void [prefetch, replace, scroll];
      return <a {...anchor} data-app-link="" />;
    });
    const { container } = render(
      <ItsmProvider
        app="admin"
        Link={Link}
        router={testRouter()}
        usePathname={() => '/'}
        useSearchParams={() => new URLSearchParams()}
        locale="en-GB"
        timeZone="Europe/London"
      >
        <Card title="Rules" href="/rules" />
      </ItsmProvider>,
    );
    expect(container.querySelector('a[data-app-link]')!.getAttribute('href')).toBe('/rules');
  });

  it('keeps its actions separately clickable, beside the title, and drops the chevron for them', () => {
    const onMore = vi.fn();
    const { container } = render(
      <Card
        title="Rules"
        href="/rules"
        actions={
          <button type="button" onClick={onMore}>
            More
          </button>
        }
      />,
    );
    click(container.querySelector('.itsm-Card__actions button')!);
    expect(onMore).toHaveBeenCalledOnce();
    expect(container.querySelector('.itsm-Card__chevron')).toBeNull();
  });

  it('is not a link without a title to be one', () => {
    const { container } = render(<Card href="/rules">Body</Card>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector<HTMLElement>('.itsm-Card')!.dataset.interactive).toBeUndefined();
  });
});

describe('states', () => {
  it('keeps its title and shows skeleton lines while loading, marked busy', () => {
    const { container } = render(
      <Card title="Failed deliveries" loading>
        <p>never shown</p>
      </Card>,
    );
    const card = container.querySelector('.itsm-Card')!;
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('h2')!.textContent).toBe('Failed deliveries');
    expect(card.querySelector('.itsm-Card__body .itsm-SkeletonText')!.getAttribute('aria-hidden')).toBe('true');
    expect(card.textContent).not.toContain('never shown');
  });

  it('shows a title bone when it has no title to keep', () => {
    const { container } = render(<Card loading />);
    expect(container.querySelector('.itsm-Card__header .itsm-Skeleton')).not.toBeNull();
  });

  it('fails on its own, inline, with the problem named after the card and a Try again', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <TestProvider>
        <Card title="Failed deliveries" problem={{ status: 503, retryable: true }} onRetry={onRetry}>
          <p>never shown</p>
        </Card>
      </TestProvider>,
    );
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Couldn't load failed deliveries");
    // One level below the card's own heading.
    expect(alert.querySelector('h3')).not.toBeNull();
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!;
    click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('never shown');
  });

  it('shows its empty state when it has nothing in it, and its content when it has', () => {
    const onAction = vi.fn();
    const empty = { title: 'No rules yet', description: 'Rules route tickets for you.', action: { id: 'new', label: 'New rule' } };
    const { container, rerender } = render(
      <TestProvider>
        <Card title="Rules" titleAs="h3" empty={empty} onAction={onAction} />
      </TestProvider>,
    );
    expect(container.querySelector('h4')!.textContent).toBe('No rules yet');
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'New rule')!);
    expect(onAction).toHaveBeenCalledWith('new');

    rerender(
      <TestProvider>
        <Card title="Rules" titleAs="h3" empty={empty}>
          <p>VIP requester</p>
        </Card>
      </TestProvider>,
    );
    expect(container.textContent).toContain('VIP requester');
    expect(container.textContent).not.toContain('No rules yet');
  });
});
