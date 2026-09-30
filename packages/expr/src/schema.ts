/**
 * The expression language's shape, as a zod schema.
 *
 * A module of its own, apart from the evaluator, for the browser's sake. The
 * requester portal evaluates form conditions (`evaluate`) on every catalogue
 * form but never validates an expression: that happens on the server, when a
 * definition is saved. `z.lazy(…)` below is a call at module level, so while it
 * lived beside `evaluate` every bundle that evaluated a condition carried zod
 * (about 13 kB gzipped on `/catalogue/[key]`, the portal's heaviest route).
 * Here, with `"sideEffects": false` on the package, a bundler drops this module
 * — and zod with it — from any bundle that names neither export.
 *
 * `index.ts` re-exports both names, so `import { exprSchema } from
 * '@itsm/expr'` keeps working everywhere it is used on the server.
 */
import { z } from 'zod';
import type { Expr, Operand } from './index.js';

const operandSchema: z.ZodType<Operand> = z.lazy(() =>
  z.union([
    z.object({ var: z.string().min(1).max(200) }).strict(),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ]),
);

const pair = z.tuple([operandSchema, operandSchema]);

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(exprSchema).min(1).max(50) }).strict(),
    z.object({ or: z.array(exprSchema).min(1).max(50) }).strict(),
    z.object({ not: exprSchema }).strict(),
    z.object({ eq: pair }).strict(),
    z.object({ ne: pair }).strict(),
    z.object({ gt: pair }).strict(),
    z.object({ gte: pair }).strict(),
    z.object({ lt: pair }).strict(),
    z.object({ lte: pair }).strict(),
    z.object({ in: pair }).strict(),
    z.object({ nin: pair }).strict(),
    z.object({ contains: pair }).strict(),
    z.object({ startsWith: pair }).strict(),
    z.object({ endsWith: pair }).strict(),
    z.object({ matches: z.tuple([operandSchema, z.string().max(500)]) }).strict(),
    z.object({ exists: operandSchema }).strict(),
    z.object({ empty: operandSchema }).strict(),
    z.object({ before: pair }).strict(),
    z.object({ after: pair }).strict(),
    z.object({ withinLast: z.tuple([operandSchema, z.string().regex(/^P/)]) }).strict(),
    z.object({ always: z.literal(true) }).strict(),
  ]),
) as z.ZodType<Expr>;

/** Validates an expression's shape and returns it typed, for storing in a definition. */
export function parseExpr(input: unknown): Expr {
  return exprSchema.parse(input);
}
