// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import type { Illustration } from '../../types.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { EmptyState } from '../../web/EmptyState.js';
import { illustrationNames, StateIllustration } from '../Illustration.js';
import { StatusScreen } from '../StatusScreen.js';

/*
 * EmptyState, StatusScreen and the illustrations (SPEC §4.5): the places with
 * nothing in them, each saying why and what to do next.
 */

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
    expect(states[0]?.querySelector('.itsm-EmptyState__icon svg')?.getAttribute('data-size')).toBe('2xl');
    expect(states[1]?.querySelector('.itsm-EmptyState__icon svg')?.getAttribute('data-size')).toBe('xl');
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
  it('is the page: a main landmark, the title as its h1, the app’s mark and name', () => {
    const markup = renderToStaticMarkup(
      <StatusScreen brand="workbench" illustration="offline" title="You're offline" body="This page hasn't been opened on this device yet." />,
    );
    expect(markup).toMatch(/^<main class="itsm-StatusScreen"/);
    expect(markup).toContain('<h1 class="itsm-StatusScreen__title">You&#x27;re offline</h1>');
    expect(markup).toContain('itsm-BrandMark');
    expect(markup).toContain('>Workbench<');
    expect(markup).toContain('data-illustration="offline"');
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
    expect(renderToStaticMarkup(<StatusScreen title="Opening Workbench…" as="div" />)).toMatch(/^<div/);
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
