/**
 * The form kit: submission with error summaries and drafts, sections, and
 * inline editing. Part of the root entry; the lazy editors inside `InlineEdit`
 * come from `@itsm/ui/overlays` only when opened.
 */
export { Form, type FormAutosave, type FormProps, type FormSubmitResult } from './Form.js';
export { FormErrorSummary, type FormErrorSummaryProps } from './FormErrorSummary.js';
export { FormSection, type FormSectionProps } from './FormSection.js';
export { InlineEdit, type InlineEditOption, type InlineEditProps, type InlineEditResult } from './InlineEdit.js';
