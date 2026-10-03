// @vitest-environment jsdom
import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@itsm/sdk';
import { cleanupDocument, click, render, submit, type } from './support/render.js';
import './support/inbox.js';

/**
 * The composer, tested for the one property that costs a service desk a
 * customer: an internal note must never be sendable without the person
 * having said so, and what they are about to do must be visible three ways
 * over — the mode, the words (label, placeholder, Send), and the tint.
 * Then the promises around it: nothing written is lost (drafts per ticket
 * and mode, the text kept on a refusal), one idempotency key per intent,
 * the comment before the status change, and a queue when offline.
 */

const sendComment = vi.fn(async (input: { ticket: string; body: string; internal: boolean; idempotencyKey: string }) => ({
  status: 'sent' as const,
  idempotencyKey: input.idempotencyKey,
  comment: { id: 'c-1', visibility: input.internal ? ('internal' as const) : ('public' as const), createdAt: '' },
}));
let keys = 0;

vi.mock('../client/outbox.js', () => ({
  sendComment: (...args: unknown[]) => sendComment(...(args as [never])),
  newIdempotencyKey: () => `key-${++keys}`,
}));

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

const { Composer, draftKey, sendOptions, DRAFT_DEBOUNCE_MS } = await import('../workspace/Composer.js');
type ComposerProps = import('../workspace/Composer.js').ComposerProps;
type ComposerHandle = import('../workspace/Composer.js').ComposerHandle;

const TICKET = { id: 'id-1', number: 'INC-1', status: 'in_progress', sourceChannel: 'email' };

/** Mounts the composer and opens it, as focusing its one line does. */
function mount(props: Partial<ComposerProps> = {}, { open = true } = {}) {
  const rendered = render(<Composer ticket={TICKET} requesterName="Ada Lovelace" {...props} />);
  if (open) act(() => textarea().focus());
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

function submitButton(): HTMLButtonElement {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[type="submit"]');
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

/** The button's words, without the spinner's hidden "Sending…". */
function label(button: HTMLButtonElement): string {
  return button.querySelector('.itsm-Button__label')?.textContent ?? button.textContent ?? '';
}

/** Lets the menu's positioning and focus settle inside `act`. */
async function settle(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function radio(name: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((element) => element.textContent?.trim() === name) ?? null;
}

beforeEach(() => {
  sendComment.mockClear();
  notify.mockClear();
  keys = 0;
  localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

describe('replying', () => {
  it('rests as one line that says who a reply goes to, and opens on focus', () => {
    mount({}, { open: false });
    expect(document.querySelector('.app-Composer')?.hasAttribute('data-expanded')).toBe(false);
    expect(textarea().placeholder).toBe('Reply to Ada…');
    expect(document.querySelector('button[type="submit"]')).toBeNull();
    act(() => textarea().focus());
    expect(document.querySelector('.app-Composer')?.hasAttribute('data-expanded')).toBe(true);
    expect(submitButton()).not.toBeNull();
  });

  it('starts public, and says so in the label, the button and the placeholder', () => {
    mount();
    expect(document.querySelector('.app-Composer__label')?.textContent).toBe('Reply to the requester');
    expect(label(submitButton())).toBe('Reply to requester');
    expect(textarea().placeholder).toContain('requester will receive');
    expect(textarea().placeholder).toContain('Reply to Ada');
    expect(form().dataset.internal).toBe('false');
    expect(radio('Reply')?.getAttribute('aria-checked')).toBe('true');
    expect(radio('Reply')?.closest('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Message type');
  });

  it('will not send an empty reply', async () => {
    mount();
    expect(submitButton().disabled).toBe(true);
    await submit(form());
    expect(sendComment).not.toHaveBeenCalled();
  });

  it('sends what was typed, publicly, with a key for this intent — and empties the box once it is sent', async () => {
    const onSent = vi.fn();
    mount({ onSent });
    type(textarea(), 'Have you tried restarting it?');
    await submit(form());
    await vi.waitFor(() => expect(sendComment).toHaveBeenCalled());
    expect(sendComment).toHaveBeenCalledWith({ ticket: 'INC-1', body: 'Have you tried restarting it?', internal: false, idempotencyKey: 'key-1' });
    await vi.waitFor(() => expect(textarea().value).toBe(''));
    expect(onSent).toHaveBeenCalledWith({ internal: false });
  });

  it('sends with mod+Enter from the box', async () => {
    mount();
    type(textarea(), 'On its way.');
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(sendComment).toHaveBeenCalledTimes(1));
  });
});

describe('reply or internal note', () => {
  it('changes the label, the button, the placeholder and the tint together', () => {
    mount();
    const note = radio('Internal note');
    if (!note) throw new Error('no internal-note option');
    expect(note.getAttribute('aria-checked')).toBe('false');

    click(note);

    expect(note.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.app-Composer__label')?.textContent).toBe('Internal note');
    expect(label(submitButton())).toBe('Add internal note');
    expect(textarea().placeholder).toContain('Only agents');
    // The note frame is the third statement, never the only one (SC 1.4.1) — and neutral, never amber (v3 §7.1.4, D5).
    expect(form().dataset.internal).toBe('true');
    expect(document.querySelector('.app-Composer__channel')?.textContent).toContain('Internal note · only agents see this');
    expect(document.querySelector('.app-Composer [data-tone="warning"]')).toBeNull();
  });

  it('sends internally only once it has been chosen', async () => {
    mount();
    type(textarea(), 'Waiting on the supplier, do not tell them yet.');
    // The reply's text stays with the reply: a note starts empty.
    click(radio('Internal note')!);
    expect(textarea().value).toBe('');
    type(textarea(), 'Waiting on the supplier, do not tell them yet.');
    await submit(form());
    await vi.waitFor(() => expect(sendComment).toHaveBeenCalled());
    expect(sendComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'Waiting on the supplier, do not tell them yet.', internal: true }));
  });

  it('is absent where the person may not write one', () => {
    mount({ canNote: false });
    expect(radio('Internal note')).toBeNull();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(form().dataset.internal).toBe('false');
  });

  it('says which way a reply goes', () => {
    mount();
    expect(document.querySelector('.app-Composer__channel')?.textContent).toContain('Replying by email');
    cleanupDocument();
    render(<Composer ticket={{ ...TICKET, sourceChannel: 'portal' }} />);
    act(() => textarea().focus());
    expect(document.querySelector('.app-Composer__channel')?.textContent).toContain('Visible in the Help Portal');
  });
});

describe('when the service refuses', () => {
  it('keeps the draft and says so, rather than emptying the box', async () => {
    sendComment.mockRejectedValueOnce(new Error('network'));
    const onSent = vi.fn();
    mount({ onSent });
    type(textarea(), 'Something a person spent two minutes writing.');
    await submit(form());

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Your text is still here');
    expect(textarea().value).toBe('Something a person spent two minutes writing.');
    expect(onSent).not.toHaveBeenCalled();
  });

  it('retries the same text with the same key, and edited text with a new one', async () => {
    sendComment.mockRejectedValueOnce(new ApiError(503, null, 'unavailable'));
    sendComment.mockRejectedValueOnce(new ApiError(503, null, 'unavailable'));
    mount();
    type(textarea(), 'First go.');
    await submit(form());
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    await submit(form());
    await vi.waitFor(() => expect(sendComment).toHaveBeenCalledTimes(2));
    expect(sendComment.mock.calls[0]![0].idempotencyKey).toBe(sendComment.mock.calls[1]![0].idempotencyKey);

    type(textarea(), 'First go, edited.');
    await submit(form());
    await vi.waitFor(() => expect(sendComment).toHaveBeenCalledTimes(3));
    expect(sendComment.mock.calls[2]![0].idempotencyKey).not.toBe(sendComment.mock.calls[0]![0].idempotencyKey);
  });

  it('words the shared demo’s cap as the cap — no “try again” — keeping the text', async () => {
    const sentence = "To keep this shared demo tidy for everyone, each visit can add 40 comments. You've reached that limit.";
    sendComment.mockRejectedValueOnce(
      new ApiError(429, { type: 'https://itsm.example/problems/demo_limit', title: 'Demo limit reached', status: 429, detail: sentence, correlationId: 'c' }, 'capped'),
    );
    mount();
    type(textarea(), 'One comment too many.');
    await submit(form());
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    const alert = document.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain(sentence);
    expect(alert).toContain('Your text is still here.');
    expect(alert).not.toMatch(/too many|try again/i);
    expect(textarea().value).toBe('One comment too many.');
  });

  it('asks for a new sign-in on a 401, keeping the text', async () => {
    sendComment.mockRejectedValueOnce(new ApiError(401, null, 'ended'));
    const onSessionEnded = vi.fn();
    mount({ onSessionEnded });
    type(textarea(), 'Keep me.');
    await submit(form());
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalled());
    expect(textarea().value).toBe('Keep me.');
  });
});

describe('attachments (RV4)', () => {
  it('renders no attach control in any mode: the product has none, and the demo locks uploads at the API', () => {
    mount();
    const none = (): void => {
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(document.querySelector('[data-icon="paperclip"]')).toBeNull();
      expect([...document.querySelectorAll('button')].some((button) => /attach|upload/i.test(`${button.textContent} ${button.getAttribute('aria-label') ?? ''}`))).toBe(false);
    };
    none();
    click(radio('Internal note')!);
    none();
  });
});

describe('drafts', () => {
  it('keeps each mode’s text per ticket on this device and restores it with a note', async () => {
    vi.useFakeTimers();
    const first = mount();
    type(textarea(), 'A reply in progress');
    click(radio('Internal note')!);
    type(textarea(), 'A note in progress');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    });
    expect(JSON.parse(localStorage.getItem(draftKey('id-1')) ?? '{}')).toEqual({ reply: 'A reply in progress', note: 'A note in progress', mode: 'note' });
    first.unmount();

    mount();
    expect(textarea().value).toBe('A note in progress');
    expect(document.querySelector('.app-Composer__restored')?.textContent).toContain('Draft restored');
    click(radio('Reply')!);
    expect(textarea().value).toBe('A reply in progress');
    cleanupDocument();

    // Another ticket starts empty.
    render(<Composer ticket={{ ...TICKET, id: 'id-2', number: 'INC-2' }} />);
    expect(textarea().value).toBe('');
  });

  it('writes what was typed at once when the ticket is left, so j and k never lose a sentence', () => {
    const view = mount();
    type(textarea(), 'Typed just before pressing j');
    view.unmount();
    expect(JSON.parse(localStorage.getItem(draftKey('id-1')) ?? '{}').reply).toBe('Typed just before pressing j');
  });

  it('forgets a mode’s draft once it is sent', async () => {
    mount();
    type(textarea(), 'Done and dusted');
    await submit(form());
    await vi.waitFor(() => expect(textarea().value).toBe(''));
    expect(localStorage.getItem(draftKey('id-1'))).toBeNull();
  });
});

describe('offline', () => {
  it('queues the comment, empties the box and says it will send when the connection is back', async () => {
    sendComment.mockResolvedValueOnce({ status: 'queued', idempotencyKey: 'key-1' } as never);
    const onQueued = vi.fn();
    const onSent = vi.fn();
    mount({ onQueued, onSent, online: false });
    expect(document.querySelector('.app-Composer__hint')?.textContent).toContain('queued');
    type(textarea(), 'Sent from the train.');
    await submit(form());
    await vi.waitFor(() => expect(onQueued).toHaveBeenCalledWith({ internal: false, body: 'Sent from the train.' }));
    expect(onSent).not.toHaveBeenCalled();
    expect(textarea().value).toBe('');
    expect(notify).toHaveBeenCalledWith('Queued · sends when you’re back online', expect.objectContaining({ tone: 'info' }));
  });
});

describe('send and move', () => {
  it('offers only the moves the state allows', () => {
    expect(sendOptions('reply', 'in_progress').map((option) => option.label)).toEqual(['Reply and wait for requester', 'Reply and resolve']);
    expect(sendOptions('reply', 'pending_requester').map((option) => option.label)).toEqual(['Reply and resolve', 'Reply and keep open']);
    expect(sendOptions('note', 'in_progress').map((option) => option.label)).toEqual(['Note and wait on supplier']);
    expect(sendOptions('reply', 'closed')).toEqual([]);
  });

  it('sends the comment first, then the status change with the reply as its reason', async () => {
    const order: string[] = [];
    sendComment.mockImplementationOnce(async (input) => {
      order.push('comment');
      return { status: 'sent', idempotencyKey: input.idempotencyKey, comment: null } as never;
    });
    const onMove = vi.fn(async () => {
      order.push('move');
      return true;
    });
    const handle = createRef<ComposerHandle>();
    mount({ canMove: true, onMove, handle });
    type(textarea(), 'Fixed by resetting the token.');
    // The main segment is still the form's only submit button.
    expect(label(submitButton())).toBe('Reply to requester');
    expect(document.querySelector('button[aria-label="More options for Reply to requester"]')?.getAttribute('type')).toBe('button');

    act(() => handle.current!.openSendOptions());
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    const resolve = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Reply and resolve'))!;
    click(resolve);
    await settle();
    await vi.waitFor(() => expect(onMove).toHaveBeenCalled());
    expect(order).toEqual(['comment', 'move']);
    expect(onMove).toHaveBeenCalledWith('resolved', { reason: 'Fixed by resetting the token.' });
  });

  it('refuses status changes offline, and says why', async () => {
    const handle = createRef<ComposerHandle>();
    mount({ canMove: true, online: false, handle });
    type(textarea(), 'Resolved from the train.');
    act(() => handle.current!.openSendOptions());
    await settle();
    const resolve = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Reply and resolve'))!;
    expect(resolve.getAttribute('aria-disabled')).toBe('true');
    expect(resolve.textContent).toContain('Needs a connection');
    click(resolve);
    await settle();
    expect(sendComment).not.toHaveBeenCalled();
  });
});
