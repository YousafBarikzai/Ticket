// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import type { Illustration } from '../../types.js';
import { emptyStateStyles } from '../../web/EmptyState.styles.js';
import { activeElement, cleanupDocument, click, press, render } from '../../web/__tests__/support/render.js';
import { EmptyState } from '../../web/EmptyState.js';
import { illustrationNames, StateIllustration } from '../Illustration.js';
import { STATUS_SCREEN_PRODUCT, StatusScreen } from '../StatusScreen.js';
import { statusScreenStyles } from '../StatusScreen.styles.js';

/*
 * EmptyState, StatusScreen and the illustrations (SPEC §4.5, v3 §2.13 and
 * §2.15): the places with nothing in them, each saying why and what to do
 * next, and the card a demo session shows while it changes area.
 */

/** The declarations of every top-level rule whose selector is exactly `selector`, in `css`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

afterEach(() => cleanupDocument());

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('EmptyState', () => {
  it('is a heading and a sentence, at level 2 unless it sits in a card', () => {
    const { container } = render(
      <div>
        <EmptyState title="No rules yet" description="Rules act on tickets as they arrive." />
        <EmptyState title="Nothing here" size="sm" headingLevel={3} />
      </div>,
    );
    expect(text(container.querySelector('h2'))).toBe('No rules yet');
    expect(text(container.querySelector('h2 + p'))).toBe('Rules act on tickets as they arrive.');
    expect(text(container.querySelector('h3'))).toBe('Nothing here');
  });

  it('announces an error, and only an error', () => {
    const { container } = render(
      <div>
        <EmptyState tone="error" title="This queue could not be loaded" />
        <EmptyState tone="search" title="No tickets match these filters" />
        <EmptyState tone="success" title="Nothing needs you right now" />
      </div>,
    );
    const roles = Array.from(container.querySelectorAll('.itsm-EmptyState')).map((element) => element.getAttribute('role'));
    expect(roles).toEqual(['alert', null, null]);
  });

  it('draws the tone’s icon in a tinted circle at sm and md, and its illustration at lg', () => {
    const { container } = render(
      <div>
        <EmptyState title="a" tone="search" />
        <EmptyState title="b" tone="forbidden" size="sm" />
        <EmptyState title="c" tone="offline" size="lg" />
        <EmptyState title="d" size="lg" icon="catalogue" />
        <EmptyState title="e" illustration="empty-chart" />
      </div>,
    );
    const states = Array.from(container.querySelectorAll('.itsm-EmptyState'));
    const drawn = states.map((state) => state.querySelector('[data-icon]')?.getAttribute('data-icon') ?? state.querySelector('[data-illustration]')?.getAttribute('data-illustration'));
    expect(drawn).toEqual(['search', 'lock', 'offline', 'catalogue', 'empty-chart']);
    // v3: a 24 px icon in the 48 px disc at md, 18 in 36 at sm.
    expect(states[0]?.querySelector('.itsm-EmptyState__icon svg')?.getAttribute('data-size')).toBe('xl');
    expect(states[1]?.querySelector('.itsm-EmptyState__icon svg')?.getAttribute('data-size')).toBe('md');
  });

  it('draws a dashed page-level frame only when asked', () => {
    const { container } = render(
      <div>
        <EmptyState title="This page isn't here" frame="dashed" />
        <EmptyState title="No rules yet" />
      </div>,
    );
    const [framed, plain] = Array.from(container.querySelectorAll<HTMLElement>('.itsm-EmptyState'));
    expect(framed?.dataset.frame).toBe('dashed');
    expect(plain?.hasAttribute('data-frame')).toBe(false);
    const dashed = rule(emptyStateStyles, '.itsm-EmptyState[data-frame="dashed"]');
    expect(dashed).toContain('border: var(--itsm-border-hair) dashed var(--itsm-colour-border-soft);');
    expect(dashed).toContain('border-radius: var(--itsm-radius-2xl);');
    expect(dashed).toContain('padding: 2.5rem var(--itsm-space-lg);');
  });

  it('tints the disc by why it is empty: brand for nothing yet, neutral for no match, green and red for done and failed', () => {
    expect(rule(emptyStateStyles, '.itsm-EmptyState')).toContain('--_itsm-empty-tint: var(--itsm-colour-brand-subtle);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState')).toContain('--_itsm-empty-ink: var(--itsm-colour-brand-subtleText);');
    const quiet = rule(emptyStateStyles, '.itsm-EmptyState:is([data-tone="search"], [data-tone="forbidden"], [data-tone="offline"])');
    expect(quiet).toContain('--_itsm-empty-tint: var(--itsm-colour-neutral-subtle);');
    expect(quiet).toContain('--_itsm-empty-ink: var(--itsm-colour-text-muted);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState[data-tone="success"]')).toContain('var(--itsm-colour-success-subtle)');
    expect(rule(emptyStateStyles, '.itsm-EmptyState[data-tone="error"]')).toContain('var(--itsm-colour-danger-subtle)');
    // The disc is 48 px at md and 36 px at sm; the sentence is 13/20 muted and held to 46ch.
    expect(rule(emptyStateStyles, '.itsm-EmptyState__icon')).toContain('inline-size: var(--itsm-space-2xl);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__icon')).toContain('inline-size: var(--itsm-control-height-md);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState__text')).toContain('max-inline-size: 46ch;');
    expect(rule(emptyStateStyles, '.itsm-EmptyState__body')).toContain('font-size: var(--itsm-text-callout-size);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState__body')).toContain('color: var(--itsm-colour-text-muted);');
    // The display face for the md title (16 px), the interface face at sm (14 px, D4).
    expect(rule(emptyStateStyles, '.itsm-EmptyState__title')).toContain('font-family: var(--itsm-text-title3-family);');
    expect(rule(emptyStateStyles, '.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__title')).toContain('font-family: var(--itsm-font-family-sans);');
  });

  it('renders action specs — the first filled at md, a quieter secondary at sm — and nodes as they are', () => {
    const onAction = vi.fn();
    const { container } = render(
      <TestProvider>
        <EmptyState
          title="No rules yet"
          action={{ id: 'new', label: 'Create your first rule', href: '/rules/new' }}
          secondaryAction={{ id: 'import', label: 'Import rules' }}
          onAction={onAction}
        />
        <EmptyState title="No deliveries" size="sm" action={{ id: 'refresh', label: 'Refresh' }} onAction={onAction} />
        <EmptyState title="Nothing of yours" action={<a href="/report">Report an issue</a>} />
      </TestProvider>,
    );
    const create = Array.from(container.querySelectorAll('a')).find((a) => text(a) === 'Create your first rule');
    expect(create?.getAttribute('href')).toBe('/rules/new');
    expect(create?.className).toContain('itsm-Button--primary');
    const importButton = Array.from(container.querySelectorAll('button')).find((b) => text(b) === 'Import rules')!;
    expect(importButton.className).toContain('itsm-Button--secondary');
    click(importButton);
    expect(onAction).toHaveBeenCalledWith('import');
    const refresh = Array.from(container.querySelectorAll('button')).find((b) => text(b) === 'Refresh')!;
    expect(refresh.className).toContain('itsm-Button--secondary');
    expect(refresh.className).toContain('itsm-Button--sm');
    expect(Array.from(container.querySelectorAll('a')).some((a) => text(a) === 'Report an issue')).toBe(true);
  });

  it('puts a node description in a block, so it may hold its own paragraphs', () => {
    const markup = renderToStaticMarkup(
      <EmptyState
        title="Offline"
        description={
          <>
            <p>This page hasn't been opened on this device yet.</p>
            <p>These have:</p>
          </>
        }
      >
        <ul>
          <li>INC-000123</li>
        </ul>
      </EmptyState>,
    );
    expect(markup).toContain('<div class="itsm-EmptyState__body"><p>');
    expect(markup).toContain('<div class="itsm-EmptyState__extra"><ul>');
  });

  it('renders on the server with only a title', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing here" />)).toContain('Nothing here');
  });
});

describe('StatusScreen', () => {
  it('is the page: a main landmark, the title as its h1, the area lockup', () => {
    const markup = renderToStaticMarkup(
      <StatusScreen brand="workbench" illustration="offline" title="You're offline" body="This page hasn't been opened on this device yet." />,
    );
    expect(markup).toMatch(/^<main class="itsm-StatusScreen"/);
    expect(markup).toContain('<h1 class="itsm-StatusScreen__title">You&#x27;re offline</h1>');
    expect(markup).toContain('itsm-BrandMark');
    expect(markup).toContain('>Service Desk<');
    expect(markup).toContain(`>${STATUS_SCREEN_PRODUCT}<`);
    expect(markup).toContain('data-illustration="offline"');
  });

  it('names each area as D1 does, under the product name, and takes a caller’s name instead', () => {
    const area = (brand: 'portal' | 'workbench' | 'admin', brandName?: string): string => {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(<StatusScreen brand={brand} brandName={brandName} title="You're signed out" />);
      return text(host.querySelector('.itsm-StatusScreen__product'));
    };
    expect([area('portal'), area('workbench'), area('admin')]).toEqual(['Help Portal', 'Service Desk', 'Administration']);
    expect(area('admin', 'Platform')).toBe('Platform');
    expect(STATUS_SCREEN_PRODUCT).toBe('IT Service Management');
    expect(renderToStaticMarkup(<StatusScreen title="Page not found" />)).not.toContain('itsm-StatusScreen__brand');
  });

  it('renders link actions as plain anchors, the first primary, skipping ones it cannot act on', () => {
    const markup = renderToStaticMarkup(
      <StatusScreen
        brand="admin"
        title="You're signed out"
        actions={[
          { id: 'sign-in', label: 'Sign in again', href: '/api/session/login' },
          { id: 'help', label: 'Status page', href: 'https://status.example', external: true },
          { id: 'noop', label: 'Needs a handler' },
          { id: 'gone', label: 'Unavailable', href: '/x', disabled: true },
        ]}
      >
        <form method="post" action="/api/session/logout">
          <button type="submit">Sign out</button>
        </form>
      </StatusScreen>,
    );
    expect(markup).toContain('href="/api/session/login" class="itsm-Button itsm-Button--primary itsm-Button--lg"');
    expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
    expect(markup).toContain('(opens in a new tab)');
    expect(markup).not.toContain('Needs a handler');
    expect(markup).not.toContain('Unavailable');
    expect(markup).toContain('<form action="/api/session/logout" method="post">');
  });

  it('marks a global error page for the render pass, and nothing else', () => {
    expect(renderToStaticMarkup(<StatusScreen title="Something went wrong" errorBoundary />)).toContain('data-itsm-error-boundary=""');
    expect(renderToStaticMarkup(<StatusScreen title="You're offline" />)).not.toContain('data-itsm-error-boundary');
    expect(renderToStaticMarkup(<StatusScreen title="Opening Service Desk…" as="div" />)).toMatch(/^<div/);
  });

  it('is a v3 card: border-first, the dialog radius, the largeTitle heading, no squircle, below any system bar', () => {
    const card = rule(statusScreenStyles, '.itsm-StatusScreen__card');
    expect(card).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);');
    expect(card).toContain('border-radius: var(--itsm-radius-3xl);');
    expect(card).toContain('box-shadow: var(--itsm-elevation-sm);');
    expect(card).toContain('max-inline-size: 26.25rem;');
    expect(statusScreenStyles).not.toContain('squircle');
    expect(rule(statusScreenStyles, '.itsm-StatusScreen__title')).toContain('font-size: var(--itsm-text-largeTitle-size);');
    expect(rule(statusScreenStyles, '.itsm-StatusScreen')).toContain('min-block-size: calc(100dvh - var(--itsm-system-bar-h));');
  });
});

describe('StatusScreen variant="hop"', () => {
  const hop = (
    <StatusScreen
      variant="hop"
      brand="portal"
      title="Opening the Help Portal as Emma Clarke…"
      session={{
        badge: 'Demo',
        persona: (
          <>
            You're <strong>Emma Clarke</strong> · Finance Manager
          </>
        ),
      }}
      illustration="inbox"
    >
      <form id="itsm-demo-entry" method="post" action="/api/session/demo">
        <button type="submit" className="itsm-Button itsm-Button--secondary itsm-Button--lg">
          Open the demo
        </button>
      </form>
    </StatusScreen>
  );

  it('says where it is going in a status line that is also the page’s h1', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(hop);
    const root = host.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('MAIN');
    expect(root.dataset.variant).toBe('hop');
    const status = root.querySelector('h1 [role="status"]');
    expect(text(status)).toBe('Opening the Help Portal as Emma Clarke…');
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(text(root.querySelector('.itsm-StatusScreen__product'))).toBe('Help Portal');
    // No drawing in the hop card, however the caller asked.
    expect(root.querySelector('[data-illustration]')).toBeNull();
  });

  it('shows a progress bar that only decorates, and the persona strip in the demo bar’s navy', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(hop);
    expect(host.querySelector('.itsm-StatusScreen__progress')?.getAttribute('aria-hidden')).toBe('true');
    const strip = host.querySelector<HTMLElement>('.itsm-StatusScreen__session')!;
    expect(strip.dataset.surface).toBe('hero');
    expect(text(strip.querySelector('.itsm-SystemBar__badge'))).toBe('Demo');
    expect(text(strip.querySelector('.itsm-StatusScreen__persona'))).toBe("You're Emma Clarke · Finance Manager");
    // The bar's look without the bar: `.itsm-SystemBar` would publish a frame offset (`:root:has()`).
    expect(host.querySelector('.itsm-SystemBar')).toBeNull();
    expect(rule(statusScreenStyles, '.itsm-StatusScreen__session')).toContain('background: var(--itsm-hero-bar-background);');
  });

  it('traps nothing: no modal, nothing inert, and the keyboard passes through to what follows', () => {
    const { container } = render(
      <div>
        {hop}
        <a href="/help">Help</a>
      </div>,
    );
    expect(container.querySelector('[aria-modal], [role="dialog"], [role="alertdialog"], [inert]')).toBeNull();
    const button = container.querySelector<HTMLButtonElement>('button')!;
    button.focus();
    press(button, 'Tab');
    // Nothing intercepted the key: focus was not pulled back into the card.
    expect(activeElement()).toBe(button);
    expect(Array.from(container.querySelectorAll('[tabindex]')).filter((element) => element.getAttribute('tabindex') !== '0')).toEqual([]);
  });

  it('sweeps its bar, and holds it still under reduced motion', () => {
    expect(rule(statusScreenStyles, '.itsm-StatusScreen__progressBar')).toContain('animation: itsm-StatusScreen-sweep');
    expect(statusScreenStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.itsm-StatusScreen__progressBar \{[^}]*animation: none;/);
    expect(statusScreenStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-StatusScreen__progressBar \{[^}]*animation: none;/);
  });

  it('renders as the plain card without a session', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<StatusScreen variant="hop" title="Opening the Service Desk as Alex Morgan…" />);
    expect(host.querySelector('.itsm-StatusScreen__session')).toBeNull();
    expect(text(host.querySelector('[role="status"]'))).toBe('Opening the Service Desk as Alex Morgan…');
  });
});

describe('the illustrations', () => {
  it.each(illustrationNames)('%s is decorative, id-free and small', (name: Illustration) => {
    const markup = renderToStaticMarkup(<StateIllustration name={name} />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/\sid=/);
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(markup.length).toBeLessThan(1500);
  });

  it('covers every name the shared type allows', () => {
    const all: Record<Illustration, true> = {
      inbox: true,
      search: true,
      error: true,
      success: true,
      forbidden: true,
      offline: true,
      'empty-chart': true,
      catalogue: true,
      setup: true,
    };
    expect([...illustrationNames].sort()).toEqual(Object.keys(all).sort());
  });

  it('takes a tone, with a sensible default per drawing', () => {
    expect(renderToStaticMarkup(<StateIllustration name="error" />)).toContain('data-tone="danger"');
    expect(renderToStaticMarkup(<StateIllustration name="success" />)).toContain('data-tone="success"');
    expect(renderToStaticMarkup(<StateIllustration name="inbox" tone="warning" size="sm" />)).toContain('data-tone="warning"');
  });
});
