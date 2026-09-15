import { describe, expect, it } from 'vitest';
import {
  brokenConditions,
  buildEvalContext,
  isReadOnly,
  isVisible,
  isRequired,
  submissionValues,
  validateForm,
  visibleElements,
  visibleFields,
  withDefaults,
} from '../logic.js';
import type { FormDefinition, UiFieldElement } from '../schema.js';

/**
 * A definition close to a real catalogue form: a laptop request whose questions
 * depend on earlier answers. Every condition is an `@itsm/expr` expression, and
 * the API evaluates the identical objects when it validates the submission.
 */
const definition: FormDefinition = {
  key: 'hardware.laptop',
  version: 3,
  title: 'Request a laptop',
  schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', title: 'Why do you need a laptop?', minLength: 10, maxLength: 500 },
      model: { type: 'string', title: 'Model', enum: ['standard', 'engineering', 'other'] },
      otherModel: { type: 'string', title: 'Which model?', maxLength: 80 },
      forSomeoneElse: { type: 'boolean', title: 'Requesting on behalf of someone else', default: false },
      beneficiary: { type: 'string', title: 'Who is it for?' },
      neededBy: { type: 'string', title: 'Needed by', format: 'date' },
      accessories: { type: 'array', title: 'Accessories', items: { type: 'string', enum: ['dock', 'mouse', 'headset'] } },
      budgetCode: { type: 'string', title: 'Budget code', pattern: '^[A-Z]{2}-\\d{4}$' },
      seats: { type: 'integer', title: 'Seats', minimum: 1, maximum: 10 },
    },
    required: ['reason', 'model'],
  },
  ui: {
    elements: [
      {
        kind: 'instruction',
        id: 'intro',
        content: [{ type: 'paragraph', content: [{ text: 'Laptops are delivered within five working days.' }] }],
      },
      { kind: 'field', field: 'reason', control: 'longtext' },
      { kind: 'field', field: 'model', control: 'select' },
      {
        kind: 'field',
        field: 'otherModel',
        control: 'text',
        visibleWhen: { eq: [{ var: 'form.model' }, 'other'] },
        requiredWhen: { eq: [{ var: 'form.model' }, 'other'] },
      },
      { kind: 'field', field: 'forSomeoneElse', control: 'checkbox' },
      {
        kind: 'section',
        id: 'behalf',
        title: 'On behalf of',
        visibleWhen: { eq: [{ var: 'form.forSomeoneElse' }, true] },
        elements: [
          { kind: 'field', field: 'beneficiary', control: 'user', requiredWhen: { always: true } },
          { kind: 'field', field: 'neededBy', control: 'date' },
        ],
      },
      { kind: 'field', field: 'accessories', control: 'multiselect' },
      {
        kind: 'field',
        field: 'budgetCode',
        control: 'text',
        // Only managers see the budget code, and only they can change it.
        visibleWhen: { in: [{ var: 'user.role' }, ['manager', 'admin']] },
        readOnlyWhen: { ne: [{ var: 'user.role' }, 'admin'] },
      },
      { kind: 'field', field: 'seats', control: 'number' },
    ],
  },
};

const requester = { user: { role: 'requester' } };
const manager = { user: { role: 'manager' } };
const admin = { user: { role: 'admin' } };

const fieldNames = (fields: readonly UiFieldElement[]): readonly string[] => fields.map((field) => field.field);

describe('condition evaluation', () => {
  it('hides a conditional field until its condition holds', () => {
    expect(fieldNames(visibleFields(definition, buildEvalContext({ model: 'standard' }, requester)))).not.toContain(
      'otherModel',
    );
    expect(fieldNames(visibleFields(definition, buildEvalContext({ model: 'other' }, requester)))).toContain('otherModel');
  });

  it('hides every field inside a hidden section, whatever the field itself says', () => {
    const hidden = visibleFields(definition, buildEvalContext({ forSomeoneElse: false }, requester));
    expect(fieldNames(hidden)).not.toContain('beneficiary');
    expect(fieldNames(hidden)).not.toContain('neededBy');

    const shown = visibleFields(definition, buildEvalContext({ forSomeoneElse: true }, requester));
    expect(fieldNames(shown)).toContain('beneficiary');
    expect(fieldNames(shown)).toContain('neededBy');
  });

  it('prunes the element tree rather than flattening it, so sections keep their headings', () => {
    const elements = visibleElements(definition.ui.elements, buildEvalContext({ forSomeoneElse: true }, requester));
    const section = elements.find((element) => element.kind === 'section');
    expect(section).toBeDefined();
    expect(section?.kind === 'section' && section.elements).toHaveLength(2);

    const withoutSection = visibleElements(definition.ui.elements, buildEvalContext({}, requester));
    expect(withoutSection.some((element) => element.kind === 'section')).toBe(false);
  });

  it('reads conditions from the wider context, not only from the answers', () => {
    expect(fieldNames(visibleFields(definition, buildEvalContext({}, requester)))).not.toContain('budgetCode');
    expect(fieldNames(visibleFields(definition, buildEvalContext({}, manager)))).toContain('budgetCode');
  });

  it('treats a missing context value as a failed condition rather than an error', () => {
    expect(() => visibleFields(definition, buildEvalContext({}, {}))).not.toThrow();
    expect(fieldNames(visibleFields(definition, buildEvalContext({}, {})))).not.toContain('budgetCode');
  });
});

describe('required and read-only conditions', () => {
  const field = (name: string): UiFieldElement => {
    const found = visibleFields(definition, buildEvalContext({ model: 'other', forSomeoneElse: true }, admin)).find(
      (element) => element.field === name,
    );
    if (!found) throw new Error(`no visible field ${name}`);
    return found;
  };

  it('treats the schema list as unconditionally required', () => {
    expect(isRequired(field('reason'), definition, buildEvalContext({}, admin))).toBe(true);
  });

  it('applies requiredWhen only when the condition holds', () => {
    expect(isRequired(field('otherModel'), definition, buildEvalContext({ model: 'standard' }, admin))).toBe(false);
    expect(isRequired(field('otherModel'), definition, buildEvalContext({ model: 'other' }, admin))).toBe(true);
  });

  it('applies readOnlyWhen against the same context', () => {
    expect(isReadOnly(field('budgetCode'), buildEvalContext({}, admin))).toBe(false);
    expect(isReadOnly(field('budgetCode'), buildEvalContext({}, manager))).toBe(true);
  });
});

describe('validation', () => {
  it('reports required fields that the user can actually see', () => {
    const errors = validateForm(definition, { model: 'other' }, requester);
    expect(errors.reason).toBe('Why do you need a laptop? is required');
    expect(errors.otherModel).toBe('Which model? is required');
    // Hidden by its section, so not required however the condition reads.
    expect(errors.beneficiary).toBeUndefined();
  });

  it('applies the schema constraints of the subset of fields on screen', () => {
    const errors = validateForm(
      definition,
      { reason: 'too short', model: 'standard', seats: 42, budgetCode: 'nope' },
      manager,
    );
    expect(errors.reason).toContain('at least 10 characters');
    expect(errors.seats).toContain('10 or less');
    expect(errors.budgetCode).toContain('not in the expected format');
  });

  it('accepts a complete answer', () => {
    const errors = validateForm(
      definition,
      {
        reason: 'My current laptop will not charge and the battery is swollen.',
        model: 'engineering',
        forSomeoneElse: true,
        beneficiary: 'user-7',
        neededBy: '2026-10-01',
        accessories: ['dock', 'headset'],
        seats: 2,
      },
      requester,
    );
    expect(errors).toEqual({});
  });

  it('rejects an option that is not in the schema enum', () => {
    expect(validateForm(definition, { reason: 'A long enough reason here', model: 'gaming' }, requester).model).toContain(
      'available options',
    );
    expect(
      validateForm(
        definition,
        { reason: 'A long enough reason here', model: 'standard', accessories: ['dock', 'yacht'] },
        requester,
      ).accessories,
    ).toContain('available options');
  });

  it('rejects a malformed date, which is how a picker-free client can fail', () => {
    const errors = validateForm(
      definition,
      { reason: 'A long enough reason here', model: 'standard', forSomeoneElse: true, beneficiary: 'u1', neededBy: '01/10/2026' },
      requester,
    );
    expect(errors.neededBy).toContain('yyyy-mm-dd');
  });
});

describe('submission', () => {
  it('drops the answers to questions the user cannot see', () => {
    const values = {
      reason: 'A long enough reason here',
      model: 'standard',
      // Left behind after the user changed the model from "other".
      otherModel: 'ThinkPad X1',
      forSomeoneElse: false,
      beneficiary: 'user-7',
      budgetCode: 'AB-1234',
    };
    expect(submissionValues(definition, values, requester)).toEqual({
      reason: 'A long enough reason here',
      model: 'standard',
      forSomeoneElse: false,
    });
  });

  it('keeps a conditional answer once its question is on screen', () => {
    const values = { reason: 'A long enough reason here', model: 'other', otherModel: 'ThinkPad X1' };
    expect(submissionValues(definition, values, requester).otherModel).toBe('ThinkPad X1');
  });

  it('drops empty answers so that an untouched optional field is absent, not null', () => {
    const submitted = submissionValues(
      definition,
      { reason: 'A long enough reason here', model: 'standard', accessories: [], seats: null },
      requester,
    );
    expect('accessories' in submitted).toBe(false);
    expect('seats' in submitted).toBe(false);
  });

  it('fills in schema defaults for unanswered fields', () => {
    expect(withDefaults(definition, { reason: 'x' })).toEqual({ reason: 'x', forSomeoneElse: false });
  });
});

describe('a condition that cannot be evaluated', () => {
  // Since Phase 3 the expression language raises on an ordering comparison
  // between two present values of different kinds (ADR-0021), so a form
  // definition can now contain a condition that throws rather than returning
  // false. A form is rendered in a browser: letting that escape would replace
  // the page with nothing.
  const broken: FormDefinition = {
    ...definition,
    ui: {
      elements: [
        {
          kind: 'field',
          id: 'e-reason',
          field: 'reason',
          control: 'longtext',
          label: 'Why do you need a laptop?',
        } as UiFieldElement,
        {
          kind: 'field',
          id: 'e-secret',
          field: 'beneficiary',
          control: 'text',
          label: 'Who is it for?',
          visibleWhen: { gt: [{ var: 'form.reason' }, 5] },
        } as UiFieldElement,
      ],
    },
  };

  const context = buildEvalContext({ reason: 'A long enough reason here' }, requester);

  it('hides the field rather than revealing it', () => {
    const element = broken.ui.elements[1]!;
    expect(isVisible(element, context)).toBe(false);
    expect(visibleFields(broken, context).map((f) => f.field)).toEqual(['reason']);
  });

  it('names the field so somebody can fix the definition', () => {
    expect(brokenConditions(broken, context)).toEqual(['beneficiary']);
  });

  it('fails the whole form rather than presenting one that behaves unpredictably', () => {
    const errors = validateForm(broken, { reason: 'A long enough reason here' }, requester);
    expect(Object.keys(errors)).toEqual(['_form']);
    expect(errors._form).toMatch(/not configured correctly/);
    expect(errors._form).toMatch(/beneficiary/);
  });

  it('leaves a sound definition alone', () => {
    expect(brokenConditions(definition, context)).toEqual([]);
  });
});
