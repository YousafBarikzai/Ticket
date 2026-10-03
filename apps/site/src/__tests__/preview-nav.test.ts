// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AREAS, SERVICE_DESK_NAV_PREVIEW, SERVICE_DESK_OVERVIEW_PURPOSE } from '@itsm/contracts/areas';
import { HeroPreview } from '../landing/HeroPreview.js';
import { HERO_KPIS } from '../landing/hero-sample.js';

/**
 * A smoke test of the hero's preview (SPEC v3 X-M2, V-m2): it draws the
 * Service Desk's navigation and Overview purpose from the contracts. The
 * guard that those match the real Service Desk navigation is the Service
 * Desk's own `navigation.test.ts` (WP-41); this only checks the preview uses
 * them, and carries the hooks the PMO parity check reads (§7.0.1, §12.5.1).
 */

function render(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(HeroPreview, { now: Date.UTC(2026, 9, 2, 10, 0, 0) }));
  return host;
}

describe('the hero preview', () => {
  it('carries data-hero-preview', () => {
    expect(render().querySelectorAll('[data-hero-preview]')).toHaveLength(1);
  });

  it('draws every SERVICE_DESK_NAV_PREVIEW item, label and icon, with Overview current', () => {
    const host = render();
    const items = [...host.querySelectorAll<HTMLElement>('[data-preview-nav]')];
    expect(items.map((item) => item.dataset.previewNav)).toEqual(SERVICE_DESK_NAV_PREVIEW.map((item) => item.id));
    expect(items.map((item) => item.querySelector('.app-Preview__navLabel')?.textContent)).toEqual(SERVICE_DESK_NAV_PREVIEW.map((item) => item.label));
    items.forEach((item) => expect(item.querySelector('svg')).not.toBeNull());
    expect(host.querySelector('[data-current]')?.getAttribute('data-preview-nav')).toBe('overview');
    // The sections, in their order.
    expect([...host.querySelectorAll('.app-Preview__groupLabel')].map((label) => label.textContent)).toEqual(['Tickets']);
  });

  it('says the Overview’s purpose and the Service Desk’s own line', () => {
    const host = render();
    expect(host.querySelector('.app-Preview__purpose')?.textContent).toBe(SERVICE_DESK_OVERVIEW_PURPOSE);
    expect(host.querySelector('.app-Preview__areaName')?.textContent).toBe(AREAS.workbench.name);
    expect(host.querySelector('.app-Preview__areaLine')?.textContent).toBe(AREAS.workbench.description);
  });

  it('shows the Overview’s first four tiles and its two chart cards, with a written headline each, and says it is sample data', () => {
    const host = render();
    expect([...host.querySelectorAll('.itsm-StatCard__label')].map((label) => label.textContent)).toEqual(['Open', 'Due today', 'Breached', 'Waiting on others']);
    expect(HERO_KPIS).toHaveLength(4);
    const cards = [...host.querySelectorAll('.itsm-ChartCard')];
    expect(cards.map((card) => card.querySelector('.itsm-Card__title')?.textContent)).toEqual(['Raised vs resolved', 'SLA met']);
    for (const card of cards) expect(card.querySelector('.itsm-ChartCard__headline')?.textContent).toBeTruthy();
    expect(cards[0]!.querySelector('.itsm-ChartCard__headline')?.textContent).toMatch(/^Resolved [\d,]+, raised [\d,]+ in 30 days: the queue (fell|grew) by [\d,]+$/);
    expect(cards[1]!.querySelector('.itsm-ChartCard__headline')?.textContent).toBe('93.4% of targets met in 30 days, 3.4 points above the 90% target');
    expect(host.textContent).toContain('Sample data');
    // A static figure: no reader island is drawn.
    expect(host.querySelector('[data-reader]')).toBeNull();
  });
});
