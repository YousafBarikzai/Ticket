// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, focus, render, typeInto } from '../../web/__tests__/support/render.js';
import { FormField } from '../../web/FormField.js';
import { CheckboxGroup } from '../CheckboxGroup.js';
import { DurationField } from '../DurationField.js';
import { NumberField } from '../NumberField.js';
import { SearchField } from '../SearchField.js';
import { SegmentedControl } from '../SegmentedControl.js';
import { TimeField } from '../TimeField.js';

/*
 * The controls, read by axe (SPEC §8.0 rule 5) in the states that matter:
 * each SegmentedControl mode (a radiogroup, and a nav of links), a search
 * landmark with text, spinner and shortcut, a number with its steppers and
 * unit, a duration showing its reading and its error, a time, and a
 * checkbox group with a hint and an error.
 */

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => cleanupDocument());

async function audit(element: ReactElement): Promise<void> {
  render(<TestProvider>{element}</TestProvider>);
  await expectNoViolations(document.body);
}

const noop = (): void => undefined;

describe('controls audit', () => {
  it('SegmentedControl: value, commit and nav', async () => {
    await audit(
      <div>
        <SegmentedControl
          label="Composer mode"
          mode="value"
          value="reply"
          onValueChange={noop}
          options={[
            { value: 'reply', label: 'Reply', icon: 'reply' },
            { value: 'note', label: 'Internal note', icon: 'note' },
          ]}
        />
        <SegmentedControl
          label="AI mode"
          mode="commit"
          size="sm"
          value="suggest"
          onValueChange={noop}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'suggest', label: 'Suggest' },
            { value: 'auto', label: 'Automatic', disabled: true },
          ]}
        />
        <SegmentedControl
          label="My requests"
          mode="nav"
          fullWidth
          value="open"
          options={[
            { value: 'open', label: 'Open', href: '/tickets?scope=open', count: 4 },
            { value: 'needs-you', label: 'Needs you', href: '/tickets?scope=needs-you', count: 120 },
            { value: 'all', label: 'All', href: '/tickets?scope=all' },
            { value: 'archived', label: 'Archived', disabled: true },
          ]}
        />
      </div>,
    );
  });

  it('SearchField: with text, a spinner and a shortcut hint', async () => {
    render(
      <TestProvider>
        <SearchField label="Search rules" labelHidden value="" onValueChange={noop} placeholder="Name or key" loading />
        <SearchField label="Search articles" value="" onValueChange={noop} shortcut="/" size="lg" />
      </TestProvider>,
    );
    typeInto(document.querySelector('input')!, 'vpn');
    await expectNoViolations(document.body);
  });

  it('NumberField: in a field, with a unit, and on its own with a label', async () => {
    await audit(
      <div>
        <FormField label="Rollback to version" hint="The version to restore.">
          <NumberField value={3} min={1} max={9} onChange={noop} unit="of 9" />
        </FormField>
        <NumberField label="Rows per page" value={null} onChange={noop} size="sm" />
      </div>,
    );
  });

  it('DurationField: with a reading showing and with its error', async () => {
    render(
      <TestProvider>
        <FormField label="Resolve within">
          <DurationField value={null} onChange={noop} businessTime />
        </FormField>
        <DurationField label="Respond within" value={30} onChange={noop} />
      </TestProvider>,
    );
    const [first, second] = [...document.querySelectorAll('input')];
    focus(first!);
    typeInto(first!, '90');
    focus(second!);
    typeInto(second!, 'soon');
    act(() => second!.blur());
    await expectNoViolations(document.body);
  });

  it('TimeField: in a field and on its own', async () => {
    await audit(
      <div>
        <FormField label="Opens">
          <TimeField value="09:00" onChange={noop} step={15} />
        </FormField>
        <TimeField label="Closes" value={null} onChange={noop} size="sm" />
      </div>,
    );
  });

  it('CheckboxGroup: vertical with a hint and an error, and horizontal', async () => {
    await audit(
      <div>
        <CheckboxGroup
          label="Channels"
          hint="Where we tell you."
          error="Choose at least one."
          required
          value={['sms']}
          onChange={noop}
          options={[
            { value: 'mail', label: 'Email' },
            { value: 'sms', label: 'Text message', description: 'Standard rates apply.' },
            { value: 'teams', label: 'Teams', disabled: true },
          ]}
        />
        <CheckboxGroup
          label="Days"
          orientation="horizontal"
          value={[]}
          onChange={noop}
          options={[
            { value: 'mon', label: 'Monday' },
            { value: 'tue', label: 'Tuesday' },
          ]}
        />
      </div>,
    );
  });
});
