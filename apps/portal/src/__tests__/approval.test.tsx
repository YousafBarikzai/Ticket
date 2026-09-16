// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * The one rule on the approvals screen worth protecting: a rejection has to
 * say why.
 *
 * An approval with no note costs nobody anything. A rejection with no note is
 * a request that stops dead with no way forward — the requester cannot tell
 * whether to change it, escalate it or give up. So the screen refuses it, and
 * says so, rather than sending a "no" that helps nobody.
 */

const decide = vi.fn(async () => ({ id: 'a-1', status: 'decided' }));
const refresh = vi.fn();

vi.mock('../client/api.js', () => ({ api: { decide: (...args: unknown[]) => decide(...(args as [])) } }));
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

beforeEach(() => {
  decide.mockClear();
  refresh.mockClear();
});

afterEach(() => cleanupDocument());

describe('deciding an approval', () => {
  it('approves without a note', async () => {
    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());
    await vi.waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('a-1', 'approved', undefined);
  });

  it('refuses to reject without a reason, and says why', () => {
    render(<ApprovalDecision id="a-1" />);
    click(reject());

    expect(decide).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('cannot act on');
  });

  it('rejects once there is a reason', async () => {
    render(<ApprovalDecision id="a-1" />);
    const box = document.querySelector('textarea');
    if (!box) throw new Error('no comment box');

    type(box, 'The budget for this is not approved until April.');
    await clickAsync(reject());

    await vi.waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('a-1', 'rejected', 'The budget for this is not approved until April.');
  });

  it('carries a note on an approval too, when there is one', async () => {
    render(<ApprovalDecision id="a-1" />);
    type(document.querySelector('textarea')!, 'Approved, but use the smaller model.');
    await clickAsync(approve());
    await vi.waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('a-1', 'approved', 'Approved, but use the smaller model.');
  });

  it('says plainly when somebody else got there first', async () => {
    const { ApiError } = await import('@itsm/sdk');
    decide.mockRejectedValueOnce(new ApiError(409, null, 'conflict'));

    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('already decided');
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
