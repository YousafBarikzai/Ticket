// @vitest-environment jsdom
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { componentStylesheet } from '../../styles/index.js';
import type { Problem } from '../../types.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import {
  DEMO_CAP_CATEGORIES,
  DEMO_COPY,
  DEMO_FEATURES,
  DEMO_PROBLEM_CODES,
  demoDisabledSentence,
  demoLimitSentence,
} from '@itsm/contracts/demo';
import { DEMO_PROBLEM_COPY, describeProblem, formatWait, inSentence, isRetryableStatus, permissionKeyFrom } from '../problem.js';
import { ProblemState } from '../ProblemState.js';

/*
 * ProblemState (SPEC §4.5, WP6 acceptance): every status maps to the
 * product's copy and the one next step that status allows — sign in again,
 * reload, wait, retry — and the route error page is findable by its marker.
 */

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.useRealTimers();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; the guard mirrors the component's.
  }
});

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const buttons = (root: ParentNode): HTMLButtonElement[] => Array.from(root.querySelectorAll('button'));
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  buttons(root).find((button) => text(button).startsWith(name));

describe('describeProblem', () => {
  const cases: readonly (readonly [Problem, string, string])[] = [
    [{ status: 401 }, 'Your session ended', 'signIn'],
    [{ status: 402, code: 'limit_reached' }, 'Plan limit reached', 'none'],
    [{ status: 403, code: 'tenant_suspended' }, 'This workspace is suspended', 'none'],
    [{ status: 403, code: 'forbidden' }, "You don't have access", 'none'],
    [{ status: 404 }, "We couldn't find that", 'none'],
    [{ status: 409 }, 'Someone else changed this', 'reload'],
    [{ status: 428 }, 'Someone else changed this', 'reload'],
    [{ status: 422 }, 'Some details need another look', 'none'],
    [{ status: 429, retryAfterSeconds: 20 }, 'Too many requests', 'retry'],
    [{ status: 502 }, "Can't reach the service", 'retry'],
    [{ status: 503 }, "Can't reach the service", 'retry'],
    [{ status: 0 }, "Can't reach the service", 'retry'],
    [{ status: 500 }, 'Something went wrong', 'retry'],
    [{ status: 418 }, 'Something went wrong', 'retry'],
  ];

  it.each(cases)('maps %j to its own title and remedy', (problem, title, remedy) => {
    const description = describeProblem(problem);
    expect(description.title).toBe(title);
    expect(description.remedy).toBe(remedy);
  });

  it('never shows the API code as the headline', () => {
    // The API's title is its code with spaces; the product's copy replaces it.
    expect(describeProblem({ status: 429, title: 'rate limited' }).title).toBe('Too many requests');
    expect(describeProblem({ status: 404, title: 'not found', detail: 'rule vip was not found' }).title).toBe("We couldn't find that");
  });

  it('names the context and the missing permission in words', () => {
    const forbidden = describeProblem({ status: 403 }, { context: 'Rules', permissionLabel: 'Read rules' });
    expect(forbidden.title).toBe("You don't have access to Rules");
    expect(forbidden.body).toContain('Read rules');
    expect(describeProblem({ status: 503 }, { context: 'Failed deliveries' }).title).toBe("Couldn't load failed deliveries");
  });

  it('counts field errors for a 422 without showing raw field paths', () => {
    const body = describeProblem({ status: 422, fieldErrors: { 'body.title': 'Required', 'body.impact': 'Invalid' } }).body;
    expect(body).toBe('2 answers need changing before this can go through.');
    expect(body).not.toContain('body.title');
  });

  it('keeps capitals that belong to the name, lowering only a leading capital', () => {
    expect(inSentence('Failed deliveries')).toBe('failed deliveries');
    expect(inSentence('AI triage')).toBe('AI triage');
    expect(inSentence('INC-000123')).toBe('INC-000123');
    expect(inSentence('x')).toBe('x');
  });

  it('writes waits short and reads the permission key out of the API detail', () => {
    expect(formatWait(20)).toBe('20 s');
    expect(formatWait(0.2)).toBe('1 s');
    expect(formatWait(90)).toBe('2 min');
    expect(permissionKeyFrom({ status: 403, detail: 'permission rules.rule.read is required' })).toBe('rules.rule.read');
    expect(permissionKeyFrom({ status: 403, detail: 'that is not one of your queues' })).toBeUndefined();
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

/*
 * The shared demo's problems (SPEC §4.4, §7.0.4, X-m11): each code has its
 * own sentence and remedy, checked before the status it shares with
 * something else. The words are the contract's; `problem.ts` imports that
 * module for its types only (a value import cost every Help Portal page about
 * 4 kB), so these cases pin every string to it.
 */
describe('describeProblem: the shared demo', () => {
  it('pins every fixed demo string to @itsm/contracts/demo, word for word', () => {
    expect(DEMO_PROBLEM_COPY.sessionEnded).toBe(DEMO_COPY.sessionEnded);
    expect(DEMO_PROBLEM_COPY.continueDemo).toBe(DEMO_COPY.continueDemo);
    expect(`${DEMO_PROBLEM_COPY.unavailable}. ${DEMO_PROBLEM_COPY.unavailableBody}`).toBe(DEMO_COPY.unavailable);
    expect(DEMO_PROBLEM_COPY.disabledBody).toBe(demoDisabledSentence(null));
    expect(DEMO_PROBLEM_COPY.limitBody).toBe(demoLimitSentence(null));
  });

  it('demo_disabled: "Not available in the demo", the feature\'s own sentence, and nothing to press', () => {
    const description = describeProblem({
      status: 403,
      code: DEMO_PROBLEM_CODES.disabled,
      title: 'Not available in the demo',
      detail: demoDisabledSentence('integrations'),
    });
    expect(description).toMatchObject({ kind: 'demoDisabled', tone: 'neutral', icon: 'lock', title: 'Not available in the demo', remedy: 'none' });
    expect(description.body).toBe('This is a shared demo, so connecting to other systems is turned off. Everything else works as in the full product.');
  });

  it.each(DEMO_FEATURES.map((feature) => [feature]))('demo_disabled words %s with the contract\'s sentence', (feature) => {
    expect(describeProblem({ status: 403, code: 'demo_disabled', detail: demoDisabledSentence(feature) }).body).toBe(demoDisabledSentence(feature));
  });

  it('demo_disabled never shows developer prose: anything but the sentence\'s shape reads as the general sentence', () => {
    for (const detail of [undefined, '', 'permission integrations.manage is required', 'This is a shared demo, so <b>x</b>. is turned off. Everything else works as in the full product.']) {
      expect(describeProblem({ status: 403, code: 'demo_disabled', ...(detail === undefined ? {} : { detail }) }).body).toBe(demoDisabledSentence(null));
    }
  });

  it('demo_disabled is not "You don\'t have access": no administrator can grant what the demo turns off', () => {
    const forbidden = describeProblem({ status: 403, code: 'forbidden' }, { context: 'Integrations' });
    const disabled = describeProblem({ status: 403, code: 'demo_disabled' }, { context: 'Integrations' });
    expect(forbidden.kind).toBe('forbidden');
    expect(disabled.kind).toBe('demoDisabled');
    expect(disabled.title).toBe('Not available in the demo');
  });

  it.each([...DEMO_CAP_CATEGORIES.map((category) => [category] as const)])('demo_limit words the %s cap with the contract\'s sentence', (category) => {
    expect(describeProblem({ status: 429, code: 'demo_limit', detail: demoLimitSentence(category) }).body).toBe(demoLimitSentence(category));
  });

  it('demo_limit: a 429 that waiting will not cure — no countdown, no retry, the visit\'s own sentence', () => {
    const description = describeProblem({ status: 429, code: 'demo_limit', retryable: true, detail: demoLimitSentence('writes', { limit: 500 }) });
    expect(description).toMatchObject({ kind: 'demoLimit', tone: 'neutral', title: 'Demo limit reached', remedy: 'none' });
    expect(description.body).toBe("To keep this shared demo tidy for everyone, each visit can make 500 changes. You've reached that limit.");
    expect(describeProblem({ status: 429, code: 'demo_limit', detail: 'rate limited by demo plugin' }).body).toBe(demoLimitSentence(null));
    // The plain rate limit keeps its own copy.
    expect(describeProblem({ status: 429, code: 'rate_limited', retryAfterSeconds: 20 }).kind).toBe('rateLimited');
  });

  it('demo_unavailable: the copy register\'s sentence as a heading and its body, and a retry', () => {
    const description = describeProblem({ status: 503, code: DEMO_PROBLEM_CODES.unavailable }, { context: 'Your queue' });
    expect(description).toMatchObject({ kind: 'demoUnavailable', tone: 'neutral', remedy: 'retry' });
    expect(description.title).toBe('The demo is paused or being prepared');
    expect(`${description.title}. ${description.body}`).toBe(DEMO_COPY.unavailable);
    // The whole demo is paused, not this card: the card's own "Couldn't load" would say less.
    expect(description.title).not.toContain("Couldn't load");
  });

  it('demo_session_ended: "Your demo session ended", and the way back is "Continue the demo"', () => {
    const description = describeProblem({ status: 401, code: DEMO_PROBLEM_CODES.sessionEnded });
    expect(description).toMatchObject({
      kind: 'demoSessionEnded',
      title: 'Your demo session ended',
      body: 'Pick up where you left off — the demo data may have been reset since.',
      remedy: 'signIn',
      remedyLabel: 'Continue the demo',
    });
    // A plain session end keeps "Sign in again".
    expect(describeProblem({ status: 401 }).remedyLabel).toBeUndefined();
  });

  it('demo_reset that reached a page is a re-mint that failed: the visit ended', () => {
    expect(describeProblem({ status: 401, code: DEMO_PROBLEM_CODES.reset })).toMatchObject({ kind: 'demoSessionEnded', remedyLabel: DEMO_COPY.continueDemo });
  });
});

describe('describeProblem: a query that took too long', () => {
  it('query_timeout: nothing is down; a narrower question or a moment later can work', () => {
    expect(describeProblem({ status: 503, code: 'query_timeout' })).toMatchObject({
      kind: 'timeout',
      title: 'That took too long',
      body: 'Try a narrower range, or try again in a moment.',
      remedy: 'retry',
    });
    const card = describeProblem({ status: 503, code: 'query_timeout' }, { context: 'Team trend' });
    expect([card.title, card.body]).toEqual(["Couldn't load team trend", 'That took too long. Try a narrower range, or try again in a moment.']);
    expect(describeProblem({ status: 503, code: 'dependency_unavailable' }).kind).toBe('unavailable');
  });
});

describe('ProblemState', () => {
  it('401: a plain "Sign in again" link to the sign-in route, never prefetched through the app router', () => {
    const { container } = render(
      <TestProvider>
        <ProblemState problem={{ status: 401 }} signInHref="/api/session/login?redirectTo=%2Frules" />
      </TestProvider>,
    );
    const link = container.querySelector('a');
    expect(text(link)).toBe('Sign in again');
    expect(link?.getAttribute('href')).toBe('/api/session/login?redirectTo=%2Frules');
    expect(text(container.querySelector('h2'))).toBe('Your session ended');
  });

  it('401 without a sign-in address reloads, so the server sends the person to sign in', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      const { container } = render(<ProblemState problem={{ status: 401 }} />);
      click(buttonNamed(container, 'Sign in again')!);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('402: explains the plan limit and offers no retry that could not work', () => {
    const onRetry = vi.fn();
    const { container } = render(<ProblemState problem={{ status: 402 }} onRetry={onRetry} />);
    expect(text(container.querySelector('h2'))).toBe('Plan limit reached');
    expect(buttonNamed(container, 'Try again')).toBeUndefined();
  });

  it('403: names the area and the permission, and offers the key only to people who asked for technical keys', () => {
    const problem: Problem = { status: 403, code: 'forbidden', detail: 'permission rules.rule.read is required' };
    const plain = render(
      <TestProvider>
        <ProblemState problem={problem} context="Rules" permissionLabel="Read rules" onRetry={vi.fn()} />
      </TestProvider>,
    );
    expect(text(plain.container.querySelector('h2'))).toBe("You don't have access to Rules");
    expect(text(plain.container)).toContain('This needs the Read rules permission.');
    expect(text(plain.container)).not.toContain('rules.rule.read');
    expect(buttonNamed(plain.container, 'Try again')).toBeUndefined();
    plain.unmount();

    window.localStorage.setItem('itsm-prefs', JSON.stringify({ showKeys: true }));
    const technical = render(
      <TestProvider>
        <ProblemState problem={problem} context="Rules" permissionLabel="Read rules" />
      </TestProvider>,
    );
    expect(text(technical.container.querySelector('code'))).toBe('rules.rule.read');
    expect(buttonNamed(technical.container, 'Copy')).toBeDefined();
  });

  it('403 tenant_suspended: the suspended-workspace state, not "no access"', () => {
    const { container } = render(<ProblemState problem={{ status: 403, code: 'tenant_suspended' }} size="lg" />);
    expect(text(container.querySelector('h2'))).toBe('This workspace is suspended');
    expect(container.firstElementChild?.getAttribute('data-kind')).toBe('suspended');
    expect(container.querySelector('[data-illustration="forbidden"]')).not.toBeNull();
  });

  it('404: says it could not be found, in the context given', () => {
    const { container } = render(<ProblemState problem={{ status: 404 }} context="Rule vip-requester" />);
    expect(text(container.querySelector('h2'))).toBe("Couldn't find rule vip-requester");
  });

  it('409: Reload, which is the caller’s retry when given', () => {
    const onRetry = vi.fn();
    const { container } = render(<ProblemState problem={{ status: 409 }} onRetry={onRetry} />);
    click(buttonNamed(container, 'Reload')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('422: asks for another look, and counts what needs changing', () => {
    const { container } = render(<ProblemState problem={{ status: 422, fieldErrors: { title: 'Required' } }} />);
    expect(text(container.querySelector('h2'))).toBe('Some details need another look');
    expect(text(container)).toContain('One answer needs changing');
  });

  it('429: Retry stays unavailable, with the wait counted down beside it, until retryAfterSeconds has passed', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { container } = render(<ProblemState problem={{ status: 429, retryAfterSeconds: 20 }} onRetry={onRetry} />);
    const retry = (): HTMLButtonElement => buttonNamed(container, 'Try again')!;

    expect(text(container.querySelector('.itsm-ProblemState__wait'))).toBe('Try again in 20 s.');
    expect(retry().disabled).toBe(true);
    const described = retry().getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe('Try again in 20 s.');
    click(retry());
    expect(onRetry).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(text(container.querySelector('.itsm-ProblemState__wait'))).toBe('Try again in 15 s.');

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(text(container.querySelector('.itsm-ProblemState__wait'))).toBe('You can try again now.');
    expect(retry().disabled).toBe(false);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(announcerText('polite')).toBe('You can try again now.');

    click(retry());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('429: when Retry itself brought the 429 back, focus moves to the wait instead of the top of the page', () => {
    const onRetry = vi.fn();
    const view = render(<ProblemState problem={{ status: 503 }} onRetry={onRetry} />);
    const retry = buttonNamed(view.container, 'Try again')!;
    retry.focus();
    click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(<ProblemState problem={{ status: 429, retryAfterSeconds: 30 }} onRetry={onRetry} />);
    expect(document.activeElement?.classList.contains('itsm-ProblemState__wait')).toBe(true);
    expect(text(document.activeElement)).toBe('Try again in 30 s.');
  });

  it('429 on first render takes no focus: nothing was pressed', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    render(<ProblemState problem={{ status: 429, retryAfterSeconds: 30 }} onRetry={vi.fn()} />);
    expect(document.activeElement).toBe(outside);
  });

  it('429: the countdown lives outside the alert, so it is not re-announced every second', () => {
    const { container } = render(<ProblemState problem={{ status: 429, retryAfterSeconds: 20 }} onRetry={vi.fn()} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.contains(container.querySelector('.itsm-ProblemState__wait'))).toBe(false);
  });

  it('502/503: Try again calls the retry; an explicitly non-retryable problem offers none', () => {
    const onRetry = vi.fn();
    const { container, unmount } = render(<ProblemState problem={{ status: 503 }} onRetry={onRetry} />);
    expect(text(container.querySelector('h2'))).toBe("Can't reach the service");
    click(buttonNamed(container, 'Try again')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    const again = render(<ProblemState problem={{ status: 502, retryable: false }} onRetry={onRetry} />);
    expect(buttonNamed(again.container, 'Try again')).toBeUndefined();
  });

  it('shows the Error ID with Copy when there is a digest', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<ProblemState problem={{ status: 500, digest: 'abc123' }} />);
    expect(text(container)).toContain('Error ID abc123');
    await act(async () => {
      click(buttonNamed(container, 'Copy')!);
    });
    expect(writeText).toHaveBeenCalledWith('abc123');
    expect(buttonNamed(container, 'Copied')).toBeDefined();
  });

  it('carries data-itsm-error-boundary only when an error page asks for it', () => {
    const page = renderToStaticMarkup(<ProblemState problem={{ status: 500 }} size="lg" errorBoundary />);
    const card = renderToStaticMarkup(<ProblemState problem={{ status: 500 }} size="sm" />);
    expect(page).toContain('data-itsm-error-boundary=""');
    expect(card).not.toContain('data-itsm-error-boundary');
    // The render pass greps pages for the marker: the stylesheet, which is
    // inlined into some of them, must never mention it.
    expect(componentStylesheet).not.toContain('data-itsm-error-boundary');
  });

  it('uses a heading level to fit where it sits', () => {
    expect(renderToStaticMarkup(<ProblemState problem={{ status: 500 }} />)).toContain('<h2');
    expect(renderToStaticMarkup(<ProblemState problem={{ status: 500 }} size="sm" />)).toContain('<h3');
    expect(renderToStaticMarkup(<ProblemState problem={{ status: 500 }} size="lg" headingLevel={1} />)).toContain('<h1');
  });

  it('offers a way out beside the remedy, through the app’s link', () => {
    const { container } = render(
      <TestProvider>
        <ProblemState
          problem={{ status: 500 }}
          size="lg"
          onRetry={vi.fn()}
          secondaryAction={{ id: 'home', label: 'Go to Command centre', href: '/' }}
        />
      </TestProvider>,
    );
    const home = Array.from(container.querySelectorAll('a')).find((a) => text(a) === 'Go to Command centre');
    expect(home?.getAttribute('href')).toBe('/');
    expect(buttonNamed(container, 'Try again')?.className).toContain('itsm-Button--primary');
  });

  it('demo_session_ended: the session-ended state, its link to the demo-marked sign-in route', () => {
    const { container } = render(
      <TestProvider>
        <ProblemState problem={{ status: 401, code: 'demo_session_ended' }} signInHref="/api/session/login?redirectTo=%2Foverview&demo=1" />
      </TestProvider>,
    );
    expect(container.firstElementChild?.getAttribute('data-kind')).toBe('demoSessionEnded');
    expect(text(container.querySelector('h2'))).toBe('Your demo session ended');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/api/session/login?redirectTo=%2Foverview&demo=1');
    // The remedy's own words, not the plain session end's "Sign in again".
    expect(text(container.querySelector('a'))).toBe('Continue the demo');
    const unlinked = render(<ProblemState problem={{ status: 401, code: 'demo_session_ended' }} />);
    expect(buttonNamed(unlinked.container, 'Continue the demo')).toBeDefined();
    expect(buttonNamed(unlinked.container, 'Sign in again')).toBeUndefined();
  });

  it('demo_limit and demo_disabled: the sentence, and no Try again that could not work', () => {
    const onRetry = vi.fn();
    const limit = render(<ProblemState problem={{ status: 429, code: 'demo_limit', retryable: false, detail: demoLimitSentence('mi.declare') }} onRetry={onRetry} />);
    expect(text(limit.container)).toContain('each visit can declare one major incident');
    expect(buttonNamed(limit.container, 'Try again')).toBeUndefined();
    expect(limit.container.querySelector('.itsm-ProblemState__wait')).toBeNull();
    limit.unmount();
    const disabled = render(<ProblemState problem={{ status: 403, code: 'demo_disabled', detail: demoDisabledSentence('uploads') }} onRetry={onRetry} />);
    expect(text(disabled.container)).toContain('This is a shared demo, so uploading files is turned off.');
    expect(buttonNamed(disabled.container, 'Try again')).toBeUndefined();
  });

  it('demo_unavailable: Try again calls the retry', () => {
    const onRetry = vi.fn();
    const { container } = render(<ProblemState problem={{ status: 503, code: 'demo_unavailable' }} onRetry={onRetry} />);
    expect(text(container.querySelector('h2'))).toBe('The demo is paused or being prepared');
    click(buttonNamed(container, 'Try again')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders on the server with no provider (an error page may have none)', () => {
    expect(() => renderToStaticMarkup(<ProblemState problem={{ status: 429, retryAfterSeconds: 5 }} onRetry={() => undefined} />)).not.toThrow();
  });
});

beforeEach(() => {
  destroyAnnouncer();
});
