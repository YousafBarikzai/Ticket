import {
  brokenConditions,
  buildEvalContext,
  type FieldControl,
  type FieldOption,
  type FormDefinition,
  type FormIntent,
  type JsonSchemaProperty,
  type RichBlock,
  type UiElement,
  type UiFieldElement,
} from '@itsm/contracts/forms';
import type { IconName } from '@itsm/ui';
import { FIELD_KEY, keyFor } from '../../keys.js';
import type { Fact } from '../../rules/facts.js';

/**
 * A form's questions as the builder edits them, and back (SPEC §6.1 Forms,
 * B §3.6).
 *
 * A form is stored as two halves that must agree: a JSON Schema for the
 * answers (`schema.properties`, `required`) and a list of UI elements saying
 * how each is asked (`ui.elements`: fields, sections, instructions). The
 * server refuses a document whose halves disagree (`assertDocumentIsCoherent`),
 * and a person should never have to think about either half, so the builder
 * works on *questions* — a label, a type, a hint, when it is required and when
 * it shows — and writes both halves from them.
 *
 * Two rules run through this file, the same ones the condition builder keeps:
 *
 *   - **Nothing the builder cannot draw is lost.** A question's placeholder,
 *     length limits or read-only condition, an instruction with bold text or
 *     links, a section inside a section: each is carried through untouched
 *     (`keep`, `editable: false`, `opaque`) rather than simplified into what
 *     the builder can show — which would delete the rest on the next save.
 *   - **Pure.** No React, no SDK: the sheet, the full-page editor, the
 *     preview and the tests all use the same functions.
 *
 * Drafts are written *without* the `version` stamp that publishing adds
 * (`publishForm` writes `document.version = form.version`). That is how the
 * console tells a live form with unpublished changes from one without, with no
 * API change: a published document carries its version, a saved draft does
 * not (`hasUnpublishedChanges`).
 */

/* =========================================================================
 * Types of question
 * ====================================================================== */

export type QuestionType = FieldControl;

export interface QuestionTypeInfo {
  readonly type: QuestionType;
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
}

/** The palette, in the order a person reaches for them. */
export const QUESTION_TYPES: readonly QuestionTypeInfo[] = [
  { type: 'text', label: 'Short text', icon: 'pencil', description: 'A line of text, like a name or an asset tag.' },
  { type: 'longtext', label: 'Paragraph', icon: 'note', description: 'Several lines, for a description or a reason.' },
  { type: 'select', label: 'Dropdown', icon: 'chevrons-up-down', description: 'One choice from a list.' },
  { type: 'multiselect', label: 'Multi-select', icon: 'list-filter', description: 'Any number of choices from a list.' },
  { type: 'checkbox', label: 'Checkbox', icon: 'circle-check', description: 'Yes or no, like agreeing to terms.' },
  { type: 'number', label: 'Number', icon: 'sliders-horizontal', description: 'A number, like a quantity.' },
  { type: 'date', label: 'Date', icon: 'calendar', description: 'A day, like when something is needed by.' },
  { type: 'user', label: 'Person', icon: 'user', description: 'Someone in the directory, like a line manager.' },
];

const TYPE_INFO = new Map(QUESTION_TYPES.map((info) => [info.type, info]));

export function questionTypeInfo(type: QuestionType): QuestionTypeInfo {
  return TYPE_INFO.get(type) ?? { type, label: type, icon: 'pencil', description: '' };
}

export function hasOptions(type: QuestionType): boolean {
  return type === 'select' || type === 'multiselect';
}

/* =========================================================================
 * The draft
 * ====================================================================== */

export interface OptionDraft {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** The value follows the label until the option has been saved (or edited by hand). */
  readonly auto: boolean;
  /** Carried through: an option's description and disabled flag, which the builder does not edit. */
  readonly keep?: { readonly description?: string; readonly disabled?: boolean };
}

export type Requirement = 'never' | 'always' | 'when';

export interface QuestionDraft {
  readonly kind: 'question';
  readonly id: string;
  /** The answer's name in the schema (`accessLevel`): permanent once people have answered it. */
  readonly field: string;
  /** Follows the label (camelCase) until edited by hand. */
  readonly autoKey: boolean;
  /** Was in the form when the editor opened and the form has been published: answers exist under this key. */
  readonly keyLocked: boolean;
  readonly type: QuestionType;
  readonly label: string;
  readonly hint: string;
  readonly required: Requirement;
  /** The condition when `required` is `when`. */
  readonly requiredWhen: unknown;
  /** Shown only when this holds; `null` for always. */
  readonly visibleWhen: unknown;
  readonly options: readonly OptionDraft[];
  /** What the builder does not edit, carried through as it was. */
  readonly keep: { readonly element: Readonly<Record<string, unknown>>; readonly property: Readonly<Record<string, unknown>> };
}

export interface InstructionDraft {
  readonly kind: 'instruction';
  readonly id: string;
  /** The element id in the document. */
  readonly elementId: string;
  /** Plain paragraphs, one per blank-line-separated block. */
  readonly text: string;
  /** False when the stored content has formatting, links or lists this builder cannot write: kept as it is. */
  readonly editable: boolean;
  readonly content: readonly RichBlock[];
  readonly intent?: FormIntent;
  readonly visibleWhen: unknown;
}

export interface SectionDraft {
  readonly kind: 'section';
  readonly id: string;
  readonly elementId: string;
  readonly title: string;
  readonly description: string;
  readonly visibleWhen: unknown;
  readonly children: readonly ChildBlock[];
}

/** Anything the builder cannot represent — a section inside a section — kept exactly as it was. */
export interface OpaqueDraft {
  readonly kind: 'opaque';
  readonly id: string;
  readonly element: UiElement;
  /** The schema properties its fields answer to, so rebuilding the schema keeps them. */
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required: readonly string[];
}

export type ChildBlock = QuestionDraft | InstructionDraft | OpaqueDraft;
export type Block = ChildBlock | SectionDraft;

export interface QuestionsDraft {
  readonly blocks: readonly Block[];
  /** The document's own title and description, carried through. */
  readonly title?: string;
  readonly description?: string;
}

export const EMPTY_DRAFT: QuestionsDraft = { blocks: [] };

let nextId = 0;
/**
 * A local id for a block or option made in the browser: stable across
 * edits, never written to the document. Blocks read from a document get
 * ids from their place in it instead (`q:2`, `q:1.3`), so the server's
 * render and the browser's agree.
 */
export function localId(prefix = 'q'): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/* =========================================================================
 * Document → draft
 * ====================================================================== */

const ELEMENT_EDITED = new Set(['kind', 'field', 'control', 'label', 'help', 'options', 'visibleWhen', 'requiredWhen']);
const PROPERTY_KEPT_BY_TYPE: Readonly<Record<QuestionType, readonly string[]>> = {
  text: ['minLength', 'maxLength', 'pattern', 'format', 'default', 'description'],
  longtext: ['minLength', 'maxLength', 'pattern', 'default', 'description'],
  number: ['minimum', 'maximum', 'default', 'description'],
  date: ['default', 'description'],
  select: ['default', 'description'],
  multiselect: ['default', 'description'],
  checkbox: ['default', 'description'],
  user: ['default', 'description'],
};

function pick(source: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

function omit(source: Readonly<Record<string, unknown>>, keys: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (!keys.has(key) && value !== undefined) out[key] = value;
  return out;
}

/** Plain paragraphs, when that is all an instruction holds; otherwise null. */
export function plainText(content: readonly RichBlock[]): string | null {
  const paragraphs: string[] = [];
  for (const block of content) {
    if (block.type !== 'paragraph') return null;
    let text = '';
    for (const inline of block.content) {
      if ('href' in inline) return null;
      if (inline.bold || inline.italic || inline.code) return null;
      text += inline.text;
    }
    paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

/** Paragraphs from text: a blank line starts a new one. */
export function richFromText(text: string): RichBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: 'paragraph' as const, content: [{ text: paragraph }] }));
}

function questionFrom(element: UiFieldElement, document: FormDefinition, published: boolean, id: string): QuestionDraft {
  const property = document.schema.properties[element.field];
  const required: Requirement = document.schema.required?.includes(element.field) ? 'always' : element.requiredWhen ? 'when' : 'never';
  const type = element.control;
  return {
    kind: 'question',
    id,
    field: element.field,
    autoKey: false,
    keyLocked: published,
    type,
    label: element.label ?? property?.title ?? element.field,
    hint: element.help ?? '',
    required,
    requiredWhen: required === 'when' ? element.requiredWhen : null,
    visibleWhen: element.visibleWhen ?? null,
    options: (element.options ?? []).map((option, index) => ({
      id: `${id}/o${index}`,
      label: option.label,
      value: option.value,
      auto: false,
      ...(option.description !== undefined || option.disabled !== undefined
        ? { keep: { ...(option.description !== undefined ? { description: option.description } : {}), ...(option.disabled !== undefined ? { disabled: option.disabled } : {}) } }
        : {}),
    })),
    keep: {
      element: omit(element as unknown as Record<string, unknown>, ELEMENT_EDITED),
      property: pick(property as unknown as Record<string, unknown> | undefined, PROPERTY_KEPT_BY_TYPE[type] ?? []),
    },
  };
}

function boundFields(element: UiElement): string[] {
  if (element.kind === 'field') return [element.field];
  if (element.kind === 'section') return element.elements.flatMap(boundFields);
  return [];
}

function opaqueFrom(element: UiElement, document: FormDefinition, id: string): OpaqueDraft {
  const fields = boundFields(element);
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const field of fields) {
    const property = document.schema.properties[field];
    if (property) properties[field] = property;
  }
  return {
    kind: 'opaque',
    id,
    element,
    properties,
    required: (document.schema.required ?? []).filter((field) => fields.includes(field)),
  };
}

function childFrom(element: UiElement, document: FormDefinition, published: boolean, path: string): ChildBlock {
  if (element.kind === 'field') {
    // A field bound to nothing in the schema cannot be answered; the server
    // refuses such a document, so it cannot be stored — but if one arrives it
    // is kept as found rather than invented.
    return document.schema.properties[element.field] ? questionFrom(element, document, published, `q:${path}`) : opaqueFrom(element, document, `x:${path}`);
  }
  if (element.kind === 'instruction') {
    const text = plainText(element.content);
    return {
      kind: 'instruction',
      id: `i:${path}`,
      elementId: element.id,
      text: text ?? '',
      editable: text !== null,
      content: element.content,
      ...(element.intent ? { intent: element.intent } : {}),
      visibleWhen: element.visibleWhen ?? null,
    };
  }
  return opaqueFrom(element, document, `x:${path}`);
}

/**
 * The draft for a stored document. `published` locks the keys of the
 * questions it holds — answers already exist under them.
 */
export function fromDocument(document: FormDefinition | null | undefined, { published = false }: { published?: boolean } = {}): QuestionsDraft {
  if (!document) return EMPTY_DRAFT;
  const blocks: Block[] = (document.ui?.elements ?? []).map((element, index): Block => {
    if (element.kind === 'section') {
      return {
        kind: 'section',
        id: `s:${index}`,
        elementId: element.id,
        title: element.title,
        description: element.description ?? '',
        visibleWhen: element.visibleWhen ?? null,
        children: element.elements.map((child, at) =>
          child.kind === 'section' ? opaqueFrom(child, document, `x:${index}.${at}`) : childFrom(child, document, published, `${index}.${at}`),
        ),
      };
    }
    return childFrom(element, document, published, String(index));
  });
  return {
    blocks,
    ...(document.title !== undefined ? { title: document.title } : {}),
    ...(document.description !== undefined ? { description: document.description } : {}),
  };
}

/* =========================================================================
 * Draft → document
 * ====================================================================== */

/** The stored shape: a form document without the version publishing stamps on it. */
export type FormDocument = Omit<FormDefinition, 'version'> & { readonly version?: number };

function isAlways(expression: unknown): boolean {
  return typeof expression === 'object' && expression !== null && (expression as { always?: unknown }).always === true;
}

/** A condition worth writing: not empty, not "always". */
function condition(expression: unknown): unknown {
  if (expression === null || expression === undefined || isAlways(expression)) return undefined;
  return expression;
}

function propertyFor(question: QuestionDraft): JsonSchemaProperty {
  const kept = question.keep.property;
  const title = question.label.trim() || undefined;
  const values = question.options.map((option) => option.value);
  const base = { ...(title ? { title } : {}), ...kept };
  switch (question.type) {
    case 'number':
      return { ...base, type: 'number' } as JsonSchemaProperty;
    case 'date':
      return { ...base, type: 'string', format: 'date' } as JsonSchemaProperty;
    case 'select':
      return { ...base, type: 'string', enum: values } as JsonSchemaProperty;
    case 'multiselect':
      return { ...base, type: 'array', items: { type: 'string', enum: values } } as JsonSchemaProperty;
    case 'checkbox':
      return { ...base, type: 'boolean' } as JsonSchemaProperty;
    default:
      return { ...base, type: 'string' } as JsonSchemaProperty;
  }
}

function elementFor(question: QuestionDraft, field: string, preview = false): UiFieldElement {
  const options: FieldOption[] = question.options.map((option) => ({ value: option.value, label: option.label.trim(), ...(option.keep ?? {}) }));
  const visibleWhen = condition(question.visibleWhen);
  const requiredWhen = question.required === 'when' ? condition(question.requiredWhen) : undefined;
  return {
    ...question.keep.element,
    kind: 'field',
    field,
    control: question.type,
    ...(question.label.trim() ? { label: question.label.trim() } : preview ? { label: 'Untitled question' } : {}),
    ...(question.hint.trim() ? { help: question.hint.trim() } : {}),
    ...(hasOptions(question.type) ? { options } : {}),
    ...(visibleWhen ? { visibleWhen } : {}),
    ...(requiredWhen ? { requiredWhen } : {}),
  } as UiFieldElement;
}

/**
 * The document for a draft. `preview` stands in a placeholder key for a
 * question whose key is not usable yet, so the preview can show it while
 * the person is still typing its label.
 */
export function toDocument(draft: QuestionsDraft, key: string, { preview = false }: { preview?: boolean } = {}): FormDocument {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  const fieldOf = (question: QuestionDraft): string => (preview && !FIELD_KEY.test(question.field) ? `_${question.id.replace(/\W/g, '')}` : question.field);

  const child = (block: ChildBlock): UiElement => {
    if (block.kind === 'question') {
      const field = fieldOf(block);
      properties[field] = propertyFor(block);
      if (block.required === 'always') required.push(field);
      return elementFor(block, field, preview);
    }
    if (block.kind === 'instruction') {
      const visibleWhen = condition(block.visibleWhen);
      return {
        kind: 'instruction',
        id: block.elementId,
        content: block.editable ? richFromText(block.text) : block.content,
        ...(block.intent ? { intent: block.intent } : {}),
        ...(visibleWhen ? { visibleWhen } : {}),
      } as UiElement;
    }
    Object.assign(properties, block.properties);
    required.push(...block.required);
    return block.element;
  };

  const elements: UiElement[] = draft.blocks.map((block) => {
    if (block.kind !== 'section') return child(block);
    const visibleWhen = condition(block.visibleWhen);
    return {
      kind: 'section',
      id: block.elementId,
      title: block.title.trim(),
      ...(block.description.trim() ? { description: block.description.trim() } : {}),
      elements: block.children.map(child),
      ...(visibleWhen ? { visibleWhen } : {}),
    } as UiElement;
  });

  return {
    key,
    ...(draft.title !== undefined ? { title: draft.title } : {}),
    ...(draft.description !== undefined ? { description: draft.description } : {}),
    schema: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    ui: { elements },
  };
}

/** The document the preview renders: always valid enough to draw. */
export function previewDefinition(draft: QuestionsDraft, key: string, title?: string): FormDefinition {
  const document = toDocument(draft, key || 'preview', { preview: true });
  return { ...document, version: 0, ...(title ? { title } : {}) } as FormDefinition;
}

/* =========================================================================
 * Walking and editing the draft
 * ====================================================================== */

/** Every question, in document order, sections included. */
export function questionsOf(draft: QuestionsDraft): QuestionDraft[] {
  const out: QuestionDraft[] = [];
  for (const block of draft.blocks) {
    if (block.kind === 'question') out.push(block);
    if (block.kind === 'section') for (const child of block.children) if (child.kind === 'question') out.push(child);
  }
  return out;
}

/** Every field key the document answers to, including ones inside kept blocks. */
export function fieldKeysOf(draft: QuestionsDraft): string[] {
  const keys: string[] = [];
  const visit = (block: Block): void => {
    if (block.kind === 'question') keys.push(block.field);
    else if (block.kind === 'opaque') keys.push(...boundFields(block.element));
    else if (block.kind === 'section') block.children.forEach(visit);
  };
  draft.blocks.forEach(visit);
  return keys;
}

export function countQuestions(draft: QuestionsDraft): number {
  return fieldKeysOf(draft).length;
}

/** Where a block sits: its section (or null at the top) and its index there. */
export function locate(draft: QuestionsDraft, id: string): { readonly section: SectionDraft | null; readonly index: number; readonly block: Block } | null {
  for (const [index, block] of draft.blocks.entries()) {
    if (block.id === id) return { section: null, index, block };
    if (block.kind === 'section') {
      const at = block.children.findIndex((child) => child.id === id);
      if (at >= 0) return { section: block, index: at, block: block.children[at]! };
    }
  }
  return null;
}

export function findBlock(draft: QuestionsDraft, id: string): Block | null {
  return locate(draft, id)?.block ?? null;
}

/** Replaces one block wherever it sits. */
export function updateBlock(draft: QuestionsDraft, id: string, change: (block: Block) => Block): QuestionsDraft {
  return {
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.id === id) return change(block);
      if (block.kind === 'section' && block.children.some((child) => child.id === id)) {
        return { ...block, children: block.children.map((child) => (child.id === id ? (change(child) as ChildBlock) : child)) };
      }
      return block;
    }),
  };
}

/**
 * Changes a question. A label change carries its key with it while the key
 * still follows the label; a type change drops the kept constraints that
 * belonged to the old type (a maximum length means nothing on a number) and
 * gives a list type its first option.
 */
export function updateQuestion(draft: QuestionsDraft, id: string, patch: Partial<Omit<QuestionDraft, 'kind' | 'id'>>): QuestionsDraft {
  return updateBlock(draft, id, (block) => {
    if (block.kind !== 'question') return block;
    let next: QuestionDraft = { ...block, ...patch };
    if (patch.label !== undefined && next.autoKey && !next.keyLocked) next = { ...next, field: keyFor(patch.label) };
    if (patch.type !== undefined && patch.type !== block.type) {
      const keepProperty = pick(block.keep.property, PROPERTY_KEPT_BY_TYPE[patch.type] ?? []);
      next = { ...next, keep: { element: block.keep.element, property: keepProperty } };
      if (hasOptions(patch.type) && next.options.length === 0) next = { ...next, options: [newOption('Option 1')] };
      if (!hasOptions(patch.type)) next = { ...next, options: [] };
    }
    return next;
  });
}

export function newQuestion(type: QuestionType, label = ''): QuestionDraft {
  return {
    kind: 'question',
    id: localId(),
    field: keyFor(label),
    autoKey: true,
    keyLocked: false,
    type,
    label,
    hint: '',
    required: 'never',
    requiredWhen: null,
    visibleWhen: null,
    options: hasOptions(type) ? [newOption('Option 1'), newOption('Option 2')] : [],
    keep: { element: {}, property: {} },
  };
}

export function newSection(taken: readonly string[] = []): SectionDraft {
  let n = 1;
  while (taken.includes(`section-${n}`)) n += 1;
  return { kind: 'section', id: localId('s'), elementId: `section-${n}`, title: '', description: '', visibleWhen: null, children: [] };
}

export function newInstruction(taken: readonly string[] = []): InstructionDraft {
  let n = 1;
  while (taken.includes(`instruction-${n}`)) n += 1;
  return { kind: 'instruction', id: localId('i'), elementId: `instruction-${n}`, text: '', editable: true, content: [], visibleWhen: null };
}

/** Element ids already used by sections and instructions, so a new one gets a fresh id. */
export function elementIdsOf(draft: QuestionsDraft): string[] {
  const ids: string[] = [];
  for (const block of draft.blocks) {
    if (block.kind === 'section' || block.kind === 'instruction') ids.push(block.elementId);
    if (block.kind === 'section') for (const child of block.children) if (child.kind === 'instruction') ids.push(child.elementId);
  }
  return ids;
}

/**
 * Adds a block after `afterId` (in the same section), or at the end of
 * `sectionId`, or at the end of the form. A section is only ever added at
 * the top: sections nest one level.
 */
export function addBlock(draft: QuestionsDraft, block: Block, where: { readonly afterId?: string | null; readonly sectionId?: string | null } = {}): QuestionsDraft {
  if (block.kind !== 'section') {
    const after = where.afterId ? locate(draft, where.afterId) : null;
    const sectionId = after ? (after.block.kind === 'section' ? after.block.id : after.section?.id) : where.sectionId;
    if (sectionId) {
      return {
        ...draft,
        blocks: draft.blocks.map((entry) => {
          if (entry.kind !== 'section' || entry.id !== sectionId) return entry;
          const children = [...entry.children];
          const at = after && after.section?.id === sectionId ? after.index + 1 : children.length;
          children.splice(at, 0, block);
          return { ...entry, children };
        }),
      };
    }
    if (after && after.section === null) {
      const blocks = [...draft.blocks];
      blocks.splice(after.index + 1, 0, block);
      return { ...draft, blocks };
    }
    return { ...draft, blocks: [...draft.blocks, block] };
  }
  const after = where.afterId ? locate(draft, where.afterId) : null;
  const topIndex = after ? (after.section ? draft.blocks.findIndex((entry) => entry.id === after.section!.id) : after.index) : draft.blocks.length - 1;
  const blocks = [...draft.blocks];
  blocks.splice(topIndex + 1, 0, block);
  return { ...draft, blocks };
}

/**
 * Removes a block. A section's questions are not removed with it: they move
 * out to where the section was, so taking away a heading never takes the
 * questions under it.
 */
export function removeBlock(draft: QuestionsDraft, id: string): QuestionsDraft {
  const found = locate(draft, id);
  if (!found) return draft;
  if (found.section === null) {
    const blocks = [...draft.blocks];
    const [removed] = blocks.splice(found.index, 1);
    if (removed?.kind === 'section') blocks.splice(found.index, 0, ...removed.children);
    return { ...draft, blocks };
  }
  return updateBlock(draft, found.section.id, (section) =>
    section.kind === 'section' ? { ...section, children: section.children.filter((child) => child.id !== id) } : section,
  );
}

/** Puts a question or instruction back where it was: the undo for `removeBlock`. */
export function insertAt(draft: QuestionsDraft, block: ChildBlock, sectionId: string | null, index: number): QuestionsDraft {
  if (sectionId) {
    const exists = draft.blocks.some((entry) => entry.kind === 'section' && entry.id === sectionId);
    if (exists) {
      return {
        ...draft,
        blocks: draft.blocks.map((entry) => {
          if (entry.kind !== 'section' || entry.id !== sectionId) return entry;
          const children = [...entry.children];
          children.splice(Math.min(index, children.length), 0, block);
          return { ...entry, children };
        }),
      };
    }
  }
  const blocks = [...draft.blocks];
  blocks.splice(Math.min(index, blocks.length), 0, block);
  return { ...draft, blocks };
}

export function duplicateQuestion(draft: QuestionsDraft, id: string): { draft: QuestionsDraft; copyId: string | null } {
  const found = locate(draft, id);
  if (!found || found.block.kind !== 'question') return { draft, copyId: null };
  const source = found.block;
  const label = source.label ? `${source.label} (copy)` : '';
  const copy: QuestionDraft = {
    ...source,
    id: localId(),
    label,
    field: keyFor(label),
    autoKey: true,
    keyLocked: false,
    options: source.options.map((option) => ({ ...option, id: localId('o') })),
  };
  return { draft: addBlock(draft, copy, { afterId: id }), copyId: copy.id };
}

export type MoveResult = { readonly draft: QuestionsDraft; readonly where: string } | null;

/**
 * Moves a block one step, the way Alt+↑/↓ and the Move up and Move down items do.
 *
 * Inside a section a question moves among its siblings, and past the first
 * or last it steps out of the section. At the top, a question moving onto a
 * section steps into it (as its last question going up, its first going
 * down). Sections move past their neighbours whole. `where` says in words
 * where it landed, for the announcement. Null when it cannot move.
 */
export function moveBlock(draft: QuestionsDraft, id: string, direction: 'up' | 'down'): MoveResult {
  const found = locate(draft, id);
  if (!found) return null;
  const step = direction === 'up' ? -1 : 1;
  const blocks = [...draft.blocks];

  if (found.section) {
    const section = found.section;
    const children = [...section.children];
    const target = found.index + step;
    const sectionIndex = blocks.findIndex((entry) => entry.id === section.id);
    if (target >= 0 && target < children.length) {
      const [moved] = children.splice(found.index, 1);
      children.splice(target, 0, moved!);
      blocks[sectionIndex] = { ...section, children };
      return { draft: { ...draft, blocks }, where: `position ${target + 1} of ${children.length} in ${sectionName(section)}` };
    }
    // Step out of the section, before or after it.
    const [moved] = children.splice(found.index, 1);
    blocks[sectionIndex] = { ...section, children };
    blocks.splice(direction === 'up' ? sectionIndex : sectionIndex + 1, 0, moved!);
    return { draft: { ...draft, blocks }, where: `${direction === 'up' ? 'before' : 'after'} ${sectionName(section)}` };
  }

  const target = found.index + step;
  if (target < 0 || target >= blocks.length) return null;
  const neighbour = blocks[target]!;
  const block = found.block;
  if (block.kind !== 'section' && neighbour.kind === 'section') {
    // Step into the neighbouring section.
    blocks.splice(found.index, 1);
    const sectionIndex = blocks.findIndex((entry) => entry.id === neighbour.id);
    const children = direction === 'up' ? [...neighbour.children, block] : [block, ...neighbour.children];
    blocks[sectionIndex] = { ...neighbour, children };
    return { draft: { ...draft, blocks }, where: `${direction === 'up' ? 'end' : 'start'} of ${sectionName(neighbour)}` };
  }
  blocks.splice(found.index, 1);
  blocks.splice(target, 0, block);
  return { draft: { ...draft, blocks }, where: `position ${target + 1} of ${blocks.length}` };
}

/** Moves a question or instruction into a section (at its end), or out to the top level (null). */
export function moveToSection(draft: QuestionsDraft, id: string, sectionId: string | null): QuestionsDraft {
  const found = locate(draft, id);
  if (!found || found.block.kind === 'section') return draft;
  if ((found.section?.id ?? null) === sectionId) return draft;
  const without = found.section
    ? updateBlock(draft, found.section.id, (section) => (section.kind === 'section' ? { ...section, children: section.children.filter((child) => child.id !== id) } : section))
    : { ...draft, blocks: draft.blocks.filter((block) => block.id !== id) };
  const block = found.block as ChildBlock;
  if (sectionId === null) {
    if (!found.section) return draft;
    const sectionIndex = without.blocks.findIndex((entry) => entry.id === found.section!.id);
    const blocks = [...without.blocks];
    blocks.splice(sectionIndex + 1, 0, block);
    return { ...without, blocks };
  }
  return {
    ...without,
    blocks: without.blocks.map((entry) => (entry.kind === 'section' && entry.id === sectionId ? { ...entry, children: [...entry.children, block] } : entry)),
  };
}

export function sectionName(section: SectionDraft): string {
  return section.title.trim() ? `“${section.title.trim()}”` : 'the untitled section';
}

/** A block's name in words, for menus and announcements. */
export function blockName(block: Block, index?: number): string {
  switch (block.kind) {
    case 'question':
      return block.label.trim() || (index !== undefined ? `Question ${index + 1}` : 'Untitled question');
    case 'section':
      return block.title.trim() || 'Untitled section';
    case 'instruction':
      return 'Instruction';
    case 'opaque':
      return 'Kept as written';
  }
}

/* =========================================================================
 * Options
 * ====================================================================== */

/**
 * The stored value for an option's label: lower case, words joined by
 * hyphens, accents folded — "Read and write" is `read-and-write`. Kept apart
 * from the label so the words can be reworded after people have answered
 * without changing what their answers mean.
 */
export function optionValue(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function newOption(label = ''): OptionDraft {
  return { id: localId('o'), label, value: optionValue(label), auto: true };
}

/** A label change carries its value while the value still follows the label. */
export function relabelOption(option: OptionDraft, label: string): OptionDraft {
  return { ...option, label, ...(option.auto ? { value: optionValue(label) } : {}) };
}

export interface OptionProblems {
  /** Rows whose value another row already uses: the second and later ones. */
  readonly duplicateValues: ReadonlySet<string>;
  /** Rows reading the same as another: a warning, since requesters could not tell them apart. */
  readonly duplicateLabels: ReadonlySet<string>;
  readonly emptyLabels: ReadonlySet<string>;
  readonly emptyValues: ReadonlySet<string>;
}

export function optionProblems(options: readonly { readonly id: string; readonly label: string; readonly value: string }[]): OptionProblems {
  const seenValues = new Set<string>();
  const seenLabels = new Set<string>();
  const duplicateValues = new Set<string>();
  const duplicateLabels = new Set<string>();
  const emptyLabels = new Set<string>();
  const emptyValues = new Set<string>();
  for (const option of options) {
    const label = option.label.trim().toLowerCase();
    if (!label) emptyLabels.add(option.id);
    else if (seenLabels.has(label)) duplicateLabels.add(option.id);
    else seenLabels.add(label);
    if (!option.value) {
      if (label) emptyValues.add(option.id);
    } else if (seenValues.has(option.value)) duplicateValues.add(option.id);
    else seenValues.add(option.value);
  }
  return { duplicateValues, duplicateLabels, emptyLabels, emptyValues };
}

/* =========================================================================
 * Conditions over the answers
 * ====================================================================== */

/**
 * The questions a *Show when* or *Required when* can read, as condition
 * facts: `form.<key>` with the question's label, and its options for a list
 * question. A question never reads itself, and a date, a person or a long
 * text is left out — "Needed by is after …" needs a date picker the rows
 * do not have, and a comparison it cannot draw is worse than none.
 */
export function answerFacts(draft: QuestionsDraft, exceptId?: string): Fact[] {
  const facts: Fact[] = [];
  for (const question of questionsOf(draft)) {
    if (question.id === exceptId || !FIELD_KEY.test(question.field)) continue;
    const label = question.label.trim() || question.field;
    const path = `form.${question.field}`;
    switch (question.type) {
      case 'select':
        facts.push({ path, label, kind: 'enum', group: 'Answers', options: question.options.filter((option) => option.value).map((option) => ({ value: option.value, label: option.label || option.value })) });
        break;
      case 'multiselect':
        facts.push({
          path,
          label,
          kind: 'enum',
          group: 'Answers',
          options: question.options.filter((option) => option.value).map((option) => ({ value: option.value, label: option.label || option.value })),
          operators: ['contains', 'empty', 'exists'],
        });
        break;
      case 'checkbox':
        facts.push({ path, label, kind: 'boolean', group: 'Answers' });
        break;
      case 'number':
        facts.push({ path, label, kind: 'number', group: 'Answers' });
        break;
      case 'text':
        facts.push({ path, label, kind: 'text', group: 'Answers' });
        break;
      default:
        break;
    }
  }
  return facts;
}

/** Every `{ var }` path an expression reads. */
export function readsOf(expression: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (typeof record.var === 'string' && Object.keys(record).length === 1) {
        out.add(record.var);
        return;
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(expression);
  return [...out];
}

/* =========================================================================
 * Checking a draft before it is saved
 * ====================================================================== */

export type IssueField = 'label' | 'key' | 'options' | 'requiredWhen' | 'visibleWhen' | 'title' | 'text';

export interface Issue {
  readonly blockId: string;
  readonly field: IssueField;
  readonly message: string;
}

/**
 * What would stop this draft saving, in words that say what to do — the
 * same checks the server makes (`assertDocumentIsCoherent`), made first so
 * a person sees them beside the question rather than as a 422.
 */
export function checkQuestions(draft: QuestionsDraft): Issue[] {
  const issues: Issue[] = [];
  const questions = questionsOf(draft);
  const keys = new Map<string, number>();
  for (const key of fieldKeysOf(draft)) keys.set(key, (keys.get(key) ?? 0) + 1);
  const known = new Set(fieldKeysOf(draft));

  const conditionIssues = (blockId: string, field: 'visibleWhen' | 'requiredWhen', expression: unknown, noun: string): void => {
    for (const path of readsOf(expression)) {
      if (path.startsWith('form.') && !known.has(path.slice('form.'.length))) {
        issues.push({ blockId, field, message: `${noun} reads a question that is no longer in the form. Change or remove that condition.` });
        return;
      }
    }
  };

  for (const [index, question] of questions.entries()) {
    const name = question.label.trim() || `Question ${index + 1}`;
    if (!question.label.trim()) issues.push({ blockId: question.id, field: 'label', message: `Question ${index + 1} needs a label.` });
    if (!question.field) issues.push({ blockId: question.id, field: 'key', message: `${name}: this label can’t make a key. Edit the key by hand.` });
    else if (!FIELD_KEY.test(question.field)) issues.push({ blockId: question.id, field: 'key', message: `${name}: the key must start with a lower-case letter and use only letters and numbers.` });
    else if ((keys.get(question.field) ?? 0) > 1) issues.push({ blockId: question.id, field: 'key', message: `${name}: another question already uses the key “${question.field}”.` });

    if (hasOptions(question.type)) {
      const problems = optionProblems(question.options);
      if (question.options.length === 0) issues.push({ blockId: question.id, field: 'options', message: `${name} needs at least one option.` });
      else if (problems.emptyLabels.size > 0) issues.push({ blockId: question.id, field: 'options', message: `${name}: every option needs a label.` });
      else if (problems.duplicateValues.size > 0 || problems.emptyValues.size > 0) {
        issues.push({ blockId: question.id, field: 'options', message: `${name}: two options would be stored the same way. Reword one of them.` });
      }
    }

    if (question.required === 'when') {
      const expression = question.requiredWhen;
      if (expression === null || expression === undefined || isAlways(expression)) {
        issues.push({ blockId: question.id, field: 'requiredWhen', message: `${name}: add a condition for when it’s required, or choose Always.` });
      } else conditionIssues(question.id, 'requiredWhen', expression, `${name}’s “Required when”`);
    }
    conditionIssues(question.id, 'visibleWhen', question.visibleWhen, `${name}’s “Show when”`);
    if (readsOf(question.visibleWhen).includes(`form.${question.field}`)) {
      issues.push({ blockId: question.id, field: 'visibleWhen', message: `${name} can’t depend on its own answer to show.` });
    }
  }

  for (const block of draft.blocks) {
    if (block.kind === 'section') {
      if (!block.title.trim()) issues.push({ blockId: block.id, field: 'title', message: 'Every section needs a title.' });
      conditionIssues(block.id, 'visibleWhen', block.visibleWhen, `Section ${blockName(block)}’s “Show when”`);
    }
  }
  const instructions = draft.blocks.flatMap((block) => (block.kind === 'section' ? block.children : [block])).filter((block): block is InstructionDraft => block.kind === 'instruction');
  for (const instruction of instructions) {
    if (instruction.editable && !instruction.text.trim()) issues.push({ blockId: instruction.id, field: 'text', message: 'Write the instruction, or remove it.' });
  }

  // Conditions that cannot be evaluated at all: the same check the portal
  // makes before it lets anyone submit.
  if (issues.length === 0) {
    const document = { ...toDocument(draft, 'check'), version: 0 } as FormDefinition;
    const broken = brokenConditions(document, buildEvalContext({}));
    for (const where of broken) {
      const question = questions.find((entry) => entry.field === where);
      issues.push({ blockId: question?.id ?? '', field: 'visibleWhen', message: `${question?.label || where}: one of its conditions can’t be worked out. Check its values.` });
    }
  }
  return issues;
}

/* =========================================================================
 * What publishing would change
 * ====================================================================== */

/**
 * The same value, whatever order its keys were written in. A document read
 * back from the API has been through `jsonb`, which keeps keys in its own
 * order, so comparing the written strings would call an untouched question
 * "changed" (the rule `@itsm/platform`'s `jsonEquals` exists for, which a
 * browser bundle cannot import).
 */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || canonical(a) === canonical(b);
}

export interface QuestionChanges {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  /** The questions both versions share are asked in another order. */
  readonly reordered: boolean;
  /** Sections or instructions differ, with the questions themselves the same. */
  readonly layout: boolean;
}

function fieldElements(document: Pick<FormDefinition, 'ui'>): Map<string, UiFieldElement> {
  const out = new Map<string, UiFieldElement>();
  const walk = (elements: readonly UiElement[]): void => {
    for (const element of elements) {
      if (element.kind === 'field') out.set(element.field, element);
      else if (element.kind === 'section') walk(element.elements);
    }
  };
  walk(document.ui?.elements ?? []);
  return out;
}

/** Questions added, removed and changed between two documents, by key. */
export function diffQuestions(before: Pick<FormDefinition, 'ui' | 'schema'> | null, after: Pick<FormDefinition, 'ui' | 'schema'>): QuestionChanges {
  const was = before ? fieldElements(before) : new Map<string, UiFieldElement>();
  const now = fieldElements(after);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [field, element] of now) {
    const previous = was.get(field);
    if (!previous) added += 1;
    else if (
      !sameValue(previous, element) ||
      !sameValue(before?.schema.properties[field] ?? null, after.schema.properties[field] ?? null) ||
      (before?.schema.required?.includes(field) ?? false) !== (after.schema.required?.includes(field) ?? false)
    ) {
      changed += 1;
    }
  }
  for (const field of was.keys()) if (!now.has(field)) removed += 1;
  const shared = (order: Iterable<string>, other: Map<string, UiFieldElement>): string[] => [...order].filter((field) => other.has(field));
  const reordered = shared(was.keys(), now).join('\n') !== shared(now.keys(), was).join('\n');
  const layout =
    added + removed + changed === 0 && !reordered && !sameValue(before?.ui.elements ?? [], after.ui.elements);
  return { added, removed, changed, reordered, layout };
}

/** "3 questions added, 1 removed" — or null when nothing changed. */
export function describeChanges(changes: QuestionChanges): string | null {
  const noun = (count: number): string => (count === 1 ? 'question' : 'questions');
  const parts: string[] = [];
  if (changes.added > 0) parts.push(`${changes.added} ${noun(changes.added)} added`);
  if (changes.changed > 0) parts.push(parts.length > 0 ? `${changes.changed} changed` : `${changes.changed} ${noun(changes.changed)} changed`);
  if (changes.removed > 0) parts.push(parts.length > 0 ? `${changes.removed} removed` : `${changes.removed} ${noun(changes.removed)} removed`);
  if (changes.reordered) parts.push(parts.length > 0 ? 'the order changed' : 'Questions reordered');
  if (changes.layout) parts.push('Sections or instructions changed');
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The draft once published: every question's key is now fixed, because answers can exist under it. */
export function lockKeys(draft: QuestionsDraft): QuestionsDraft {
  const lock = (block: ChildBlock): ChildBlock => (block.kind === 'question' ? { ...block, keyLocked: true, autoKey: false } : block);
  return {
    ...draft,
    blocks: draft.blocks.map((block) => (block.kind === 'section' ? { ...block, children: block.children.map(lock) } : lock(block))),
  };
}

/** Whether two drafts would save as the same document. */
export function sameDocument(a: QuestionsDraft, b: QuestionsDraft, key: string): boolean {
  return sameValue(toDocument(a, key), toDocument(b, key));
}
