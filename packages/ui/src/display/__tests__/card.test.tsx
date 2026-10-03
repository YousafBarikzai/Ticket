// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItsmProvider } from '../../provider/ItsmProvider.js';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import type { LinkComponent } from '../../types.js';
import { Card } from '../../web/Card.js';
import { cardStyles } from '../../web/Card.styles.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { surfaceStyles } from '../Surface.styles.js';

/*
 * Card (SPEC §4.6, §8.1 WP7; v3 §2.13): the header is a row with the actions
 * beside the title; a navigable card is a stretched link — the title is the
 * `<a>`, the heading stays a heading, nothing is nested in a button; each
 * card loads, fails and empties on its own. v3 adds the headline, the ⓘ, the
 * foot's caption and link, and bleeding children, on a border-first card.
 */

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.itsmTheme;
});

/** Every rule in `sheet` whose selector list is exactly `selector`, joined. */
function rule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sheet.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

describe('the header', () => {
  it('puts the icon, heading and meta, then the actions in one row, in that order', () => {
    const { container } = render(
      <Card title="Failed deliveries" subtitle="Last 24 hours" icon="webhook" meta="Updated 2 min ago" actions={<button type="button">More</button>}>
        <p>3 failed</p>
      </Card>,
    );
    const header = container.querySelector('.itsm-Card__header')!;
    expect([...header.children].map((child) => child.className)).toEqual(['itsm-IconTile itsm-Card__icon', 'itsm-Card__heading', 'itsm-Card__actions']);
    // The icon is a 28 px accent tile, decoration beside the title.
    expect(header.querySelector('.itsm-Card__icon')?.getAttribute('data-size')).toBe('28');
    expect(header.querySelector('.itsm-Card__icon')?.getAttribute('data-tone')).toBe('accent');
    expect(header.querySelector('.itsm-Card__icon')?.getAttribute('aria-hidden')).toBe('true');
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

  it('rests with no elevation by default: v3 depth is border-first', () => {
    const { container } = render(<Card title="Rules">x</Card>);
    const card = container.querySelector<HTMLElement>('.itsm-Card')!;
    expect(card.dataset).toMatchObject({ tone: 'raised', space: 'lg', radius: '2xl', elevation: 'none' });
    expect(card.hasAttribute('data-bleed')).toBe(false);
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

describe('v3 head and foot', () => {
  it('puts the headline 2 px under the title, inside the title block, before any subtitle', () => {
    const { container } = render(
      <Card title="Raised vs resolved" headline="Resolved 412, raised 398: the backlog fell by 14" subtitle="Last 30 days">
        x
      </Card>,
    );
    const titles = container.querySelector('.itsm-Card__titles')!;
    expect([...titles.children].map((child) => child.className)).toEqual(['itsm-Card__titleRow', 'itsm-Card__headline', 'itsm-Card__subtitle']);
    expect(titles.querySelector('.itsm-Card__headline')?.textContent).toBe('Resolved 412, raised 398: the backlog fell by 14');
    expect(titles.querySelector('.itsm-Card__headline')?.tagName).toBe('P');
  });

  it('draws an ⓘ after the title, named "About {title}", outside the heading', () => {
    const { container } = render(
      <Card title="Backlog" info={{ title: 'Backlog', body: 'Open tickets in your teams.', source: 'Open tickets, now' }}>
        x
      </Card>,
    );
    const button = container.querySelector<HTMLButtonElement>('.itsm-Card__titleRow > button.itsm-Card__info')!;
    expect(button.getAttribute('aria-label')).toBe('About Backlog');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(container.querySelector('h2')?.textContent).toBe('Backlog');
    expect(container.querySelector('h2 button')).toBeNull();
  });

  it('takes the ⓘ as plain words too', () => {
    const { container } = render(<Card title="Due today" info="Open tickets whose deadline is before midnight." />);
    expect(container.querySelector('.itsm-Card__info')?.getAttribute('aria-label')).toBe('About Due today');
  });

  it('puts the caption at the start of the foot and the foot link, with its arrow, at the end', () => {
    const { container } = render(
      <TestProvider>
        <Card title="Raised vs resolved" caption="Europe/London · last 30 days" footer={<span>Updated 2 min ago</span>} footerLink={{ href: '/insights', label: 'Open trends' }}>
          x
        </Card>
      </TestProvider>,
    );
    const foot = container.querySelector('.itsm-Card__footer')!;
    expect([...foot.children].map((child) => child.className)).toEqual(['itsm-Card__caption', '', 'itsm-Card__footerLink']);
    expect(foot.querySelector('.itsm-Card__caption')?.textContent).toBe('Europe/London · last 30 days');
    const link = foot.querySelector<HTMLAnchorElement>('a.itsm-Card__footerLink')!;
    expect(link.getAttribute('href')).toBe('/insights');
    expect(link.textContent).toBe('Open trends');
    const arrow = link.querySelector('svg')!;
    expect(arrow.getAttribute('data-icon')).toBe('arrow-right');
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(arrow.hasAttribute('data-directional')).toBe(true);
  });

  it('has no foot when there is nothing to put in one', () => {
    const { container } = render(<Card title="Rules">x</Card>);
    expect(container.querySelector('.itsm-Card__footer')).toBeNull();
  });

  it('marks a bleeding card, whose data-bleed children run to its edges', () => {
    const { container } = render(
      <Card title="Open tickets" bleed>
        <table data-bleed="">
          <tbody>
            <tr>
              <td>INC-000123</td>
            </tr>
          </tbody>
        </table>
      </Card>,
    );
    expect(container.querySelector<HTMLElement>('.itsm-Card')!.dataset.bleed).toBe('');
    expect(container.querySelector('.itsm-Card__body > table[data-bleed]')).not.toBeNull();
  });

  it('renders on the server, as Next renders every client component', () => {
    const markup = renderToStaticMarkup(
      <TestProvider>
        <Card title="Backlog" icon="inbox" info="Open tickets." headline="Down 4 this week" caption="Now" footerLink={{ href: '/inbox', label: 'Open the inbox' }} bleed>
          x
        </Card>
      </TestProvider>,
    );
    expect(markup).toContain('itsm-Card__headline');
    expect(markup).toContain('data-bleed=""');
  });
});

describe('v3 card rules', () => {
  it('declares the 1 px border.subtle edge, the v3 padding and the container on the card rule itself', () => {
    const card = rule(cardStyles, '.itsm-Card');
    expect(card).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle)');
    expect(card).toContain('--_itsm-card-pad: var(--itsm-card-padding)');
    expect(card).toContain('container: itsm-card / inline-size');
  });

  it('tightens to 16 px in a card narrower than 35 rem, whatever the window', () => {
    expect(cardStyles).toMatch(/@container itsm-card \(width < 35rem\) \{\s*\.itsm-Card\[data-space="lg"\] > :is\(\.itsm-Card__header, \.itsm-Card__body, \.itsm-Card__footer\) \{\s*--_itsm-card-pad: var\(--itsm-space-md\);/);
  });

  it('sets the title in title3 and the headline 500 13/20 in text.secondary', () => {
    for (const part of ['family', 'size', 'line', 'weight', 'tracking', 'word-spacing']) expect(rule(cardStyles, '.itsm-Card__title')).toContain(`var(--itsm-text-title3-${part})`);
    const headline = rule(cardStyles, '.itsm-Card__headline');
    expect(headline).toContain('color: var(--itsm-colour-text-secondary)');
    expect(headline).toContain('font-size: var(--itsm-text-callout-size)');
    expect(headline).toContain('font-weight: var(--itsm-font-weight-medium)');
  });

  it('starts the body 16 under the head and sets the foot off with a border.divider rule', () => {
    expect(rule(cardStyles, '.itsm-Card__header + .itsm-Card__body')).toContain('padding-block-start: var(--itsm-space-md)');
    const foot = rule(cardStyles, '.itsm-Card__footer');
    expect(foot).toContain('border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-divider)');
    expect(foot).toContain('padding-block: var(--itsm-space-sm) var(--_itsm-card-pad)');
    expect(rule(cardStyles, '.itsm-Card__body + .itsm-Card__footer')).toContain('margin-block-start: calc(var(--itsm-space-md) - var(--_itsm-card-pad))');
    const link = rule(cardStyles, '.itsm-Card__footerLink');
    expect(link).toContain('color: var(--itsm-colour-text-link)');
    expect(link).toContain('font-weight: var(--itsm-font-weight-semibold)');
  });

  it('runs bleeding children to the edges, dropping their own frame', () => {
    const bleed = rule(cardStyles, '.itsm-Card[data-bleed] > .itsm-Card__body > [data-bleed]');
    expect(bleed).toContain('margin-inline: calc(-1 * var(--_itsm-card-pad))');
    expect(bleed).toContain('border-inline-width: 0');
    expect(bleed).toContain('border-radius: 0');
  });

  it('no longer lifts: a navigable card answers hover with the soft edge and elevation sm, never a transform', () => {
    expect(cardStyles).not.toMatch(/translateY|--itsm-lift/);
    expect(cardStyles).toMatch(/\.itsm-Card\[data-interactive\]:hover \{[^}]*--_itsm-surface-elevation: var\(--itsm-elevation-sm\);[^}]*border-color: var\(--itsm-colour-border-soft\);/);
  });

  it('moves the foot arrow only when motion is allowed', () => {
    expect(cardStyles).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*:root:not\(\[data-itsm-motion="reduced"\]\) \.itsm-Card__footerLink:hover \.itsm-Card__footerArrow \{\s*translate: var\(--itsm-space-3xs\) 0;/);
  });

  it('gives every raised surface the border-first edge, strong in the high-contrast themes', () => {
    expect(rule(surfaceStyles, '.itsm-Surface[data-tone="raised"]')).toContain('border-color: var(--itsm-colour-border-subtle)');
    expect(rule(surfaceStyles, '.itsm-Surface')).toContain('border: var(--itsm-border-hair) solid transparent');
    expect(surfaceStyles).toMatch(/:root\[data-itsm-theme="high-contrast"\] \.itsm-Surface:is\(\[data-tone="raised"\], \[data-tone="outline"\]\) \{\s*border-color: var\(--itsm-colour-border-strong\);/);
  });

  it('reads only variables the tokens emit', () => {
    expect(unknownVariables(cardStyles)).toEqual([]);
    expect(unknownVariables(surfaceStyles)).toEqual([]);
  });
});

describe('Card audit', () => {
  it.each(['apple', 'apple-dark'])('a v3 card with every part has no violations in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <TestProvider>
        <main>
          <h1>Overview</h1>
          <Card
            title="Raised vs resolved"
            icon="insights"
            info={{ title: 'Raised vs resolved', body: 'Tickets raised and resolved each day.', source: 'Analytics, daily' }}
            headline="Resolved 412, raised 398: the backlog fell by 14"
            meta="Updated 2 min ago"
            actions={<button type="button">More options for Raised vs resolved</button>}
            caption="Europe/London · last 30 days"
            footerLink={{ href: '/insights', label: 'Open trends' }}
          >
            <p>Chart</p>
          </Card>
          <Card title="Open tickets" href="/inbox" info="Tickets nobody has resolved yet." headline="9 open" bleed>
            <table data-bleed="">
              <caption>Open tickets</caption>
              <tbody>
                <tr>
                  <td>INC-000123</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });
});
