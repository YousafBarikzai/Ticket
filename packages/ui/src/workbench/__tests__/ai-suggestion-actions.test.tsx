// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItsmProvider } from '../../provider/ItsmProvider.js';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import type { LinkComponent } from '../../types.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { AiSuggestionCard, type AiSuggestionCardProps } from '../AiSuggestionCard.js';

afterEach(() => cleanupDocument());

/**
 * The redesign's additions to the suggestion card (SPEC §4.8): the accept
 * button's words, a narrower set of outcomes for surfaces that cannot record
 * all three, and evidence links through the application's router.
 * (`ai-suggestion-card.test.tsx` keeps the original contract, unchanged.)
 */

function card(props: Partial<AiSuggestionCardProps> = {}) {
  return (
    <AiSuggestionCard
      capability="summary"
      title="Summary"
      reason="Summarised from 14 messages."
      confidence="medium"
      evidence={[{ kind: 'article', id: 'a', title: 'VPN troubleshooting', ref: 'KB-0031', href: '/knowledge/vpn' }]}
      {...props}
    >
      <p>VPN drops every 20 minutes since the client update.</p>
    </AiSuggestionCard>
  );
}

const labels = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('.itsm-AiSuggestion__actions button')].map((button) => button.textContent);

describe('the actions', () => {
  it('names the accept button for what it does, keeping the order', () => {
    const { container } = render(card({ acceptLabel: 'Insert into reply' }));
    expect(labels(container)).toEqual(['Insert into reply', 'Edit first', 'Not useful']);
  });

  it('offers only the outcomes a surface can record, in the fixed order', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(card({ actions: ['reject', 'accept'], acceptLabel: 'Add as internal note', onAccept, onReject }));
    expect(labels(container)).toEqual(['Add as internal note', 'Not useful']);
    const [accept, reject] = [...container.querySelectorAll('.itsm-AiSuggestion__actions button')];
    click(accept!);
    click(reject!);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('marks the card busy while an outcome is being recorded', () => {
    const { container } = render(card({ busy: true }));
    expect(container.querySelector('article')?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('the evidence', () => {
  it('opens through the application’s Link, so it navigates in place', () => {
    const Link: LinkComponent = ({ prefetch, replace, scroll, ...anchor }) => {
      void [prefetch, replace, scroll];
      return <a {...anchor} data-app-link="" />;
    };
    const { container } = render(
      <ItsmProvider
        app="workbench"
        Link={Link}
        router={testRouter()}
        usePathname={() => '/inbox/mine'}
        useSearchParams={() => new URLSearchParams()}
        locale="en-GB"
        timeZone="Europe/London"
      >
        {card()}
      </ItsmProvider>,
    );
    const link = container.querySelector('a.itsm-AiSuggestion__evidenceLink');
    expect(link?.getAttribute('href')).toBe('/knowledge/vpn');
    expect(link?.textContent).toBe('VPN troubleshooting');
    expect(link?.hasAttribute('data-app-link')).toBe(true);
  });

  it('shows the outcome with its icon once recorded, and the words alone as its text', () => {
    const { container } = render(card({ outcome: 'accepted' }));
    const outcome = container.querySelector('.itsm-AiSuggestion__outcome')!;
    expect(outcome.textContent).toBe('Accepted as written');
    expect(outcome.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('audit', () => {
  it('passes axe with a narrowed set of actions, no evidence, and decided', async () => {
    const { container } = render(
      <TestProvider>
        {card({ actions: ['accept', 'reject'], acceptLabel: 'Add as internal note' })}
        {card({ evidence: [], confidence: 'low' })}
        {card({ outcome: 'rejected' })}
      </TestProvider>,
    );
    await expectNoViolations(container);
  });
});
