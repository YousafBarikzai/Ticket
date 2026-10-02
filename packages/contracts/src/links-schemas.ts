/**
 * `@itsm/contracts/links/schemas` — the link rule as zod, for the API (§4.7.5).
 *
 * Server-only: it imports zod, which the browser half of the rule
 * (`@itsm/contracts/links`) must not. The two cannot disagree, because these
 * schemas call `isSafeHref` and `findUnsafeLinks` rather than restating them.
 */
import { z } from 'zod';
import { MAX_SAFE_HREF_LENGTH, UNSAFE_LINK_MESSAGE, findUnsafeLinks, isSafeHref } from './links.js';

/** A single link field: the status page's support link, a bridge link, a contract link. */
export const safeHrefSchema = z
  .string()
  .max(MAX_SAFE_HREF_LENGTH, { message: UNSAFE_LINK_MESSAGE })
  .refine((href) => isSafeHref(href), { message: UNSAFE_LINK_MESSAGE });

/**
 * For a field that stores a document with links inside it (a knowledge body,
 * a form's UI elements): one issue per refused link, at the link's own path,
 * so the field error reads `body.2.content.0.href` and the editor can point
 * at the paragraph. Use as `z.array(z.unknown()).superRefine(refineSafeLinks)`.
 */
export function refineSafeLinks(value: unknown, ctx: z.RefinementCtx): void {
  for (const link of findUnsafeLinks(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...link.segments], message: UNSAFE_LINK_MESSAGE });
  }
}
