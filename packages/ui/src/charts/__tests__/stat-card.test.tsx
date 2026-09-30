// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Metric, MetricGrid } from '../../web/Metric.js';
import { StatCard, type StatCardProps } from '../StatCard.js';
import { StatGrid } from '../StatGrid.js';

afterEach(() => cleanupDocument());

/**
 * The stat-tile contract (SPEC §4.8), state by state. A stat card is read in
 * a glance and by a screen reader in one breath, so every case checks both
 * what is shown and what is heard.
 */

function card(props: Partial<StatCardProps> = {}) {
  const { container } = render(
    <TestProvider>
      <StatCard label="Open tickets" value={1284} {...props} />
    </TestProvider>,
  );
  return container.querySelector('.itsm-StatCard') as HTMLElement;
}

const text = (element: Element | null): string => element?.textContent ?? '';
const shown = (element: Element | null): string =>
  [...(element?.childNodes ?? [])]
    .filter((node) => !(node instanceof HTMLElement && node.classList.contains('itsm-visually-hidden')))
    .map((node) => node.textContent)
    .join('');

describe('the value', () => {
  it('is written in the reader’s locale, as the only large thing', () => {
    const root = card();
    expect(text(root.querySelector('.itsm-StatCard__label'))).toBe('Open tickets');
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('1,284');
  });

  it('shows a dash when there is no value, and says "Not available"', () => {
    const root = card({ value: null });
    const number = root.querySelector('.itsm-StatCard__number')!;
    expect(number.textContent).toBe('—');
    expect(number.getAttribute('aria-hidden')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__value'))).toContain('Not available');
  });

  it('marks a lower bound as one: "50+", heard as "at least 50"', () => {
    const root = card({ value: 50, approx: 'atLeast' });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('50+');
    expect(text(root.querySelector('.itsm-StatCard__value .itsm-visually-hidden'))).toBe('at least 50');
  });

  it('shortens when asked (in the locale’s own abbreviation), and carries a unit and a qualifier', () => {
    const root = card({ value: 12_900, format: { compact: true }, unit: 'tickets', secondary: '· 3 breached' });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toMatch(/^12\.9[kK]$/);
    expect(text(root.querySelector('.itsm-StatCard__unit'))).toBe('tickets');
    expect(text(root.querySelector('.itsm-StatCard__secondary'))).toBe('· 3 breached');
  });

  it('formats percentages as percentages', () => {
    expect(text(card({ value: 0.942, format: { style: 'percent', maximumFractionDigits: 1 } }).querySelector('.itsm-StatCard__number'))).toBe('94.2%');
  });

  it('writes minutes as a duration, and says the units in full', () => {
    const root = card({ value: 72, format: { duration: 'minutes' } });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('1 h 12 min');
    expect(root.querySelector('.itsm-StatCard__number')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__value .itsm-visually-hidden'))).toBe('1 hour 12 minutes');
    // Two parts at most: a long wait reads in days and hours.
    expect(text(card({ value: 3 * 24 * 60 + 5 * 60 + 7, format: { duration: 'minutes' } }).querySelector('.itsm-StatCard__number'))).toBe('3 d 5 h');
  });
});

describe('the delta chip', () => {
  it('says the direction with an arrow and a sign, and whether that is good, in words', () => {
    const delta = card({ delta: { value: 0.12, format: { style: 'percent' }, period: 'vs last week', goodDirection: 'down' } }).querySelector('.itsm-StatCard__delta')!;
    expect(delta.getAttribute('data-direction')).toBe('up');
    expect(delta.getAttribute('data-sentiment')).toBe('bad');
    expect(shown(delta.querySelector('.itsm-StatCard__chip'))).toBe('+12%');
    expect(text(delta.querySelector('.itsm-StatCard__chip .itsm-visually-hidden'))).toBe('Up 12%, worse');
    expect(text(delta.querySelector('.itsm-StatCard__period'))).toBe('vs last week');
    expect(delta.querySelector('svg')).not.toBeNull();
  });

  it('calls a fall good when down is good, and a change neither when there is no good direction', () => {
    const good = card({ delta: { value: -4, period: 'vs yesterday', goodDirection: 'down' } }).querySelector('.itsm-StatCard__delta')!;
    expect(good.getAttribute('data-sentiment')).toBe('good');
    expect(text(good.querySelector('.itsm-visually-hidden'))).toBe('Down 4, better');
    expect(shown(good.querySelector('.itsm-StatCard__chip'))).toBe('-4');
    cleanupDocument();
    const neutral = card({ delta: { value: 3, period: 'vs yesterday', goodDirection: 'none' } }).querySelector('.itsm-StatCard__delta')!;
    expect(neutral.getAttribute('data-sentiment')).toBe('neutral');
    expect(text(neutral.querySelector('.itsm-visually-hidden'))).toBe('Up 3');
  });

  it('says "No change" for zero', () => {
    const delta = card({ delta: { value: 0, period: 'vs last week' } }).querySelector('.itsm-StatCard__delta')!;
    expect(delta.getAttribute('data-direction')).toBe('flat');
    expect(text(delta.querySelector('.itsm-visually-hidden'))).toBe('No change');
  });

  it('is left out when there is no value to change', () => {
    expect(card({ value: null, delta: { value: 3, period: 'vs last week' } }).querySelector('.itsm-StatCard__delta')).toBeNull();
  });
});

describe('the trend', () => {
  it('draws a sparkline named by its direction', () => {
    const spark = card({ trend: [980, 1100, 1284] }).querySelector('.itsm-StatCard__trend')!;
    expect(spark.getAttribute('role')).toBe('img');
    expect(spark.getAttribute('aria-label')).toBe('Trend: Rising, 980 → 1,284');
  });

  it('needs two points to be a trend', () => {
    expect(card({ trend: [3] }).querySelector('.itsm-StatCard__trend')).toBeNull();
  });
});

describe('status, link and states', () => {
  it('adds an icon with a name, never colour alone', () => {
    const root = card({ status: 'critical' });
    expect(root.getAttribute('data-status')).toBe('critical');
    expect(root.querySelector('.itsm-StatCard__status')?.getAttribute('aria-label')).toBe('Critical');
  });

  it('turns the label into one link stretched over the card, through the application’s Link', () => {
    const root = card({ href: '/tickets?status=open' });
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/tickets?status=open');
    expect(links[0]!.textContent).toBe('Open tickets');
    expect(root.hasAttribute('data-interactive')).toBe(true);
  });

  it('is not interactive without a link', () => {
    expect(card().hasAttribute('data-interactive')).toBe(false);
  });

  it('keeps the label while loading, and says it is loading', () => {
    const root = card({ loading: true, href: '/tickets' });
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__label'))).toBe('Open tickets');
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('.itsm-StatCard__value')).toBeNull();
    expect(text(root.querySelector('.itsm-StatCard__loading .itsm-visually-hidden'))).toBe('Loading…');
    expect(root.querySelectorAll('.itsm-Skeleton[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('says why it could not load, in words, and retries on request', () => {
    const onRetry = vi.fn();
    const root = card({ problem: { status: 503 }, onRetry });
    expect(text(root.querySelector('.itsm-StatCard__problem'))).toContain("Couldn't load open tickets");
    expect(root.querySelector('.itsm-StatCard__value')).toBeNull();
    click(root.querySelector('.itsm-StatCard__retry')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry for a problem retrying cannot fix', () => {
    expect(card({ problem: { status: 403 }, onRetry: vi.fn() }).querySelector('.itsm-StatCard__retry')).toBeNull();
  });

  it('carries a footnote', () => {
    expect(text(card({ footnote: 'Counted from the first 50.' }).querySelector('.itsm-StatCard__footnote'))).toBe('Counted from the first 50.');
  });

  it('renders outside a provider, in the default locale', () => {
    const { container } = render(<StatCard label="Open" value={1284} href="/x" />);
    expect(container.querySelector('.itsm-StatCard__number')?.textContent).toBe('1,284');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/x');
  });
});

describe('the deprecated Metric', () => {
  it('draws a stat card with its old props, the note coloured by tone and the value never', () => {
    const { container } = render(
      <MetricGrid>
        <Metric label="Open tickets" value={128} note="12 more than yesterday" tone="bad" href="/tickets" />
        <Metric label="Cost" value="£3.20" />
      </MetricGrid>,
    );
    expect(container.querySelector('.itsm-StatGrid.itsm-MetricGrid')).not.toBeNull();
    const [first, second] = [...container.querySelectorAll('.itsm-StatCard.itsm-Metric')];
    expect(first!.querySelector('.itsm-StatCard__number')?.textContent).toBe('128');
    expect(first!.querySelector('.itsm-StatCard__footnote')?.getAttribute('data-tone')).toBe('bad');
    expect(first!.querySelector('a')?.getAttribute('href')).toBe('/tickets');
    expect(second!.querySelector('.itsm-StatCard__number')?.textContent).toBe('£3.20');
    expect(second!.querySelector('.itsm-StatCard__footnote')).toBeNull();
  });
});

describe('StatGrid', () => {
  it('holds its cards in one grid', () => {
    const { container } = render(
      <StatGrid columns={4}>
        <StatCard label="A" value={1} />
        <StatCard label="B" value={2} />
      </StatGrid>,
    );
    expect(container.querySelectorAll('.itsm-StatGrid__items > .itsm-StatCard')).toHaveLength(2);
  });
});
