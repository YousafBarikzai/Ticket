// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmDialogProps } from '../../overlays/ConfirmDialog.js';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { Button } from '../../web/Button.js';
import { Checkbox } from '../../web/Checkbox.js';
import { FormField } from '../../web/FormField.js';
import { Input } from '../../web/Input.js';
import { Form, FormActions, useFormState, type FormProps } from '../Form.js';
import { FormSection } from '../FormSection.js';
import { readDraft, writeDraft } from '../drafts.js';

/*
 * `Form` (SPEC §4.4): what a failed submit shows and where focus goes, the
 * browser's constraints in the product's words, drafts saved and restored,
 * the leave guard and the save shortcut.
 */

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

// The leave confirmation, as a plain double: this file tests the form's side of the contract.
vi.mock('../../overlays/ConfirmDialog.js', () => ({
  ConfirmDialog({ open, onOpenChange, spec, onConfirm }: ConfirmDialogProps): ReactNode {
    if (!open) return null;
    return (
      <div role="alertdialog" aria-modal="true" aria-label={spec.title}>
        <p>{spec.body}</p>
        <button type="button" onClick={() => onOpenChange(false)}>
          {spec.cancelLabel}
        </button>
        <button type="button" onClick={() => void onConfirm()}>
          {spec.confirmLabel}
        </button>
      </div>
    );
  },
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  window.localStorage.clear();
});

function Fields(): ReactNode {
  return (
    <>
      <FormField label="Title" required>
        <Input name="title" />
      </FormField>
      <FormField label="Contact e-mail">
        <Input name="email" type="email" />
      </FormField>
      <FormField label="Password">
        <Input name="password" type="password" />
      </FormField>
    </>
  );
}

function renderForm(props: Partial<FormProps> & { readonly children?: FormProps['children'] }, provider = false): void {
  const form = (
    <Form onSubmit={props.onSubmit ?? (async () => undefined)} {...props}>
      {props.children ?? (
        <>
          <Fields />
          <FormActions>
            <Button type="submit" variant="primary">
              Save changes
            </Button>
          </FormActions>
        </>
      )}
    </Form>
  );
  render(provider ? <TestProvider>{form}</TestProvider> : form);
}

const field = (label: string): HTMLInputElement => {
  const labelElement = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.replace('*', '').trim() === label);
  const input = labelElement ? document.getElementById(labelElement.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field ${label}`);
  return input;
};

const submit = async (): Promise<void> => {
  const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('no submit button');
  click(button);
  await settle();
};

const summary = (): HTMLElement | null => document.querySelector('.itsm-FormErrorSummary');

describe('Form: a failed submit', () => {
  it('maps field errors onto their fields and focuses a summary that links to them', async () => {
    const onSubmit = vi.fn(async () => ({ fieldErrors: { email: 'Enter an e-mail address like jo@example.com', title: 'Title is taken' } }));
    renderForm({ onSubmit });
    typeInto(field('Title'), 'Printer');
    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const box = summary();
    expect(box?.getAttribute('role')).toBe('alert');
    expect(activeElement()).toBe(box);
    // In the order the fields are on the page, not the order the server listed them.
    const links = [...(box?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => link.textContent)).toEqual(['Title is taken', 'Enter an e-mail address like jo@example.com']);
    expect(links[0]?.getAttribute('href')).toBe(`#${field('Title').id}`);

    // Each field shows its own message, described and marked invalid.
    const title = field('Title');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    const described = (title.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Title is taken');
  });

  it('takes the person from a summary link into the field', async () => {
    renderForm({ onSubmit: async () => ({ fieldErrors: { email: 'Enter an e-mail address' } }) });
    typeInto(field('Title'), 'Printer');
    await submit();
    const link = summary()?.querySelector('a');
    if (!link) throw new Error('no link');
    click(link);
    expect(activeElement()).toBe(field('Contact e-mail'));
  });

  it('drops a message once its field is edited, and the summary once nothing is left', async () => {
    renderForm({ onSubmit: async () => ({ fieldErrors: { title: 'Title is taken' } }) });
    typeInto(field('Title'), 'Printer');
    await submit();
    expect(summary()).not.toBeNull();

    typeInto(field('Title'), 'Printer on floor 3');
    expect(field('Title').getAttribute('aria-invalid')).toBeNull();
    expect(summary()).toBeNull();
  });

  it('focuses the summary again on a second failed attempt, not while fields are fixed', async () => {
    renderForm({ onSubmit: async () => ({ fieldErrors: { title: 'Title is taken', email: 'Enter an e-mail address' } }) });
    typeInto(field('Title'), 'Printer');
    await submit();
    focus(field('Title'));
    typeInto(field('Title'), 'Printer 2');
    // One message fixed: the summary stays, focus stays in the field being worked on.
    expect(summary()?.querySelectorAll('a')).toHaveLength(1);
    expect(activeElement()).not.toBe(summary());

    await submit();
    expect(activeElement()).toBe(summary());
  });

  it('shows a message for the whole form, and a fallback when onSubmit throws', async () => {
    renderForm({ onSubmit: async () => ({ message: 'Your organisation has reached a plan limit.' }) });
    typeInto(field('Title'), 'Printer');
    await submit();
    expect(summary()?.textContent).toContain('Your organisation has reached a plan limit.');
    cleanupDocument();

    renderForm({
      onSubmit: async () => {
        throw new Error('network');
      },
    });
    typeInto(field('Title'), 'Printer');
    await submit();
    expect(summary()?.textContent).toContain("That didn't save. Your changes are still here");
  });

  it('opens a closed section that holds a field with a problem', async () => {
    render(
      <Form onSubmit={async () => ({ fieldErrors: { retries: 'Enter 10 or fewer' } })}>
        <FormSection title="Advanced" collapsible>
          <FormField label="Retries">
            <Input name="retries" />
          </FormField>
        </FormSection>
        <Button type="submit">Save</Button>
      </Form>,
    );
    expect(document.querySelector('details')?.open).toBe(false);
    await submit();
    expect(document.querySelector('details')?.open).toBe(true);
    click(summary()!.querySelector('a')!);
    expect(activeElement()?.getAttribute('name')).toBe('retries');
  });

  it("reports the browser's constraints in the product's words, without calling onSubmit", async () => {
    const onSubmit = vi.fn(async () => undefined);
    renderForm({ onSubmit });
    typeInto(field('Contact e-mail'), 'not-an-address');
    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect([...(summary()?.querySelectorAll('a') ?? [])].map((link) => link.textContent)).toEqual([
      'Title is required',
      'Contact e-mail must be an e-mail address',
    ]);
  });
});

describe('Form: submitting', () => {
  it('is busy while onSubmit runs and ignores a second submit', async () => {
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderForm({
      onSubmit,
      children: (state) => (
        <>
          <Fields />
          <Button type="submit" loading={state.submitting}>
            Save changes
          </Button>
        </>
      ),
    });
    typeInto(field('Title'), 'Printer');
    await submit();
    const form = document.querySelector('form');
    expect(form?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('button[type="submit"]')?.getAttribute('aria-busy')).toBe('true');

    act(() => {
      form?.requestSubmit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(form?.getAttribute('aria-busy')).toBeNull();
  });

  it('tells components inside it whether it is dirty or busy', () => {
    function Status(): ReactNode {
      const { dirty } = useFormState();
      return <p data-testid="status">{dirty ? 'Unsaved changes' : 'Saved'}</p>;
    }
    renderForm({
      children: (
        <>
          <Fields />
          <Status />
        </>
      ),
    });
    const status = (): string | null | undefined => document.querySelector('[data-testid="status"]')?.textContent;
    expect(status()).toBe('Saved');
    typeInto(field('Title'), 'Printer');
    expect(status()).toBe('Unsaved changes');
    typeInto(field('Title'), '');
    expect(status()).toBe('Saved');
  });

  it('submits with mod+S when asked to', async () => {
    const onSubmit = vi.fn(async () => undefined);
    renderForm({ onSubmit, saveShortcut: true }, true);
    typeInto(field('Title'), 'Printer');
    press(field('Title'), 's', { ctrlKey: true });
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('Form: drafts', () => {
  const autosave = { key: 'itsm-draft:test', version: '3' };

  it('saves a draft after the interval, without the password, and shows when', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderForm({ autosave }, true);
    typeInto(field('Title'), 'Printer on floor 3');
    typeInto(field('Password'), 'hunter2');
    expect(readDraft('itsm-draft:test')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    const draft = readDraft<[string, string][]>('itsm-draft:test');
    expect(draft?.version).toBe('3');
    expect(draft?.value).toEqual([
      ['title', 'Printer on floor 3'],
      ['email', ''],
    ]);
    // Beside the actions, in the actions bar.
    expect(document.querySelector('.itsm-Form__actions .itsm-DraftStatus')?.textContent).toMatch(/^Draft saved · \d{2}:\d{2}$/);
  });

  it('restores a draft on opening, says so, and can discard it', async () => {
    writeDraft('itsm-draft:test', '3', [
      ['title', 'From last time'],
      ['email', 'jo@example.com'],
    ]);
    renderForm({ autosave }, true);
    await settle();

    expect(field('Title').value).toBe('From last time');
    expect(field('Contact e-mail').value).toBe('jo@example.com');
    const notice = document.querySelector('.itsm-DraftNotice');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('Draft restored');

    const discard = [...(notice?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Discard');
    if (!discard) throw new Error('no discard');
    click(discard);
    await settle();
    expect(field('Title').value).toBe('');
    expect(readDraft('itsm-draft:test')).toBeNull();
    expect(document.querySelector('.itsm-DraftNotice')).toBeNull();
  });

  it('drops a draft saved for another version of the form, and says why', async () => {
    writeDraft('itsm-draft:test', '2', [['title', 'Old shape']]);
    renderForm({ autosave }, true);
    await settle();
    expect(field('Title').value).toBe('');
    expect(readDraft('itsm-draft:test')).toBeNull();
    expect(document.querySelector('.itsm-DraftNotice')?.textContent).toContain('This form changed since your draft was saved');
  });

  it('restores ticked boxes by clicking them, so controlled state hears it', async () => {
    function Controlled(): ReactNode {
      const [urgent, setUrgent] = useState(false);
      return (
        <>
          <Checkbox name="urgent" value="yes" label="This is urgent" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} />
          <p data-testid="urgent">{urgent ? 'urgent' : 'not urgent'}</p>
        </>
      );
    }
    writeDraft('itsm-draft:test', '3', [['urgent', 'yes']]);
    renderForm({ autosave, children: <Controlled /> }, true);
    await settle();
    expect(document.querySelector('[data-testid="urgent"]')?.textContent).toBe('urgent');
  });

  it('forgets the draft of a request that was sent, even when the form went away first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    function Page(): ReactNode {
      const [sent, setSent] = useState(false);
      if (sent) return <p>Requested</p>;
      return (
        <TestProvider>
          <Form
            autosave={autosave}
            onSubmit={async () => {
              // The caller moves on before resolving: the form unmounts, flushing its draft.
              setSent(true);
              await Promise.resolve();
            }}
          >
            <Fields />
            <Button type="submit">Send</Button>
          </Form>
        </TestProvider>
      );
    }
    render(<Page />);
    typeInto(field('Title'), 'Printer');
    await submit();
    await settle(10);
    expect(document.body.textContent).toContain('Requested');
    expect(readDraft('itsm-draft:test')).toBeNull();
  });

  it('forgets the draft once the form is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderForm({ autosave }, true);
    typeInto(field('Title'), 'Printer');
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(readDraft('itsm-draft:test')).not.toBeNull();
    await submit();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(readDraft('itsm-draft:test')).toBeNull();
  });
});

describe('Form: leaving', () => {
  it('asks before following a link with unsaved changes, and goes if told to', async () => {
    const router = testRouter();
    render(
      <TestProvider router={router}>
        <a href="/tickets">All tickets</a>
        <Form onSubmit={async () => undefined} dirtyGuard>
          <Fields />
        </Form>
      </TestProvider>,
    );
    const link = document.querySelector('a[href="/tickets"]');
    if (!link) throw new Error('no link');
    // Stands in for the router's own link handler (and stops jsdom navigating).
    let reachedRouter = 0;
    const router$ = (event: Event): void => {
      reachedRouter += 1;
      event.preventDefault();
    };
    document.addEventListener('click', router$);

    // Clean: nothing to ask, the router navigates.
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(reachedRouter).toBe(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    typeInto(field('Title'), 'Printer');
    const dirty = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(dirty);
    });
    // Caught before the router saw it.
    expect(dirty.defaultPrevented).toBe(true);
    expect(reachedRouter).toBe(1);
    document.removeEventListener('click', router$);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Discard changes?');

    const leave = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Discard changes');
    if (!leave) throw new Error('no confirm');
    click(leave);
    await settle();
    expect(router.push).toHaveBeenCalledWith('/tickets');
  });

  it('holds the tab open with the browser prompt while dirty', () => {
    renderForm({ dirtyGuard: true });
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    typeInto(field('Title'), 'Printer');
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });
});
