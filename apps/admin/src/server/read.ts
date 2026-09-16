import 'server-only';
import { ApiError } from '@itsm/sdk';

/**
 * One load, one outcome, no exceptions escaping into a render.
 *
 * Every read-only screen in this console does the same three things: check a
 * permission, fetch, and say something useful when the fetch fails. The third
 * was being written out longhand on each page, which is how a page ends up
 * rendering a 500 to somebody whose session simply expired.
 *
 * `Promise.all` is deliberately not wrapped here. A page that loads four lists
 * and loses one should still show the other three, so each list is read
 * separately and each says for itself whether it arrived — see `/queues`,
 * where the on-call rota and the skill list fail independently.
 */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return {
      ok: false,
      // The API's own message where there is one: "needs cmdb.read" is worth
      // showing, and "something went wrong" never is.
      message: error instanceof ApiError ? error.message : 'The API could not be reached.',
    };
  }
}
