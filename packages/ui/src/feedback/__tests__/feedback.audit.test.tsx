// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { EmptyState } from '../../web/EmptyState.js';
import { Skeleton, SkeletonText } from '../../web/Skeleton.js';
import { Banner } from '../Banner.js';
import { ConnectionStatus } from '../ConnectionStatus.js';
import { GlobalBanner } from '../GlobalBanner.js';
import { StateIllustration } from '../Illustration.js';
import { InlineAlert } from '../InlineAlert.js';
import { Meter } from '../Meter.js';
import { ProblemState } from '../ProblemState.js';
import { ProgressBar } from '../ProgressBar.js';
import {
  SkeletonAvatar,
  SkeletonCard,
  SkeletonConversation,
  SkeletonList,
  SkeletonPage,
  SkeletonStat,
  SkeletonTable,
} from '../Skeletons.js';
import { Spinner } from '../Spinner.js';
import { StatusScreen } from '../StatusScreen.js';

/*
 * Every feedback export, read by axe (SPEC §8.0 rule 5), rendered the way a
 * screen uses it: each tone of notice with its action and close button, the
 * empty states at every size, the problem states a person actually meets, a
 * status page with a form, every skeleton page, the indicators labelled and
 * not, and the connection pill both closed and with its tray open.
 */

afterEach(() => cleanupDocument());

async function audit(element: ReactElement): Promise<void> {
  render(<TestProvider>{element}</TestProvider>);
  await expectNoViolations(document.body);
}

const noop = (): void => undefined;

describe('feedback audit', () => {
  it('Banner: every tone, both variants, with actions and dismissal', async () => {
    await audit(
      <div>
        <Banner tone="neutral" title="This rule is paused" />
        <Banner tone="accent" title="Your changes are saved on this device" variant="subtle" dismissKey="audit-tip" />
        <Banner tone="info" title="Search is in reduced mode">
          <p>
            Results may be incomplete. <a href="/help/search">Why?</a>
          </p>
        </Banner>
        <Banner tone="success" title="Published" onDismiss={noop} />
        <Banner tone="warning" title="This policy goes live immediately" action={{ id: 'review', label: 'Review', href: '/sla' }} />
        <Banner tone="danger" title="Couldn't load failed deliveries" live="assertive" action={{ id: 'retry', label: 'Retry' }} onAction={noop} />
        <Banner tone="neutral" title="Draft" action={{ id: 'publish', label: 'Publish', disabled: true, disabledReason: 'Needs a connection' }} />
      </div>,
    );
  });

  it('InlineAlert: each tone, with a control inside', async () => {
    await audit(
      <div>
        <InlineAlert tone="warning">Monthly AI budget reached</InlineAlert>
        <InlineAlert tone="danger" role="alert">
          Couldn't draft a reply.{' '}
          <button type="button" onClick={noop}>
            Retry
          </button>
        </InlineAlert>
        <InlineAlert tone="info" icon="sparkles">
          Suggested by rules
        </InlineAlert>
      </div>,
    );
  });

  it('GlobalBanner: an incident, a session end and an offline copy', async () => {
    await audit(
      <div>
        <GlobalBanner
          tone="danger"
          title="Major incident: email is delayed"
          body="We're working on it."
          action={{ id: 'status', label: 'Status page', href: 'https://status.example', external: true }}
          dismissKey="audit-incident"
        />
        <GlobalBanner tone="warning" title="Your session ended" live="assertive" action={{ id: 'sign-in', label: 'Sign in again', href: '/api/session/login' }} />
        <GlobalBanner tone="neutral" icon="wifi-off" title="Offline" body="Showing the copy from 10:42." live={false} />
      </div>,
    );
  });

  it('EmptyState: every size and tone, with actions', async () => {
    await audit(
      <div>
        <h1>Rules</h1>
        <EmptyState title="No rules yet" description="Rules act on tickets as they arrive." action={{ id: 'new', label: 'Create your first rule', href: '/rules/new' }} />
        <EmptyState tone="search" title="No rules match 'vip'" action={{ id: 'clear', label: 'Clear filters' }} onAction={noop} />
        <EmptyState tone="error" title="Rules could not be loaded" action={<button type="button">Try again</button>} />
        <EmptyState tone="success" size="sm" headingLevel={3} title="Nothing needs you right now" description="Checked 1 min ago" />
        <EmptyState tone="forbidden" size="lg" title="You don't have access to Rules" secondaryAction={{ id: 'back', label: 'Back', href: '/' }} />
        <EmptyState tone="offline" size="lg" title="You're offline">
          <ul>
            <li>
              <a href="/inbox/mine">My work</a>
            </li>
          </ul>
        </EmptyState>
      </div>,
    );
  });

  it('ProblemState: the states a person meets, with the digest and a way out', async () => {
    await audit(
      <div>
        <h1>Error</h1>
        <ProblemState problem={{ status: 401 }} signInHref="/api/session/login" />
        <ProblemState problem={{ status: 403 }} context="Rules" permissionLabel="Read rules" />
        <ProblemState problem={{ status: 429, retryAfterSeconds: 20 }} onRetry={noop} />
        <ProblemState problem={{ status: 503, digest: 'abc123' }} size="lg" onRetry={noop} secondaryAction={{ id: 'home', label: 'Go to Command centre', href: '/' }} errorBoundary />
        <ProblemState problem={{ status: 502 }} size="sm" context="Failed deliveries" onRetry={noop} />
      </div>,
    );
  });

  it('StatusScreen: a branded page with links and a form', async () => {
    render(
      <StatusScreen
        brand="admin"
        illustration="forbidden"
        title="This workspace is suspended"
        body="Contact your provider to find out more."
        actions={[{ id: 'help', label: 'Get help', href: '/help' }]}
      >
        <form method="post" action="/api/session/logout">
          <button type="submit" className="itsm-Button itsm-Button--secondary itsm-Button--lg">
            Sign out
          </button>
        </form>
      </StatusScreen>,
    );
    await expectNoViolations(document.body);
  });

  it('the skeleton family and every page shape', async () => {
    await audit(
      <div>
        <Skeleton width="40%" />
        <SkeletonText lines={2} />
        <SkeletonAvatar />
        <SkeletonStat />
        <SkeletonCard label="Loading deliveries…" />
        <SkeletonTable />
        <SkeletonList />
        <SkeletonConversation />
        <SkeletonPage variant="list" label="Loading rules…" />
        <SkeletonPage variant="detail" />
        <SkeletonPage variant="dashboard" />
        <SkeletonPage variant="form" />
        <SkeletonPage variant="workspace" />
        <SkeletonPage variant="inbox" />
        <SkeletonPage variant="settings" />
      </div>,
    );
  });

  it('Spinner, ProgressBar and Meter, labelled and not', async () => {
    await audit(
      <div>
        <p>
          <Spinner size="sm" /> Saving…
        </p>
        <Spinner label="Loading suggestions" />
        <ProgressBar label="Uploading attachments" value={0.45} showValue />
        <ProgressBar label="Refreshing" size="sm" labelHidden />
        <ProgressBar label="Step 2 of 3" value={0.66} tone="success" />
        <Meter label="AI budget" value={82} max={100} thresholds={{ warning: 80, danger: 95 }} />
        <Meter label="Agents" value={6200} max={5000} softLine={4000} hardLine={5000} />
        <StateIllustration name="empty-chart" />
      </div>,
    );
  });

  it('ConnectionStatus: the pill, and the tray open with its items', async () => {
    const { container } = render(
      <TestProvider>
        <ConnectionStatus
          state="offline"
          pending={2}
          attention={[
            { id: 'a', summary: 'Reply on INC-000123', problem: 'The ticket was closed.', state: 'failed' },
            { id: 'b', summary: 'Approval for REQ-000046', state: 'conflict' },
          ]}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
        />
      </TestProvider>,
    );
    await expectNoViolations(document.body);
    click(container.querySelector('.itsm-ConnectionStatus__pill')!);
    await expectNoViolations(document.body);
  });
});
