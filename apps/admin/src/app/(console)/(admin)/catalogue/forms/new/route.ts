import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * `/catalogue/forms/new` — old links and bookmarks for a new form. A new form
 * is a name and a key asked in a dialog over the forms list (SPEC §6.1), so
 * this address opens that dialog: `/catalogue/forms?new=1`, which the forms
 * page gates like any other (Forbidden for someone who may not read forms,
 * and no dialog for someone who may not write them). The palette's *New
 * form* goes there directly. The key `new` stays reserved for forms.
 *
 * A route handler rather than a page, as `/automation` is, so the answer is
 * a real 307 before anything renders: a page under the console's loading
 * boundary streams its frame first, and its `redirect()` could then only be
 * a client-side hop behind a 200.
 */
export function GET(): never {
  redirect('/catalogue/forms?new=1');
}
