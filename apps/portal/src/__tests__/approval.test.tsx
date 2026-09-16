// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * Two rules on the approvals screen, and both cost somebody something when
 * they are wrong.
 *
 * **A rejection has to say why.** An approval with no note costs nobody
 * anything. A rejection with no note is a request that stops dead with no way
 * forward — the requester cannot tell whether to change it, escalate it or
 * give up.
 *
 * **An offline decision is kept, not lost, and not pretended to have
 * happened.** It goes into the outbox and the screen says so, because a
 * decision that silently vanished is one an approver believes they made.
 */

interface Submitted {
  action: string;
  path: string;
  body: Record<string, unknown>;
  summary: string;
}

/** Typed loosely on purpose: the component's contract with `@itsm/pwa` is what is under test. */
const submitOrQueue = vi.fn<(input: Submitted) => Promise<{ ok: boolean; queued: boolean; response?: Response }>>(
  async () => ({ ok: true, queued: false, response: new Response('{}', { status: 200 }) }),
);
const refresh = vi.fn();

vi.mock('@itsm/pwa', () => ({ submitOrQueue: (input: Submitted) => submitOrQueue(input) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const { ApprovalDecision } = await import('../components/ApprovalDecision.js');

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('.itsm-Decision__actions button')] as HTMLButtonElement[];
}

function approve(): HTMLButtonElement {
  const found = buttons().find((button) => button.textContent?.includes('Approve'));
  if (!found) throw new Error('no approve button');
  return found;
}

function reject(): HTMLButtonElement {
  const found = buttons().find((button) => button.textContent?.includes('Reject'));
  if (!found) throw new Error('no reject button');
  return found;
}

/** What was actually posted, so the assertions are about the request the API sees. */
function lastRequest(): Submitted {
  const call = submitOrQueue.mock.calls.at(-1);
  if (!call) throw new Error('nothing was submitted');
  return call[0];
}

beforeEach(() => {
  submitOrQueue.mockClear();
  submitOrQueue.mockResolvedValue({ ok: true, queued: false, response: new Response('{}', { status: 200 }) });
  refresh.mockClear();
});

afterEach(() => cleanupDocument());

describe('deciding an approval', () => {
  it('approves without a note, in the API’s own vocabulary', async () => {
    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({
      action: 'decide-approval',
      path: '/api/proxy/api/v1/approvals/a-1/decide',
      body: { decision: 'approved' },
    });
    expect(lastRequest().body).not.toHaveProperty('comment');
  });

  it('refuses to reject without a reason, and says why', () => {
    render(<ApprovalDecision id="a-1" />);
    click(reject());

    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('cannot act on');
  });

  it('rejects once there is a reason', async () => {
    render(<ApprovalDecision id="a-1" />);
    const box = document.querySelector('textarea');
    if (!box) throw new Error('no comment box');

    type(box, 'The budget for this is not approved until April.');
    await clickAsync(reject());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest().body).toEqual({
      decision: 'rejected',
      comment: 'The budget for this is not approved until April.',
    });
  });

  it('carries a note on an approval too, when there is one', async () => {
    render(<ApprovalDecision id="a-1" />);
    type(document.querySelector('textarea')!, 'Approved, but use the smaller model.');
    await clickAsync(approve());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest().body).toMatchObject({ comment: 'Approved, but use the smaller model.' });
  });

  it('says plainly when somebody else got there first', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 409 }) });

    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('already decided');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('tells the person their offline decision is kept, not sent', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: true });

    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull());
    const note = document.querySelector('[role="status"]')?.textContent ?? '';
    expect(note).toContain('offline');
    // And it is honest about the one thing that could still go wrong.
    expect(note).toContain('unless somebody');
    // Not treated as done: the page does not re-read a list that has not changed.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers neither answer as the safe one', () => {
    // An approval is not the default. A screen that makes it the obvious click
    // produces approvals nobody read.
    render(<ApprovalDecision id="a-1" />);
    expect(approve().className).not.toBe(reject().className);
    expect(buttons()).toHaveLength(2);
  });
});
