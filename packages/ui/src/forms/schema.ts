/**
 * The form definition, re-exported from `@itsm/contracts/forms`.
 *
 * The contract lives in `@itsm/contracts` so that the server validates a
 * submission with the same code the browser used to collect it; it is
 * re-exported here because the design system is where a component author
 * looks for it.
 *
 * Through the `forms` subpath and not the contracts root: the root is the whole
 * API contract — ticket models, events, routes and their zod schemas — and
 * `FormRenderer` needs none of it. Importing it from here once meant every page
 * that rendered a form, and every page sharing its bundle chunk, carried all of
 * that. Named rather than `export *`, so this file says what it provides and
 * `logic.ts` beside it provides the rest.
 */
export {
  isFieldElement,
  isSectionElement,
  type FieldControl,
  type FieldOption,
  type FormDefinition,
  type FormIntent,
  type FormJsonSchema,
  type FormValue,
  type FormValues,
  type JsonSchemaProperty,
  type RichBlock,
  type RichInline,
  type UiElement,
  type UiFieldElement,
  type UiInstructionElement,
  type UiSchema,
  type UiSectionElement,
} from '@itsm/contracts/forms';
