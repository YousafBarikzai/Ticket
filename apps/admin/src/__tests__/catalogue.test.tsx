// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDefinition } from '@itsm/contracts/forms';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalogue',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const calls: string[] = [];
const record =
  (name: string) =>
  async (...args: unknown[]): Promise<Record<string, unknown>> => {
    calls.push(`${name} ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
    return { key: typeof args[0] === 'string' ? args[0] : 'x', name: 'Laptop request', version: 2 };
  };
const catalogueApi = {
  createForm: vi.fn(record('createForm')),
  updateForm: vi.fn(record('updateForm')),
  publishForm: vi.fn(record('publishForm')),
  createRequestType: vi.fn(record('createRequestType')),
  updateRequestType: vi.fn(record('updateRequestType')),
  publishRequestType: vi.fn(record('publishRequestType')),
  createService: vi.fn(record('createService')),
  updateService: vi.fn(record('updateService')),
};
vi.mock('../client/api.js', () => ({
  api: { configure: { catalogue: catalogueApi }, tenant: { users: vi.fn(async () => []) } },
}));

const { ItsmProvider } = await import('@itsm/ui');
/** What the design system's polite live region last said. */
const announced = (): string => document.querySelector('[data-itsm-live-region="polite"]')?.textContent ?? '';
const { Toaster } = await import('@itsm/ui/overlays');
const questions = await import('../components/catalogue/questions.js');
const presentation = await import('../components/catalogue/presentation.js');
const { planSave, publishesQuestions } = await import('../components/catalogue/save.js');
const { planMove, applyMoves } = await import('../components/catalogue/reorder.js');
const { describeCondition } = await import('../components/catalogue/describe.js');
const { createHref } = await import('../components/catalogue/useCreate.js');
const { QuestionsEditor } = await import('../components/catalogue/QuestionsEditor.js');
const { RequestTypeSheet } = await import('../components/catalogue/RequestTypeSheet.js');
const { FormEditor } = await import('../components/catalogue/FormEditor.js');
const { ConditionBuilder } = await import('../components/ConditionBuilder.js');
const { cleanupDocument, clickAsync, render, type } = await import('./support/render.js');

/**
 * Services & requests (SPEC §6.1, §6.4): the questions model that turns a
 * form document into questions and back without losing what it cannot
 * draw, the plan that publishes a request type and its questions in one
 * go, the questions editor's keyboard and undo, and the one sheet.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => '/catalogue'}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
  calls.length = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button) => text(button) === name) as HTMLButtonElement | undefined;

/** The seeded "system access" form: a conditional, conditionally required question and two lists. */
const ACCESS: FormDefinition = {
  key: 'system-access',
  version: 1,
  title: 'Request access to a system',
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['finance', 'hr'] },
      accessLevel: { type: 'string', title: 'Access level', enum: ['read', 'write', 'admin'] },
      justification: { type: 'string', title: 'Why you need it', minLength: 20, maxLength: 2000 },
      until: { type: 'string', title: 'Needed until', format: 'date' },
    },
    required: ['system', 'accessLevel'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select', label: 'System', options: [{ value: 'finance', label: 'Finance' }, { value: 'hr', label: 'HR' }] },
      {
        kind: 'field',
        field: 'accessLevel',
        control: 'select',
        label: 'Access level',
        options: [
          { value: 'read', label: 'Read only' },
          { value: 'write', label: 'Read and write' },
          { value: 'admin', label: 'Administrator' },
        ],
      },
      {
        kind: 'field',
        field: 'justification',
        control: 'longtext',
        label: 'Why you need it',
        rows: 4,
        visibleWhen: { ne: [{ var: 'form.accessLevel' }, 'read'] },
        requiredWhen: { eq: [{ var: 'form.accessLevel' }, 'admin'] },
      },
      { kind: 'field', field: 'until', control: 'date', label: 'Needed until' },
    ],
  },
};

/* ======================================================================= */

describe('the questions model', () => {
  it('reads a document as questions and writes it back as it was, without the version stamp', () => {
    const draft = questions.fromDocument(ACCESS, { published: true });
    expect(questions.questionsOf(draft).map((question) => [question.label, question.type, question.required])).toEqual([
      ['System', 'select', 'always'],
      ['Access level', 'select', 'always'],
      ['Why you need it', 'longtext', 'when'],
      ['Needed until', 'date', 'never'],
    ]);
    const { version: _version, ...stored } = ACCESS;
    expect(questions.toDocument(draft, 'system-access')).toEqual(stored);
  });

  it('keeps what it cannot draw: length limits, a row count, a formatted instruction, a section inside a section', () => {
    const document: FormDefinition = {
      key: 'kept',
      version: 3,
      schema: { type: 'object', properties: { a: { type: 'string', title: 'A', maxLength: 10, pattern: '^x' }, b: { type: 'boolean', title: 'B' } } },
      ui: {
        elements: [
          { kind: 'field', field: 'a', control: 'text', label: 'A', placeholder: 'x…' },
          { kind: 'instruction', id: 'note', content: [{ type: 'paragraph', content: [{ text: 'Read ' }, { text: 'this', bold: true }] }] },
          { kind: 'section', id: 'outer', title: 'Outer', elements: [{ kind: 'section', id: 'inner', title: 'Inner', elements: [{ kind: 'field', field: 'b', control: 'checkbox' }] }] },
        ],
      },
    };
    const draft = questions.fromDocument(document);
    const blocks = draft.blocks;
    expect(blocks[1]).toMatchObject({ kind: 'instruction', editable: false });
    expect((blocks[2] as unknown as { children: { kind: string }[] }).children[0]!.kind).toBe('opaque');
    const { version: _version, ...stored } = document;
    expect(questions.toDocument(draft, 'kept')).toEqual(stored);
    // Relabelling keeps the kept settings.
    const relabelled = questions.updateQuestion(draft, blocks[0]!.id, { label: 'Asset tag' });
    const written = questions.toDocument(relabelled, 'kept');
    expect(written.schema.properties.a).toEqual({ type: 'string', title: 'Asset tag', maxLength: 10, pattern: '^x' });
    expect(written.ui.elements[0]).toMatchObject({ placeholder: 'x…', label: 'Asset tag' });
    // A new type drops constraints that meant nothing for it.
    const retyped = questions.toDocument(questions.updateQuestion(draft, blocks[0]!.id, { type: 'number' }), 'kept');
    expect(retyped.schema.properties.a).toEqual({ type: 'number', title: 'A' });
  });

  it('reads “required when always” as Always, with no problem, and writes it back the way it was', () => {
    const document: FormDefinition = {
      key: 'laptop',
      version: 2,
      schema: { type: 'object', properties: { address: { type: 'string', title: 'Delivery address' } } },
      ui: { elements: [{ kind: 'field', field: 'address', control: 'text', label: 'Delivery address', requiredWhen: { always: true } }] },
    };
    const draft = questions.fromDocument(document, { published: true });
    expect(draft.blocks[0]).toMatchObject({ kind: 'question', required: 'always', requiredWhen: null });
    expect(questions.checkQuestions(draft)).toEqual([]);
    const { version: _version, ...stored } = document;
    expect(questions.toDocument(draft, 'laptop')).toEqual(stored);
    // Made optional, the condition goes with it; made "when", it is the new condition.
    const optional = questions.toDocument(questions.updateQuestion(draft, draft.blocks[0]!.id, { required: 'never' }), 'laptop');
    expect(optional.ui.elements[0]).not.toHaveProperty('requiredWhen');
    expect(optional.schema.required).toBeUndefined();
  });

  it('gives blocks read from a document the same ids every time, so the server and the browser agree', () => {
    expect(questions.fromDocument(ACCESS).blocks.map((block) => block.id)).toEqual(questions.fromDocument(ACCESS).blocks.map((block) => block.id));
  });

  it('lets a new question’s key follow its label, and never moves a published one', () => {
    let draft = questions.addBlock(questions.EMPTY_DRAFT, questions.newQuestion('text'));
    const id = draft.blocks[0]!.id;
    draft = questions.updateQuestion(draft, id, { label: 'Café access' });
    expect(questions.questionsOf(draft)[0]!.field).toBe('cafeAccess');
    const published = questions.fromDocument(ACCESS, { published: true });
    const first = published.blocks[0]!.id;
    expect(questions.questionsOf(questions.updateQuestion(published, first, { label: 'Which system?' }))[0]!.field).toBe('system');
  });

  it('moves a question into a section, within it and out again, and says where it went', () => {
    const q1 = questions.newQuestion('text', 'One');
    const q2 = questions.newQuestion('text', 'Two');
    const section = { ...questions.newSection(), title: 'Your laptop' };
    let draft: ReturnType<typeof questions.fromDocument> = { blocks: [q1, section, q2] };
    let moved = questions.moveBlock(draft, q1.id, 'down')!;
    expect(moved.where).toBe('start of “Your laptop”');
    draft = moved.draft;
    expect(draft.blocks.map((block) => block.id)).toEqual([section.id, q2.id]);
    moved = questions.moveBlock(draft, q2.id, 'up')!;
    expect(moved.where).toBe('end of “Your laptop”');
    draft = moved.draft;
    expect((draft.blocks[0] as unknown as { children: { id: string }[] }).children.map((child) => child.id)).toEqual([q1.id, q2.id]);
    moved = questions.moveBlock(draft, q2.id, 'up')!;
    expect(moved.where).toBe('position 1 of 2 in “Your laptop”');
    moved = questions.moveBlock(moved.draft, q2.id, 'up')!;
    expect(moved.where).toBe('before “Your laptop”');
    expect(moved.draft.blocks.map((block) => block.id)).toEqual([q2.id, section.id]);
    expect(questions.moveBlock(moved.draft, q2.id, 'up')).toBeNull();
  });

  it('keeps a section’s questions when the section is removed, and puts a removed question back where it was', () => {
    const q1 = questions.newQuestion('text', 'One');
    const section = { ...questions.newSection(), title: 'S', children: [q1] };
    const draft = { blocks: [section] };
    expect(questions.removeBlock(draft, section.id).blocks.map((block) => block.id)).toEqual([q1.id]);
    const without = questions.removeBlock(draft, q1.id);
    expect((without.blocks[0] as unknown as { children: unknown[] }).children).toHaveLength(0);
    const back = questions.insertAt(without, q1, section.id, 0);
    expect((back.blocks[0] as unknown as { children: { id: string }[] }).children[0]!.id).toBe(q1.id);
  });

  it('says what would stop a draft saving, on the question it belongs to', () => {
    const empty = questions.newQuestion('select');
    const draft = questions.addBlock(questions.fromDocument(ACCESS), empty);
    const issues = questions.checkQuestions(draft);
    expect(issues.filter((issue) => issue.blockId === empty.id).map((issue) => issue.field)).toEqual(['label', 'key']);

    const duplicate = questions.updateQuestion(draft, empty.id, { label: 'System' });
    expect(questions.checkQuestions(duplicate).map((issue) => issue.message)).toContain('System: another question already uses the key “system”.');

    // Removing the question another one depends on is caught before the server's 422.
    const accessId = questions.questionsOf(draft)[1]!.id;
    const orphaned = questions.removeBlock(questions.fromDocument(ACCESS), accessId);
    expect(questions.checkQuestions(orphaned).map((issue) => issue.field)).toEqual(['requiredWhen', 'visibleWhen']);

    const same = questions.updateQuestion(questions.addBlock(questions.EMPTY_DRAFT, questions.newQuestion('select', 'Laptop')), questions.EMPTY_DRAFT.blocks[0]?.id ?? '', {});
    const laptop = questions.questionsOf(same)[0]!;
    const clash = questions.updateQuestion(same, laptop.id, { options: [questions.newOption('Mac'), questions.newOption('mac')] });
    expect(questions.checkQuestions(clash)[0]!.message).toBe('Laptop: two options would be stored the same way. Reword one of them.');
    const whenless = questions.updateQuestion(same, laptop.id, { required: 'when', requiredWhen: { always: true } });
    expect(questions.checkQuestions(whenless)[0]!.field).toBe('requiredWhen');
  });

  it('counts what publishing changes, including a new order', () => {
    const before = questions.toDocument(questions.fromDocument(ACCESS), 'system-access');
    let draft = questions.fromDocument(ACCESS);
    draft = questions.removeBlock(draft, draft.blocks[3]!.id);
    draft = questions.addBlock(draft, questions.newQuestion('text', 'Manager'));
    draft = questions.updateQuestion(draft, draft.blocks[0]!.id, { hint: 'The one you use' });
    expect(questions.describeChanges(questions.diffQuestions(before, questions.toDocument(draft, 'system-access')))).toBe(
      '1 question added, 1 changed, 1 removed',
    );
    const swapped = questions.moveBlock(questions.fromDocument(ACCESS), 'q:0', 'down')!.draft;
    expect(questions.describeChanges(questions.diffQuestions(before, questions.toDocument(swapped, 'system-access')))).toBe('Questions reordered');
    expect(questions.describeChanges(questions.diffQuestions(before, before))).toBeNull();
  });

  it('calls a question unchanged when only the order of its keys differs, as after a jsonb round trip', () => {
    const written = questions.toDocument(questions.fromDocument(ACCESS), 'system-access');
    const reread = JSON.parse(JSON.stringify(written, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()) : value,
    )) as typeof written;
    expect(JSON.stringify(reread)).not.toBe(JSON.stringify(written));
    expect(questions.sameValue(reread, written)).toBe(true);
    expect(questions.describeChanges(questions.diffQuestions(reread, written))).toBeNull();
  });

  it('stores an option under a value made from its words, and keeps it once saved', () => {
    expect(questions.optionValue('Read and write')).toBe('read-and-write');
    expect(questions.optionValue('Café  crème')).toBe('cafe-creme');
    const fresh = questions.relabelOption(questions.newOption('Mac'), 'MacBook Pro');
    expect(fresh.value).toBe('macbook-pro');
    const saved = { ...fresh, auto: false };
    expect(questions.relabelOption(saved, 'MacBook Air').value).toBe('macbook-pro');
  });

  it('offers other questions as condition facts: lists with their options, a multi-select by “includes”', () => {
    const draft = questions.addBlock(questions.fromDocument(ACCESS), { ...questions.newQuestion('multiselect', 'Extras') });
    const facts = questions.answerFacts(draft, 'q:0');
    expect(facts.map((fact) => fact.path)).toEqual(['form.accessLevel', 'form.extras']);
    expect(facts[0]!.options?.map((option) => option.label)).toEqual(['Read only', 'Read and write', 'Administrator']);
    expect(facts[1]!.operators).toEqual(['contains', 'empty', 'exists']);
    expect(describeCondition({ eq: [{ var: 'form.accessLevel' }, 'admin'] }, facts)).toBe('Access level is Administrator');
    expect(describeCondition({ contains: [{ var: 'form.extras' }, 'option-1'] }, facts)).toBe('Extras includes Option 1');
    expect(describeCondition({ not: { eq: [{ var: 'form.accessLevel' }, 'admin'] } }, facts)).toBe('a custom condition');
  });
});

/* ======================================================================= */

describe('services and request types in words', () => {
  const form = (overrides: Partial<Parameters<typeof presentation.formView>[0]> = {}) =>
    presentation.formView({
      id: 'f1',
      key: 'laptop',
      name: 'Laptop',
      description: null,
      status: 'published',
      version: 3,
      document: { ...ACCESS, key: 'laptop', version: 3 },
      updatedAt: '2026-09-29T09:00:00Z',
      publishedAt: '2026-09-29T09:00:00Z',
      ...overrides,
    });

  it('tells a live form from one with unpublished changes by the version stamp publishing writes', () => {
    expect(form().state).toBe('live');
    expect(form({ document: { ...ACCESS, key: 'laptop' } as FormDefinition }).state).toBe('changes');
    expect(form({ status: 'draft', version: 1 }).state).toBe('draft');
    expect(presentation.formStateLabel('live', 3)).toBe('Live · v3');
  });

  it('describes where a request type’s questions come from', () => {
    const forms = new Map([['laptop', form()]]);
    const own = presentation.questionsSource({ key: 'laptop', formKey: 'laptop' }, forms);
    expect(presentation.questionsLabel(own)).toBe('4 questions · v3');
    const shared = presentation.questionsSource({ key: 'mac', formKey: 'laptop' }, forms);
    expect(presentation.questionsLabel(shared)).toBe('Laptop · v3');
    const pending = presentation.questionsSource({ key: 'laptop', formKey: null }, new Map([['laptop', form({ status: 'draft', version: 1 })]]));
    expect(presentation.questionsLabel(pending)).toBe('4 questions · not live yet');
    expect(presentation.requestTypeState('published', pending)).toBe('changes');
    expect(presentation.requestTypeState('draft', pending)).toBe('draft');
    expect(presentation.questionsLabel(presentation.questionsSource({ key: 'x', formKey: null }, forms))).toBe('No questions');
    expect(presentation.catalogueMeta([{ state: 'live' }, { state: 'changes' }, { state: 'draft' }])).toBe('2 live · 1 draft');
  });
});

/* ======================================================================= */

describe('saving a request type (one sheet, one confirm)', () => {
  const fields = {
    name: 'Laptop request',
    key: 'laptop-request',
    serviceKey: 'hardware',
    summary: 'A new laptop',
    description: '',
    priority: 'P3',
    groupId: '',
    questionsMode: 'own' as const,
    formKey: '',
  };
  const document = questions.toDocument(questions.fromDocument(ACCESS), 'laptop-request');

  it('publishes a new request type and its new questions in the order the API needs', () => {
    const steps = planSave({ fields, existing: null, ownForm: null, document, questionsChanged: true, intent: 'publish' });
    expect(steps.map((step) => step.kind)).toEqual(['createForm', 'publishForm', 'createType', 'publishType']);
    expect(steps[2]).toMatchObject({ input: { key: 'laptop-request', serviceKey: 'hardware', name: 'Laptop request', shortSummary: 'A new laptop', formKey: 'laptop-request' } });
    expect(publishesQuestions(steps)).toBe(true);
  });

  it('saves a draft with its questions as a draft form, pointing at nothing until they are published', () => {
    const steps = planSave({ fields, existing: null, ownForm: null, document, questionsChanged: true, intent: 'save' });
    expect(steps.map((step) => step.kind)).toEqual(['createForm', 'createType']);
    expect(steps[1]).not.toHaveProperty('input.formKey');
  });

  it('makes no empty form for "its own questions" with none written', () => {
    const empty = questions.toDocument(questions.EMPTY_DRAFT, 'laptop-request');
    expect(planSave({ fields, existing: null, ownForm: null, document: empty, questionsChanged: true, intent: 'save' }).map((step) => step.kind)).toEqual(['createType']);
  });

  it('publishes changed questions of a live item with it, and sends only what changed', () => {
    const existing = { key: 'laptop-request', name: 'Laptop request', serviceKey: 'hardware', summary: 'A new laptop', description: null, priority: 'P3', groupId: null, formKey: 'laptop-request', status: 'published' };
    const ownForm = { key: 'laptop-request', name: 'Laptop request', status: 'published', unpublished: false };
    expect(planSave({ fields, existing, ownForm, document, questionsChanged: true, intent: 'save' }).map((step) => step.kind)).toEqual(['updateForm', 'publishForm']);
    expect(planSave({ fields: { ...fields, priority: 'P2' }, existing, ownForm, document, questionsChanged: false, intent: 'save' })).toEqual([
      { kind: 'updateType', key: 'laptop-request', patch: { priority: 'P2' } },
    ]);
    expect(planSave({ fields: { ...fields, questionsMode: 'form', formKey: 'system-access' }, existing, ownForm, document: null, questionsChanged: false, intent: 'save' })).toEqual([
      { kind: 'updateType', key: 'laptop-request', patch: { formKey: 'system-access' } },
    ]);
    expect(planSave({ fields: { ...fields, questionsMode: 'none' }, existing, ownForm, document: null, questionsChanged: false, intent: 'save' })).toEqual([
      { kind: 'updateType', key: 'laptop-request', patch: { formKey: null } },
    ]);
    expect(planSave({ fields, existing, ownForm, document, questionsChanged: false, intent: 'save' })).toEqual([]);
  });
});

describe('create sheets in the URL', () => {
  it('opens over the chosen service and closes back to it, dropping only what belonged to the sheet', () => {
    expect(createHref('/catalogue', 'service=hardware&open=request-type:x', 'request-type', { from: 'laptop' })).toBe('/catalogue?service=hardware&new=request-type&from=laptop');
    expect(createHref('/catalogue', 'service=hardware&new=request-type&from=laptop', null)).toBe('/catalogue?service=hardware');
    expect(createHref('/fields', 'new=1', null)).toBe('/fields');
  });
});

describe('reordering by numbers', () => {
  it('swaps two different numbers, and renumbers in tens when they are the same', () => {
    expect(planMove([{ key: 'a', order: 10 }, { key: 'b', order: 30 }], 'b', 'up')).toEqual([
      { key: 'b', order: 10 },
      { key: 'a', order: 30 },
    ]);
    expect(planMove([{ key: 'a', order: 0 }, { key: 'b', order: 0 }, { key: 'c', order: 30 }], 'b', 'up')).toEqual([
      { key: 'b', order: 10 },
      { key: 'a', order: 20 },
    ]);
    expect(planMove([{ key: 'a', order: 0 }], 'a', 'up')).toEqual([]);
    expect(applyMoves([{ key: 'a', o: 10 }, { key: 'b', o: 20 }], (row) => row.o, new Map([['a', 30]])).map((row) => row.key)).toEqual(['b', 'a']);
  });
});

/* ======================================================================= */

function Editor({ initial, layout = 'inline' }: { readonly initial: ReturnType<typeof questions.fromDocument>; readonly layout?: 'inline' | 'split' }): ReactNode {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <QuestionsEditor draft={draft} onChange={setDraft} layout={layout} />
      <output data-testid="keys">{questions.questionsOf(draft).map((question) => question.field).join(',')}</output>
    </>
  );
}

describe('the questions editor', () => {
  it('moves a question with Alt+↓, keeps focus on it and announces where it went', async () => {
    const { container } = render(
      <Frame>
        <Editor initial={questions.fromDocument(ACCESS)} />
      </Frame>,
    );
    const first = container.querySelector<HTMLButtonElement>('[data-block="q:0"] [data-control="open"]')!;
    act(() => first.focus());
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    });
    expect(text(container.querySelector('[data-testid="keys"]'))).toBe('accessLevel,system,justification,until');
    expect(document.activeElement).toBe(container.querySelector('[data-block="q:0"] [data-control="open"]'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(announced()).toBe('System moved to position 2 of 4');
  });

  it('opens a question in place with its label, and moves its key with the label while it is new', () => {
    const { container } = render(
      <Frame>
        <Editor initial={{ blocks: [questions.newQuestion('text')] }} />
      </Frame>,
    );
    const open = container.querySelector<HTMLButtonElement>('[data-control="open"]')!;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    act(() => open.click());
    expect(open.getAttribute('aria-expanded')).toBe('true');
    type(container.querySelector<HTMLInputElement>('[data-control="label"]')!, 'Cost centre');
    expect(text(container.querySelector('[data-testid="keys"]'))).toBe('costCentre');
  });

  it('removes a question with Undo in the toast, putting it back where it was', async () => {
    const { container } = render(
      <Frame>
        <Editor initial={questions.fromDocument(ACCESS)} />
        <Toaster />
      </Frame>,
    );
    act(() => {
      container.querySelector('[data-block="q:1"] [data-control="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find((item) => text(item) === 'Remove') as HTMLElement;
    await act(async () => remove.click());
    expect(text(container.querySelector('[data-testid="keys"]'))).toBe('system,justification,until');
    let undo: HTMLButtonElement | undefined;
    await act(async () => {
      undo = await vi.waitFor(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => text(candidate) === 'Undo');
        if (!button) throw new Error('no Undo yet');
        return button as HTMLButtonElement;
      });
    });
    await act(async () => {
      undo!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(text(container.querySelector('[data-testid="keys"]'))).toBe('system,accessLevel,justification,until');
  });

  it('shows the selected question beside the list in the split layout, with the form’s details when none is', () => {
    const { container } = render(
      <Frame>
        <QuestionsEditor draft={questions.fromDocument(ACCESS)} onChange={() => undefined} layout="split" selectedId={null} idle={<p>Form details here</p>} />
      </Frame>,
    );
    expect(text(container.querySelector('.app-Questions__aside'))).toBe('Form details here');
    cleanupDocument();
    const split = render(
      <Frame>
        <QuestionsEditor draft={questions.fromDocument(ACCESS)} onChange={() => undefined} layout="split" selectedId="q:2" />
      </Frame>,
    );
    const aside = split.container.querySelector('.app-Questions__aside')!;
    expect(aside.getAttribute('aria-label')).toBe('Inspector: Why you need it');
    expect(aside.querySelector<HTMLInputElement>('[data-control="label"]')!.value).toBe('Why you need it');
    expect(text(aside)).toContain('Required when');
    expect(text(split.container.querySelector('[data-block="q:2"]'))).toContain('Required when Access level is Administrator');
    expect(text(split.container.querySelector('[data-block="q:2"]'))).toContain('Shown when Access level is not Read only');
  });

  it('draws a form’s own facts in the condition builder, with their options', () => {
    const facts = questions.answerFacts(questions.fromDocument(ACCESS), 'q:2');
    const { container } = render(<ConditionBuilder label="Show when" value={{ eq: [{ var: 'form.accessLevel' }, 'admin'] }} factCatalogue={facts} onChange={() => undefined} />);
    const [fact, , value] = [...container.querySelectorAll('select')];
    expect([...fact!.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['Answers']);
    expect(fact!.value).toBe('form.accessLevel');
    expect([...value!.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Read only', 'Read and write', 'Administrator']);
  });
});

/* ======================================================================= */

describe('the request-type sheet', () => {
  const service = { id: 's1', key: 'hardware', name: 'Hardware', description: null, status: 'active', ownerId: null, owner: null, groupId: null, teamName: null };

  it('publishes a new request type and its questions after one confirmation, in order', async () => {
    render(
      <Frame>
        <RequestTypeSheet target={{ kind: 'new', serviceKey: 'hardware' }} onClose={() => undefined} services={[service]} types={[]} forms={[]} teams={null} canEditQuestions />
      </Frame>,
    );
    const sheet = document.querySelector('[role="dialog"]')!;
    type(sheet.querySelector<HTMLInputElement>('input[name="name"]')!, 'Laptop request');
    // Add a question by type from the menu.
    act(() => {
      buttonNamed(sheet, 'Add question')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const dropdown = [...document.querySelectorAll('[role="menuitem"]')].find((item) => text(item).startsWith('Dropdown')) as HTMLElement;
    await act(async () => dropdown.click());
    type(sheet.querySelector<HTMLInputElement>('[data-control="label"]')!, 'Which laptop?');
    // The preview shows it as the portal will.
    expect(text(sheet.querySelector('.app-TypeSheet__preview'))).toContain('Which laptop?');

    await clickAsync(buttonNamed(sheet, 'Publish')!);
    const confirm = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes('Publish Laptop request?'))!;
    expect(text(confirm)).toContain('Requesters will see this in the portal immediately.');
    expect(text(confirm)).toContain('Its question goes live');
    expect(calls).toEqual([]);
    await clickAsync(buttonNamed(confirm, 'Publish')!);
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['createForm', 'publishForm', 'createRequestType', 'publishRequestType']);
    expect(calls[2]).toContain('"formKey":"laptop-request"');
  });

  it('refuses to save without a name, and says so in a summary that links to the field', async () => {
    render(
      <Frame>
        <RequestTypeSheet target={{ kind: 'new' }} onClose={() => undefined} services={[service]} types={[]} forms={[]} teams={null} canEditQuestions />
      </Frame>,
    );
    const sheet = document.querySelector('[role="dialog"]')!;
    await clickAsync(buttonNamed(sheet, 'Save draft')!);
    expect(text(sheet.querySelector('[role="alert"]'))).toContain('Enter a name for the request type.');
    expect(calls).toEqual([]);
  });

  it('saves a live item in place, without asking, when its questions have not changed', async () => {
    const forms = [
      presentation.formView({
        id: 'f1',
        key: 'system-access',
        name: 'System access',
        description: null,
        status: 'published',
        version: 1,
        document: ACCESS,
        updatedAt: '2026-09-29T09:00:00Z',
        publishedAt: '2026-09-29T09:00:00Z',
      }),
    ];
    const source = presentation.questionsSource({ key: 'system-access', formKey: 'system-access' }, new Map(forms.map((form) => [form.key, form])));
    const type = {
      id: 't1',
      key: 'system-access',
      name: 'Access to a system',
      summary: null,
      description: null,
      serviceId: 's1',
      serviceKey: 'hardware',
      serviceName: 'Hardware',
      priority: 'P3',
      status: 'published',
      state: 'live' as const,
      formKey: 'system-access',
      questions: source,
      questionsLabel: presentation.questionsLabel(source),
      groupId: null,
      teamName: null,
      entitlement: null,
      sortOrder: 10,
      publishedAt: '2026-09-29T09:00:00Z',
    };
    render(
      <Frame>
        <RequestTypeSheet target={{ kind: 'edit', type }} onClose={() => undefined} services={[service]} types={[type]} forms={forms} teams={null} canEditQuestions />
      </Frame>,
    );
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(text(sheet)).toContain('Live item — changes appear immediately.');
    expect(buttonNamed(sheet, 'Publish')).toBeUndefined();
    const priority = [...sheet.querySelectorAll('[role="radio"]')].find((radio) => text(radio) === 'P1') as HTMLElement;
    act(() => priority.click());
    await clickAsync(buttonNamed(sheet, 'Save changes')!);
    expect(calls).toEqual(['updateRequestType system-access {"priority":"P1"}']);
  });
});

/* ======================================================================= */

describe('the form editor', () => {
  const live = () =>
    presentation.formView({
      id: 'f1',
      key: 'system-access',
      name: 'System access request',
      description: null,
      status: 'published',
      version: 1,
      document: ACCESS,
      updatedAt: '2026-09-29T09:00:00Z',
      publishedAt: '2026-09-29T09:00:00Z',
    });

  it('saves the draft by itself five seconds after a change, without the version stamp', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = render(
        <Frame>
          <FormEditor form={live()} usedBy={[]} canManage canSeeRequestTypes breadcrumbs={[]} />
        </Frame>,
      );
      const first = container.querySelector<HTMLButtonElement>('[data-block="q:0"] [data-control="open"]')!;
      act(() => {
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
      });
      expect(text(container.querySelector('.app-FormEditor__status'))).toBe('Unsaved changes');
      expect(catalogueApi.updateForm).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(catalogueApi.updateForm).toHaveBeenCalledTimes(1);
      const [key, patch] = catalogueApi.updateForm.mock.calls[0] as unknown as [string, { document: Record<string, unknown> }];
      expect(key).toBe('system-access');
      expect(patch.document).not.toHaveProperty('version');
      expect(text(container.querySelector('.app-FormEditor__status'))).toMatch(/^Saved · \d\d:\d\d$/);
      expect(text(container.querySelector('h1')?.parentElement)).toContain('Unpublished changes');
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes after a confirmation that says what changed and who sees it', async () => {
    const { container } = render(
      <Frame>
        <FormEditor form={live()} usedBy={[{ key: 'system-access', name: 'Access to a system' }]} canManage canSeeRequestTypes breadcrumbs={[]} />
      </Frame>,
    );
    const first = container.querySelector<HTMLButtonElement>('[data-block="q:0"] [data-control="open"]')!;
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    });
    await clickAsync(container.querySelector('[data-action="publish"]')!);
    const confirm = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes('Publish System access request?'))!;
    expect(text(confirm)).toContain('Questions reordered. Publishes version 2. People who already started keep the version they opened.');
    expect(text(confirm)).toContain('Requesters of Access to a system see it immediately');
    await clickAsync(buttonNamed(confirm, 'Publish')!);
    expect(calls.map((call) => call.split(' ')[0])).toEqual(['updateForm', 'publishForm']);
  });

  it('shows the questions without controls to someone who may only read forms', () => {
    const { container } = render(
      <Frame>
        <FormEditor form={live()} usedBy={[]} canManage={false} canSeeRequestTypes={false} breadcrumbs={[]} viewOnly={{ label: 'System access request', permission: 'Manage forms', key: 'catalogue.form.manage' }} />
      </Frame>,
    );
    expect(container.querySelector('[data-action="publish"]')).toBeNull();
    expect(container.querySelector('[data-control="menu"]')).toBeNull();
    expect(buttonNamed(container, 'Add question')).toBeUndefined();
    expect(text(container)).toContain('View only');
  });
});

/* ======================================================================= */

describe('the pages’ stylesheets', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const sheets = ['catalogue/catalogue.css', 'fields/fields.css'].map((path) => ({ path, css: readFileSync(join(here, '..', 'components', path), 'utf8') }));

  it('spend only custom properties the design system emits', () => {
    for (const { path, css } of sheets) {
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(3);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
    }
  });

  it('declare only app- classes', () => {
    for (const { path, css } of sheets) {
      for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) {
        expect(line.trim().startsWith('.app-'), `${path}: ${line}`).toBe(true);
      }
    }
  });
});
