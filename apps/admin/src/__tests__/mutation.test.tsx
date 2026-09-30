// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@itsm/sdk';
import type { Mutation, MutationOptions } from '../client/useMutation.js';

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({ ...(await original<typeof import('@itsm/ui')>()), notify: (...args: unknown[]) => notify(...args) }));

const { respondTo, useMutation, useSessionEnded, reportSessionEnded } = await import('../client/useMutation.js');
const { problemFrom, isTenantSuspended } = await import('../problem.js');
const { cleanupDocument, render } = await import('./support/render.js');

/**
 * The one write path (SPEC §4.10): what each answer from the API turns into
 * on screen, as a table the tests pin, and the hook doing it — success toast
 * and refresh, field errors to the form, the session-ended dialog, retry.
 */

function apiError(status: number, type = 'about:blank', errors?: { field: string; code: string; message: string }[]): ApiError {
  return new ApiError(status, { type, title: 'x', status, correlationId: 'c', ...(errors ? { errors } : {}) }, `status ${status}`);
}

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
});

describe('a failure, as the console answers it', () => {
  it('sends field errors to the form and conflicts to the conflict dialog', () => {
    expect(respondTo(problemFrom(apiError(422, 'about:blank', [{ field: 'name', code: 'too_short', message: 'Too short' }])))).toEqual({ kind: 'fields' });
    expect(respondTo(problemFrom(apiError(409)))).toEqual({ kind: 'conflict' });
    expect(respondTo(problemFrom(apiError(428)))).toEqual({ kind: 'conflict' });
  });

  it('asks the person to sign in again after a 401, and lets the frame handle a suspended workspace', () => {
    expect(respondTo(problemFrom(apiError(401)))).toEqual({ kind: 'session' });
    const suspended = apiError(403, 'https://docs.itsm.example/problems/tenant_suspended');
    expect(isTenantSuspended(suspended)).toBe(true);
    expect(problemFrom(suspended).code).toBe('tenant_suspended');
    expect(respondTo(problemFrom(suspended))).toEqual({ kind: 'suspended' });
  });

  it('refreshes permissions after a plain 403', () => {
    const response = respondTo(problemFrom(apiError(403)), 'Couldn’t publish the rule');
    expect(response).toMatchObject({ kind: 'toast', title: 'Couldn’t publish the rule', retry: false, refresh: true });
  });

  it('points a plan limit at usage, and holds a 429 until it may be retried', () => {
    expect(respondTo(problemFrom(apiError(402)))).toMatchObject({ kind: 'toast', title: 'Your organisation has reached a plan limit', usage: true, retry: false });
    const limited = respondTo({ status: 429, retryAfterSeconds: 20 }, undefined, 1_000);
    expect(limited).toMatchObject({ kind: 'toast', retry: true, retryAt: 21_000, description: 'Try again in 20 s.' });
  });

  it('offers Retry when the service or the network failed', () => {
    expect(respondTo(problemFrom(apiError(503)))).toMatchObject({ kind: 'toast', retry: true });
    expect(respondTo(problemFrom(new TypeError('Failed to fetch')))).toMatchObject({ kind: 'toast', retry: true });
    expect(problemFrom(new TypeError('Failed to fetch'))).toEqual({ status: 503, retryable: true });
    expect(respondTo(problemFrom(apiError(400)))).toMatchObject({ kind: 'toast', retry: false });
  });
});

describe('useMutation', () => {
  let mutation: Mutation<[string], { key: string }> | null = null;
  let ended: [boolean, () => void] | null = null;

  function Probe({ fn, options }: { readonly fn: (key: string) => Promise<{ key: string }>; readonly options?: MutationOptions<{ key: string }> }): ReactNode {
    mutation = useMutation(fn, options);
    ended = useSessionEnded();
    return null;
  }

  beforeEach(() => {
    mutation = null;
    ended = null;
  });

  it('toasts, refreshes the server data and resolves ok on success', async () => {
    render(<Probe fn={async (key) => ({ key })} options={{ success: (value: { key: string }) => `Rule ${value.key} published` }} />);
    let result: unknown;
    await act(async () => {
      result = await mutation!.run('vip');
    });
    expect(result).toEqual({ ok: true, value: { key: 'vip' } });
    expect(notify).toHaveBeenCalledWith('Rule vip published', expect.objectContaining({ tone: 'success' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(mutation!.pending).toBe(false);
  });

  it('offers Undo only when there is a safe inverse', async () => {
    const undo = vi.fn(async () => undefined);
    render(<Probe fn={async (key) => ({ key })} options={{ success: 'Archived', undo }} />);
    await act(async () => {
      await mutation!.run('vip');
    });
    const options = notify.mock.calls[0]![1] as { undo?: () => Promise<void> };
    await act(async () => {
      await options.undo!();
    });
    expect(undo).toHaveBeenCalledWith({ key: 'vip' });
  });

  it('hands field errors back without a toast or a refresh', async () => {
    render(
      <Probe
        fn={async () => {
          throw apiError(422, 'about:blank', [{ field: 'name', code: 'too_short', message: 'Give it a longer name' }]);
        }}
      />,
    );
    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await mutation!.run('x');
    });
    expect(result?.ok).toBe(false);
    expect(mutation!.fieldErrors).toEqual({ name: 'Give it a longer name' });
    expect(notify).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('opens “Your session ended” after a 401', async () => {
    render(
      <Probe
        fn={async () => {
          throw apiError(401);
        }}
      />,
    );
    expect(ended![0]).toBe(false);
    await act(async () => {
      await mutation!.run('x');
    });
    expect(ended![0]).toBe(true);
    act(() => ended![1]());
    expect(ended![0]).toBe(false);
  });

  it('puts a Retry on a failure the service may recover from, which runs the same call again', async () => {
    const fn = vi.fn(async (): Promise<{ key: string }> => {
      throw apiError(503);
    });
    render(<Probe fn={fn} options={{ failure: 'Couldn’t save the policy' }} />);
    await act(async () => {
      await mutation!.run('sla');
    });
    expect(notify).toHaveBeenCalledWith('Couldn’t save the policy', expect.objectContaining({ tone: 'danger', action: expect.objectContaining({ label: 'Retry' }) }));
    const retry = (notify.mock.calls[0]![1] as { action: { onClick(): void } }).action;
    await act(async () => {
      retry.onClick();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('sla');
  });

  it('lets the frame be told from outside a mutation, once', () => {
    render(<Probe fn={async (key) => ({ key })} />);
    act(() => {
      reportSessionEnded();
      reportSessionEnded();
    });
    expect(ended![0]).toBe(true);
    act(() => ended![1]());
  });
});
