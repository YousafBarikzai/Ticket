/**
 * The form definition: a JSON Schema for the data plus a UI schema for how it
 * is presented and when.
 *
 * The same document is rendered by the portal, by the mobile app, by the admin
 * preview and — after a server-side transformation — by the Slack and Teams
 * modal builders. That is only safe because conditions are expressions from
 * `@itsm/expr`, which the API evaluates with the identical implementation when
 * it validates a submission. A condition expressed in JavaScript here would be
 * a rule the server could not enforce.
 *
 * It lives in the contracts package, not in the design system, so that claim is
 * literally true: the server imports this file and `logic.ts` beside it, and
 * validates a submission by running the same functions the browser ran. A second
 * implementation on the server would be a second set of rules, and the two would
 * disagree the first time either changed.
 */
import type { Expr } from '@itsm/expr';

/**
 * Mirrors the design system's intent names. Declared here rather than imported
 * so that the contract has no dependency on the client package: the server
 * validates these documents and must not need a design system to do it.
 */
export type FormIntent = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type FormValue = string | number | boolean | readonly string[] | null;
export type FormValues = Readonly<Record<string, FormValue>>;

export type FieldControl =
  | 'text'
  | 'longtext'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'user';

/** The subset of JSON Schema the form builder can produce and the API validates. */
export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly title?: string;
  readonly description?: string;
  readonly format?: 'date' | 'email' | 'uri';
  readonly enum?: readonly string[];
  readonly items?: { readonly type: 'string'; readonly enum?: readonly string[] };
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly default?: FormValue;
}

export interface FormJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  /** Unconditionally required fields. Conditional ones use `requiredWhen` on the UI element. */
  readonly required?: readonly string[];
}

export interface FieldOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

/** Formatting for a rich instruction. Structured, never HTML: see `RichInstruction`. */
export type RichInline =
  | { readonly text: string; readonly bold?: boolean; readonly italic?: boolean; readonly code?: boolean }
  | { readonly text: string; readonly href: string };

export type RichBlock =
  | { readonly type: 'paragraph'; readonly content: readonly RichInline[] }
  | { readonly type: 'list'; readonly ordered?: boolean; readonly items: readonly (readonly RichInline[])[] };

export interface UiFieldElement {
  readonly kind: 'field';
  /** The property name in the JSON Schema. */
  readonly field: string;
  readonly control: FieldControl;
  readonly label?: string;
  readonly help?: string;
  readonly placeholder?: string;
  readonly options?: readonly FieldOption[];
  readonly visibleWhen?: Expr;
  readonly requiredWhen?: Expr;
  readonly readOnlyWhen?: Expr;
  readonly rows?: number;
  /** `user` control: characters before the picker queries the directory. */
  readonly minQueryLength?: number;
}

export interface UiSectionElement {
  readonly kind: 'section';
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly elements: readonly UiElement[];
  readonly visibleWhen?: Expr;
}

export interface UiInstructionElement {
  readonly kind: 'instruction';
  readonly id: string;
  readonly content: readonly RichBlock[];
  readonly intent?: FormIntent;
  readonly visibleWhen?: Expr;
}

export type UiElement = UiFieldElement | UiSectionElement | UiInstructionElement;

export interface UiSchema {
  readonly elements: readonly UiElement[];
}

export interface FormDefinition {
  readonly key: string;
  readonly version: number;
  readonly title?: string;
  readonly description?: string;
  readonly schema: FormJsonSchema;
  readonly ui: UiSchema;
}

export function isFieldElement(element: UiElement): element is UiFieldElement {
  return element.kind === 'field';
}

export function isSectionElement(element: UiElement): element is UiSectionElement {
  return element.kind === 'section';
}
