// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { FormField } from '../../web/FormField.js';
import { Input } from '../../web/Input.js';
import { useDraft, readDraft, writeDraft } from '../drafts.js';
import { DraftNotice, DraftStatus } from '../Draft.js';
import { FormErrorSummary } from '../FormErrorSummary.js';
import { FormSection } from '../FormSection.js';

/*
 * The form kit's smaller parts: `FormSection` structure and headings,
 * `FormErrorSummary` focus and links, and `useDraft` for state an
 * application holds itself.
 */

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('FormSection', () => {
  it('is a group named by its heading, at the level asked for', () => {
    render(
      <FormSection title="Notifications" description="Where we tell you about changes.">
        <FormField label="E-mail">
          <Input />
        </FormField>
      </FormSection>,
    );
    const group = document.querySelector('[role="group"]');
    const heading = document.getElementById(group?.getAttribute('aria-labelledby') ?? '');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent).toBe('Notifications');
    expect(group?.textContent).toContain('Where we tell you about changes.');
    cleanupDocument();

    render(
      <FormSection title="Advanced" headingLevel={3}>
        <p>x</p>
      </FormSection>,
    );
    expect(document.querySelector('h3')?.textContent).toBe('Advanced');
  });

  it('puts guidance beside the fields and marks a two-column grid', () => {
    render(
      <FormSection title="Hours" columns={2} aside={<p>Hours apply in the team's time zone.</p>}>
        <FormField label="Start">
          <Input />
        </FormField>
      </FormSection>,
    );
    expect(document.querySelector('.itsm-FormSection__header .itsm-FormSection__aside')?.textContent).toBe("Hours apply in the team's time zone.");
    expect(document.querySelector('.itsm-FormSection__grid')?.getAttribute('data-columns')).toBe('2');
  });

  it('discloses progressively as a native details element, closed unless asked', () => {
    render(
      <FormSection title="Advanced" description="Settings most people never change." collapsible>
        <FormField label="Retry limit">
          <Input />
        </FormField>
      </FormSection>,
    );
    const details = document.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary h2')?.textContent).toBe('Advanced');
    cleanupDocument();

    render(
      <FormSection title="Advanced" collapsible defaultOpen>
        <p>x</p>
      </FormSection>,
    );
    expect(document.querySelector('details')?.open).toBe(true);
  });
});

describe('FormErrorSummary', () => {
  function Page({ attempt }: { readonly attempt: number }): ReactNode {
    return (
      <>
        <FormErrorSummary
          focusKey={attempt}
          errors={[
            { fieldId: 'summary-field', message: 'Enter a summary' },
            { fieldId: '', message: 'Your plan does not include this' },
          ]}
        />
        <FormField label="Summary" id="summary-field">
          <Input />
        </FormField>
        <button type="button">Other</button>
      </>
    );
  }

  it('is an alert named by its title, focused when it appears', () => {
    render(<Page attempt={1} />);
    const summary = document.querySelector<HTMLElement>('.itsm-FormErrorSummary');
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(document.getElementById(summary?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('There is a problem');
    expect(activeElement()).toBe(summary);
  });

  it('links each problem to its field; one with no field is plain text', () => {
    render(<Page attempt={1} />);
    const items = [...document.querySelectorAll('.itsm-FormErrorSummary__item')];
    expect(items[0]?.querySelector('a')?.getAttribute('href')).toBe('#summary-field');
    expect(items[1]?.querySelector('a')).toBeNull();
    click(items[0]!.querySelector('a')!);
    expect(activeElement()?.id).toBe('summary-field');
  });

  it('takes focus again only when the focus key changes', () => {
    const view = render(<Page attempt={1} />);
    const other = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Other')!;
    act(() => other.focus());
    view.rerender(<Page attempt={1} />);
    expect(activeElement()).toBe(other);
    view.rerender(<Page attempt={2} />);
    expect(activeElement()?.classList.contains('itsm-FormErrorSummary')).toBe(true);
  });

  it('leaves focus alone when told to, and renders nothing with nothing to say', () => {
    render(<FormErrorSummary errors={[{ fieldId: 'x', message: 'Enter a value' }]} autoFocus={false} headingLevel={3} />);
    expect(activeElement()).toBe(document.body);
    expect(document.querySelector('.itsm-FormErrorSummary h3')).not.toBeNull();
    cleanupDocument();
    render(<FormErrorSummary errors={[]} />);
    expect(document.querySelector('.itsm-FormErrorSummary')).toBeNull();
  });
});

describe('useDraft, for state the application holds', () => {
  interface Answers {
    readonly [field: string]: string;
  }

  function Report({ draftKey = 'itsm-draft:report:u-1' }: { readonly draftKey?: string }): ReactNode {
    const [answers, setAnswers] = useState<Answers>({ title: '' });
    const draft = useDraft<Answers>({ key: draftKey, version: '1', value: answers, onRestore: setAnswers });
    return (
      <div>
        <DraftNotice notice={draft.notice} onDiscard={() => { draft.discard(); setAnswers({ title: '' }); }} onDismiss={draft.dismissNotice} />
        <label htmlFor="title">Title</label>
        <input id="title" value={answers.title} onChange={(event) => setAnswers({ title: event.target.value })} />
        <DraftStatus savedAt={draft.savedAt} />
      </div>
    );
  }

  const title = (): HTMLInputElement => document.getElementById('title') as HTMLInputElement;

  it('saves at most once per interval, and removes a draft that goes back to empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<Report />);
    typeInto(title(), 'Printer');
    typeInto(title(), 'Printer on fire');
    await act(async () => {
      vi.advanceTimersByTime(4999);
    });
    expect(readDraft('itsm-draft:report:u-1')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(readDraft<Answers>('itsm-draft:report:u-1')?.value).toEqual({ title: 'Printer on fire' });
    expect(document.querySelector('.itsm-DraftStatus')?.textContent).toMatch(/^Draft saved · /);

    typeInto(title(), '');
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(readDraft('itsm-draft:report:u-1')).toBeNull();
    expect(document.querySelector('.itsm-DraftStatus')).toBeNull();
  });

  it('restores after mount and writes what is pending when the page is hidden', async () => {
    writeDraft('itsm-draft:report:u-1', '1', { title: 'Half-written' });
    render(<Report />);
    await settle();
    expect(title().value).toBe('Half-written');
    expect(document.querySelector('.itsm-DraftNotice')?.textContent).toContain('Draft restored');

    typeInto(title(), 'Half-written, now finished');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(readDraft<Answers>('itsm-draft:report:u-1')?.value).toEqual({ title: 'Half-written, now finished' });
  });

  it('survives storage that cannot be read or written', async () => {
    window.localStorage.setItem('itsm-draft:report:u-1', '{not json');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Report />);
    await settle();
    expect(title().value).toBe('');
    typeInto(title(), 'Anything');
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.querySelector('.itsm-DraftStatus')).toBeNull();
    setItem.mockRestore();
  });
});
