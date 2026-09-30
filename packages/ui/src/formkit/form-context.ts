'use client';

import { createContext, useContext } from 'react';

/**
 * What a `Form` tells the parts inside it.
 *
 * Two contexts rather than one: the field errors change only when a submit
 * fails or a field is fixed, and every `FormField` reads them, while the
 * rest (busy, dirty, the draft's time) changes more often and is read only by
 * `FormActions` and the caller's render prop. Keeping them apart means typing
 * in one field does not re-render every other field.
 */

/** Messages from the last failed submit, keyed by the id of the control each is about. */
export const FormFieldErrorsContext = createContext<Readonly<Record<string, string>> | null>(null);

/**
 * The message a failed submit left for the control with this id, if any.
 * `FormField` reads it, so a field shows the error `Form` mapped onto it
 * without the caller threading it through; a `FormField` given its own
 * `error` shows that instead.
 */
export function useMappedFieldError(controlId: string): string | undefined {
  return useContext(FormFieldErrorsContext)?.[controlId];
}

export interface FormContextValue {
  readonly submitting: boolean;
  readonly dirty: boolean;
  readonly stickyActions: boolean;
  /** Whether the form keeps a draft, and when it last did. */
  readonly autosave: boolean;
  readonly savedAt: Date | null;
  /** `FormActions` says it is there, so the form does not show the draft's time a second time. */
  registerActions(): () => void;
}

export const FormContext = createContext<FormContextValue | null>(null);

/** The surrounding `Form`'s state, or `null` outside one. */
export function useFormContext(): FormContextValue | null {
  return useContext(FormContext);
}
