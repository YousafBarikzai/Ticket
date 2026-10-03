// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineEntry } from '@itsm/sdk';
import { ciCriticality, ciRole, linkLines, tidyNumber } from '../workspace/inspector/RelatedCard.js';
import { RelatedRecords } from '../workspace/inspector/RelatedRecords.js';
import { FakeEventSource, fakeFetch, noIdle, type Call } from './support/inbox.js';
import { cleanupDocument } from './support/render.js';
import { ME, bundle, flush, mountWorkspace, ticket, until } from './support/workspace.js';

/**
 * The inspector's Related card (v3 §7.1.4, A6 §5.6.5 row 6, V1-M5): Phase 1's
 * linked tickets — link type, number, title and a toned `StatusPill` — and
 * configuration items from `recordCis`, sixth in the cards' fixed order,
 * read only once opened; and `RelatedRecords`, the R17 slot WP-72 fills,
 * rendering nothing until then.
 */

const NUMBER = 'INC-000123';
const TICKET_ID = ticket().id;

let wire: ReturnType<typeof fakeFetch>;

function answer(call: Call): { status?: number; body?: unknown } | undefined {
  if (call.url.includes('/field-definitions')) {
    return {
      body: {
        data: [{ id: 'f1', key: 'costCentre', label: 'Cost centre', type: 'text', options: [], appliesTo: { types: [] }, requiredWhen: null, visibleTo: [], classification: 'internal', order: 1, isActive: true }],
      },
    };
  }
  if (call.url.includes('/ai/triage/')) {
    return {
      body: {
        data: {
          decisionId: 'd-1',
          provider: 'sample',
          model: null,
          createdAt: '2026-09-30T09:00:00.000Z',
          suggestions: [{ question: 'category', field: 'categoryId', kind: 'apply', value: 'c-1', display: 'Access / VPN', confidence: 0.9 }],
          applied: [],
        },
      },
    };
  }
  if (call.url.endsWith(`/tickets/${NUMBER}/links`) && call.method === 'GET') {
    return {
      body: {
        data: [
          { linkType: 'caused_by', createdAt: '2026-09-30T08:00:00.000Z', ticket: { id: 'p', number: 'PRB-000412', type: 'problem', title: 'Dock firmware drops the link', status: 'pending_third_party', statusCategory: 'paused' } },
          { linkType: 'related_to', createdAt: '2026-09-30T08:10:00.000Z', ticket: { id: 'r', number: 'INC-000118', type: 'incident', title: 'VPN drops for finance', status: 'resolved', statusCategory: 'resolved' } },
        ],
      },
    };
  }
  if (call.url.endsWith(`/records/ticket/${TICKET_ID}/cis`)) {
    return {
      body: {
        data: [
          { role: 'affected', linkedAt: '2026-09-30T08:00:00.000Z', ci: { id: 'ci-1', name: 'vpn-gw-01', status: 'live', criticality: 'high', serviceId: null } },
          { role: 'cause', linkedAt: '2026-09-30T08:00:00.000Z', ci: null },
        ],
      },
    };
  }
  return undefined;
}

class Wide {
  constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
  observe(): void {
    this.callback([{ contentRect: { width: 1280 } }]);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: { id: string; nodes: { html: string }[] }[] }>;
};
async function audit(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(['region', 'color-contrast', 'color-contrast-enhanced', 'target-size'].map((rule) => [rule, { enabled: false }])),
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('ResizeObserver', Wide);
  noIdle();
  wire = fakeFetch(answer);
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

async function openRelated(): Promise<HTMLDetailsElement> {
  const card = document.querySelector<HTMLDetailsElement>('details[data-card="related"]')!;
  act(() => {
    card.open = true;
    card.dispatchEvent(new Event('toggle'));
  });
  await flush(2);
  return card;
}

describe('the Related card', () => {
  it('sits sixth in the fixed order, closed, and reads nothing until it is opened', async () => {
    await mountWorkspace({ bundle: bundle({ can: { aiRead: true, ai: true, link: true } }) });
    await until(() => expect(document.querySelector('[data-card="custom"]')).not.toBeNull());
    await until(() => expect(document.querySelector('[data-card="triage"]')).not.toBeNull());
    const order = [...document.querySelectorAll<HTMLElement>('.app-Insp [data-card]')].map((card) => card.dataset.card);
    expect(order.slice(0, 6)).toEqual(['requester', 'sla', 'triage', 'details', 'custom', 'related']);
    const card = document.querySelector<HTMLDetailsElement>('details[data-card="related"]')!;
    expect(card.open).toBe(false);
    expect(card.querySelector('summary')?.textContent).toBe('Related');
    expect(wire.calls.some((call) => call.url.includes('/links') || call.url.includes('/cis'))).toBe(false);
  });

  it('lists linked tickets with the link type, number, title and a toned status pill, then the configuration items', async () => {
    await mountWorkspace({ bundle: bundle({ can: { link: true } }) });
    const card = await openRelated();
    await until(() => expect(card.querySelectorAll('.app-Related__row[data-kind="ticket"]')).toHaveLength(2));
    const [problem, incident] = [...card.querySelectorAll<HTMLElement>('.app-Related__row[data-kind="ticket"]')];
    expect(problem!.querySelector('.app-Related__type')?.textContent).toBe('Caused by');
    expect(problem!.querySelector('a')?.getAttribute('href')).toBe('/tickets/PRB-000412');
    expect(problem!.querySelector('.app-Related__title')?.textContent).toBe('Dock firmware drops the link');
    // A wait is `hold` (D5), a resolved ticket `success`, each with its words.
    expect(problem!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('hold');
    expect(problem!.querySelector('.itsm-StatusPill')?.textContent).toContain('Waiting on supplier');
    expect(incident!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('success');

    await until(() => expect(card.querySelectorAll('.app-Related__row[data-kind="ci"]')).toHaveLength(2));
    const [gateway, gone] = [...card.querySelectorAll<HTMLElement>('.app-Related__row[data-kind="ci"]')];
    expect(gateway!.textContent).toContain('Affected');
    expect(gateway!.textContent).toContain('vpn-gw-01');
    expect(gateway!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('neutral');
    expect(gateway!.textContent).toContain('High criticality');
    expect(gone!.textContent).toContain('An item since deleted');

    // "Link…" stays, for a person who may link.
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === 'Link…')).toBe(true);
    expect(await audit(card)).toEqual([]);
  });

  it('falls back to the history’s links where the API has no list, and leaves out what cannot be read', async () => {
    wire = fakeFetch((call) => (call.url.includes('/links') || call.url.includes('/cis') ? { status: 404, body: { status: 404, title: 'Not found' } } : answer(call)));
    vi.stubGlobal('fetch', wire.fetch);
    const entries: TimelineEntry[] = [
      ...bundle().entries,
      { kind: 'event', id: 'e-link', at: '2026-09-30T08:50:00.000Z', type: 'linked', actorType: 'user', actorId: ME, payload: { targetId: 'x', targetNumber: 'INC-000118', linkType: 'caused_by' } },
    ];
    await mountWorkspace({ bundle: bundle({ entries }) });
    const card = await openRelated();
    await until(() => expect(card.querySelector('.app-Related__row')?.textContent).toContain('Caused byINC-000118'));
    expect(card.textContent).not.toContain('Configuration items');
    // Without `ticket.link`, no Link….
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === 'Link…')).toBe(false);
  });
});

describe('RelatedRecords (the R17 slot)', () => {
  it('renders nothing until WP-72 makes it real', () => {
    expect(renderToStaticMarkup(<RelatedRecords ticketNumber={NUMBER} />)).toBe('');
  });
});

describe('the rules behind it', () => {
  it('words links, roles and criticality', () => {
    expect(linkLines(null, [])).toEqual([]);
    expect(tidyNumber('inc 42')).toBe('INC-000042');
    expect(ciRole('affected_by')).toBe('Affected by');
    expect(ciCriticality('very_high')).toBe('Very high criticality');
    expect(ciCriticality('')).toBe('Criticality not set');
  });
});
