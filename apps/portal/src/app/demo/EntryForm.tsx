import type { ReactNode } from 'react';
import { AutoSubmitForm } from '@itsm/ui';

/**
 * The form that begins a demo visit (SPEC v3 §4.6.2), for `/demo` only — its
 * own module, so the other sign-in pages carry no `AutoSubmitForm`.
 */

/** The demo entry form, as `decideDemoEntry` describes it (§4.6.2): hidden fields only, posted same-origin. */
export interface EntryFormSpec {
  readonly id: string;
  readonly method: 'post';
  readonly action: string;
  readonly fields: { readonly persona: string; readonly redirectTo: string; readonly confirm?: string };
}

export interface EntryFormProps {
  readonly form: EntryFormSpec;
  /** The button's words. */
  readonly label: string;
  /**
   * Submits by itself once the page is visible (P7, P7h). The button stays,
   * and after three seconds reads "Taking a while? Open the demo" (`late`).
   */
  readonly auto?: boolean;
  /** `hop`: the button appears only after three seconds, already reading `late`. */
  readonly lateOnly?: boolean;
  readonly primary?: boolean;
}

/** The late words of an automatic entry (§4.6.2). */
export const TAKING_A_WHILE = 'Taking a while? Open the demo';

/**
 * The form that begins a demo visit. A real form post, so it works without
 * script; `AutoSubmitForm` submits it once the page is visible (never a
 * prerender, never twice), and only where `decideDemoEntry` said the request
 * came from this product (D22).
 */
export function EntryForm({ form, label, auto = false, lateOnly = false, primary = true }: EntryFormProps): ReactNode {
  const tone = primary ? 'primary' : 'secondary';
  return (
    <>
      <form id={form.id} method={form.method} action={form.action} className="app-Entry__form">
        <input type="hidden" name="persona" value={form.fields.persona} />
        <input type="hidden" name="redirectTo" value={form.fields.redirectTo} />
        {form.fields.confirm ? <input type="hidden" name="confirm" value={form.fields.confirm} /> : null}
        <button
          type="submit"
          className={`itsm-Button itsm-Button--${tone} itsm-Button--lg itsm-Button--fullWidth${lateOnly ? ' app-Entry__late' : ''}`}
        >
          {auto && !lateOnly ? (
            <span className="itsm-Button__label app-Entry__labels">
              <span className="app-Entry__now">{label}</span>
              <span className="app-Entry__late">{TAKING_A_WHILE}</span>
            </span>
          ) : (
            <span className="itsm-Button__label">{lateOnly ? TAKING_A_WHILE : label}</span>
          )}
        </button>
      </form>
      {auto ? <AutoSubmitForm formId={form.id} /> : null}
    </>
  );
}
