import 'server-only';
import type { Problem } from '@itsm/ui';
import { ApiError } from '@itsm/sdk';
import { problemFrom } from '../problem.js';

/**
 * One load, one outcome, no exceptions escaping into a render.
 *
 * Every screen in this console does the same three things: check a
 * permission, fetch, and say something useful when the fetch fails. The third
 * was being written out longhand on each page, which is how a page ends up
 * rendering a 500 to somebody whose session simply expired.
 *
 * `Promise.all` is deliberately not wrapped here. A page that loads four lists
 * and loses one should still show the other three, so each list is read
 * separately and each says for itself whether it arrived (SPEC §4.10:
 * sections fail independently).
 *
 * A failure carries both the API's own sentence (`message`, what the legacy
 * panels print) and the structured `problem` a `Card problem` or
 * `ProblemState` words for itself — "needs cmdb.read" is worth showing, and
 * "something went wrong" never is.
 */
export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly problem: Problem };

export async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : 'The API could not be reached.',
      problem: problemFrom(error),
    };
  }
}
