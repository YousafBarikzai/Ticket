// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { Button } from '../../web/Button.js';
import { FormField } from '../../web/FormField.js';
import { Input } from '../../web/Input.js';
import { Textarea } from '../../web/Textarea.js';
import { DraftNotice, DraftStatus } from '../Draft.js';
import { writeDraft } from '../drafts.js';
import { Form, FormActions } from '../Form.js';
import { FormErrorSummary } from '../FormErrorSummary.js';
import { FormSection } from '../FormSection.js';
import { InlineEdit, type InlineEditResult } from '../InlineEdit.js';

/*
 * The form kit, read by axe (SPEC §8.0 rule 5) in the states that matter: a
 * form after a failed submit (summary, mapped field errors), a restored
 * draft with its notice and status, sections (plain, two columns with
 * guidance, collapsible), and every InlineEdit state — at rest, read-only,
 * editing each kind of editor, invalid, failed, in conflict. Audited on
 * `document.body`, where portalled editors land.
 */

vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanupDocument();
  window.localStorage.clear();
});

async function audit(element: ReactElement): Promise<void> {
  render(<TestProvider>{element}</TestProvider>);
  await settle();
  await expectNoViolations(document.body);
}

const noop = async (): Promise<void> => undefined;

describe('form kit audit', () => {
  it('Form after a failed submit: summary, field errors, sticky actions with a draft', async () => {
    writeDraft('itsm-draft:audit', '1', [['title', 'From last time']]);
    render(
      <TestProvider>
        <Form onSubmit={async () => ({ fieldErrors: { title: 'Title is taken', email: 'Enter an e-mail address' }, message: 'Nothing was saved.' })} stickyActions autosave={{ key: 'itsm-draft:audit', version: '1' }} dirtyGuard saveShortcut>
          <FormSection title="Request">
            <FormField label="Title" required>
              <Input name="title" />
            </FormField>
            <FormField label="Contact e-mail" optional hint="We only write when something changes.">
              <Input name="email" type="email" />
            </FormField>
            <FormField label="Details" counter={{ max: 500 }}>
              <Textarea name="details" />
            </FormField>
          </FormSection>
          <FormActions>
            <Button>Cancel</Button>
            <Button type="submit" variant="primary">
              Save request
            </Button>
          </FormActions>
        </Form>
      </TestProvider>,
    );
    await settle();
    const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    click(submit);
    await settle();
    await expectNoViolations(document.body);
  });

  it('FormErrorSummary alone, with a message that has no field', async () => {
    await audit(
      <>
        <FormErrorSummary
          errors={[
            { fieldId: 'a-field', message: 'Enter a summary' },
            { fieldId: '', message: 'Your plan does not include this' },
          ]}
          description="Nothing was saved."
        />
        <FormField label="Summary" id="a-field">
          <Input />
        </FormField>
      </>,
    );
  });

  it('Draft notice and status on their own', async () => {
    await audit(
      <>
        <DraftNotice notice="restored" onDiscard={() => undefined} onDismiss={() => undefined} />
        <DraftNotice notice="outdated" onDiscard={() => undefined} onDismiss={() => undefined} />
        <DraftStatus savedAt={new Date('2026-09-30T10:42:00Z')} />
      </>,
    );
  });

  it('FormSection: plain, two columns with guidance, collapsible open and closed', async () => {
    await audit(
      <>
        <FormSection title="General" description="How tickets behave everywhere.">
          <FormField label="Default priority">
            <Input />
          </FormField>
        </FormSection>
        <FormSection title="Hours" columns={2} aside={<p>Hours apply in the team's time zone.</p>}>
          <FormField label="Start">
            <Input />
          </FormField>
          <FormField label="End">
            <Input />
          </FormField>
        </FormSection>
        <FormSection title="Advanced" description="Settings most people never change." collapsible>
          <FormField label="Retry limit">
            <Input />
          </FormField>
        </FormSection>
        <FormSection title="Danger zone" headingLevel={3} collapsible defaultOpen>
          <FormField label="Archive after">
            <Input />
          </FormField>
        </FormSection>
      </>,
    );
  });

  it('InlineEdit at rest: plain, empty, read-only, with a display', async () => {
    await audit(
      <dl>
        <dt>Title</dt>
        <dd>
          <InlineEdit label="Title" value="Printer jammed" onSave={noop} />
        </dd>
        <dt>Description</dt>
        <dd>
          <InlineEdit label="Description" value="" placeholder="Add a description" editor="textarea" onSave={noop} />
        </dd>
        <dt>Status</dt>
        <dd>
          <InlineEdit label="Status" value="in_progress" display={<span>In progress</span>} readOnlyReason="Managed by a workflow" onSave={noop} />
        </dd>
      </dl>,
    );
  });

  it('InlineEdit editing: text with a problem, text area, select', async () => {
    render(
      <TestProvider>
        <InlineEdit label="Title" value="Printer" validate={() => 'Enter a longer title'} onSave={noop} />
        <InlineEdit label="Description" value="Line" editor="textarea" onSave={noop} />
        <InlineEdit
          label="Priority"
          value="P2"
          editor="select"
          options={[
            { value: 'P1', label: 'P1 · Critical' },
            { value: 'P2', label: 'P2 · High' },
          ]}
          onSave={noop}
        />
      </TestProvider>,
    );
    const triggers = [...document.querySelectorAll<HTMLButtonElement>('.itsm-InlineEdit__trigger')];
    click(triggers[0]!);
    const input = document.querySelector<HTMLInputElement>('.itsm-InlineEdit__control input')!;
    typeInto(input, 'P');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    // The text editor stays open with its problem; open the other two beside it.
    for (const trigger of [...document.querySelectorAll<HTMLButtonElement>('.itsm-InlineEdit__trigger')]) click(trigger);
    await settle();
    expect(document.querySelectorAll('.itsm-InlineEdit[data-state="editing"]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.itsm-InlineEdit__control input[aria-invalid="true"]')).not.toBeNull();
    await expectNoViolations(document.body);
  });

  it.each([
    ['combobox', <InlineEdit key="c" label="Category" value="hw" editor="combobox" options={[{ value: 'hw', label: 'Hardware' }]} onSave={noop} />],
    ['person', <InlineEdit key="p" label="Assignee" value="u-1" editor="person" options={[{ value: 'u-1', label: 'Jo Resolver' }]} onSave={noop} />],
    ['date', <InlineEdit key="d" label="Due" value="2026-03-14" editor="date" onSave={noop} />],
  ])('InlineEdit editing: the %s editor, fetched', async (_name, element) => {
    render(<TestProvider>{element}</TestProvider>);
    click(document.querySelector<HTMLButtonElement>('.itsm-InlineEdit__trigger')!);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle(10);
    expect(document.querySelector('.itsm-InlineEdit__control input')).not.toBeNull();
    await expectNoViolations(document.body);
  });

  it('InlineEdit after a failed save and in conflict', async () => {
    const failing = async (): Promise<InlineEditResult> => ({ error: "Couldn't save the title" });
    const conflicting = async (): Promise<InlineEditResult> => ({ conflict: { theirs: 'P1', by: 'Jo' } });
    render(
      <TestProvider>
        <InlineEdit label="Title" value="Printer" onSave={failing} />
        <InlineEdit
          label="Priority"
          value="P2"
          editor="select"
          options={[
            { value: 'P1', label: 'P1' },
            { value: 'P2', label: 'P2' },
            { value: 'P3', label: 'P3' },
          ]}
          onSave={conflicting}
        />
      </TestProvider>,
    );
    click(document.querySelectorAll<HTMLButtonElement>('.itsm-InlineEdit__trigger')[0]!);
    const input = document.querySelector<HTMLInputElement>('.itsm-InlineEdit__control input')!;
    typeInto(input, 'Printer on floor 3');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await settle(40);
    click(document.querySelectorAll<HTMLButtonElement>('.itsm-InlineEdit__trigger')[1]!);
    const select = document.querySelector<HTMLSelectElement>('.itsm-InlineEdit__control select')!;
    act(() => {
      select.value = 'P3';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(40);
    await expectNoViolations(document.body);
  });
});
