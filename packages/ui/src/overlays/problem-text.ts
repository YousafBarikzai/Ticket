/**
 * What to say when an action a dialog or toast started has failed.
 *
 * The caller's rejection is usually an `ApiError` (a serialised `Problem`
 * with a human `detail` or `title`), sometimes a plain `Error`, sometimes a
 * string. The first human sentence found is used; otherwise the product's
 * generic line — never "[object Object]", never an empty alert.
 */
export const GENERIC_FAILURE = 'That didn’t work. Try again.';

export function problemText(error: unknown): string {
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  if (error && typeof error === 'object') {
    const { detail, title } = error as { detail?: unknown; title?: unknown };
    if (typeof detail === 'string' && detail.trim() !== '') return detail.trim();
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
    if (error instanceof Error && error.message.trim() !== '') return error.message.trim();
  }
  return GENERIC_FAILURE;
}
