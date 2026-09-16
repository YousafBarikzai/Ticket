// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, click, render, submit, type } from './support/render.js';

/**
 * The composer, tested for the one property that costs a service desk a
 * customer: an internal note must never be sendable without the person having
 * said so, and what they are about to do must be visible three ways over.
 */

const comment = vi.fn(async () => ({ id: 'c-1', visibility: 'public' as const, createdAt: '' }));
const refresh = vi.fn();

vi.mock('../client/api.js', () => ({ api: { comment: (...args: unknown[]) => comment(...(args as [])) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { CommentComposer } = await import('../components/CommentComposer.js');

function mount(initial = '') {
  let value = initial;
  const rendered = render(
    <CommentComposer
      ticketNumber="INC-1"
      value={value}
      onValueChange={(next) => {
        value = next;
        rendered.root.render(
          <CommentComposer ticketNumber="INC-1" value={value} onValueChange={() => undefined} />,
        );
      }}
    />,
  );
  return rendered;
}

function textarea(): HTMLTextAreaElement {
  const found = document.querySelector('textarea');
  if (!found) throw new Error('no composer');
  return found;
}

function form(): HTMLFormElement {
  const found = document.querySelector('form');
  if (!found) throw new Error('no form');
  return found;
}

beforeEach(() => {
  comment.mockClear();
  refresh.mockClear();
});

afterEach(() => cleanupDocument());

describe('replying', () => {
  it('starts public, and says so in the label, the button and the placeholder', () => {
    mount();
    expect(document.querySelector('.itsm-Composer__label')?.textContent).toBe('Reply to the requester');
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe('Reply to requester');
    expect(textarea().placeholder).toContain('requester will receive');
    expect(form().dataset.internal).toBe('false');
  });

  it('will not send an empty reply', async () => {
    mount();
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(button?.disabled).toBe(true);
    await submit(form());
    expect(comment).not.toHaveBeenCalled();
  });

  it('sends what was typed, publicly', async () => {
    mount();
    type(textarea(), 'Have you tried restarting it?');
    await submit(form());
    await vi.waitFor(() => expect(comment).toHaveBeenCalled());
    expect(comment).toHaveBeenCalledWith('INC-1', 'Have you tried restarting it?', false);
  });
});

describe('the internal-note switch', () => {
  it('changes the label, the button, the placeholder and the tint together', () => {
    mount();
    const toggle = document.querySelector<HTMLButtonElement>('button[role="switch"]');
    if (!toggle) throw new Error('no switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.itsm-Composer__label')?.textContent).toBe('Internal note');
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe('Add internal note');
    expect(textarea().placeholder).toContain('Only agents');
    // The tint is the third statement, never the only one (SC 1.4.1).
    expect(form().dataset.internal).toBe('true');
  });

  it('sends internally only once it has been switched', async () => {
    mount();
    type(textarea(), 'Waiting on the supplier, do not tell them yet.');
    click(document.querySelector<HTMLButtonElement>('button[role="switch"]')!);
    await submit(form());
    await vi.waitFor(() => expect(comment).toHaveBeenCalled());
    expect(comment).toHaveBeenCalledWith('INC-1', 'Waiting on the supplier, do not tell them yet.', true);
  });

  it('is absent where the person may not write one', () => {
    render(<CommentComposer ticketNumber="INC-1" canBeInternal={false} value="" onValueChange={() => undefined} />);
    expect(document.querySelector('button[role="switch"]')).toBeNull();
  });
});

describe('when the API refuses', () => {
  it('keeps the draft and says so, rather than emptying the box', async () => {
    comment.mockRejectedValueOnce(new Error('network'));
    mount();
    type(textarea(), 'Something a person spent two minutes writing.');
    await submit(form());

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Your text is still here');
    expect(textarea().value).toBe('Something a person spent two minutes writing.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
