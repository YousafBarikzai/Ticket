/**
 * @itsm/expr — the platform's one expression language.
 *
 * A closed set of operators over a typed context, encoded as JSON so that every
 * builder (forms, business rules, workflow branches, SLA policy matching,
 * approval steps, notification rules, catalogue eligibility, saved views)
 * stores conditions the same way and evaluates them identically on the server
 * and in the browser. See docs/architecture/05-platform-primitives.md §9.
 *
 * Deliberately NOT a scripting language: no function calls, no loops, no
 * property assignment, no access to anything but the context object passed in.
 */
import { z } from 'zod';

export type Scalar = string | number | boolean | null;
export type ExprValue = Scalar | Scalar[];

/** A reference to a value in the evaluation context, e.g. { var: 'ticket.priority' }. */
export interface VarRef {
  var: string;
}

export type Operand = ExprValue | VarRef;

export type Expr =
  | { and: Expr[] }
  | { or: Expr[] }
  | { not: Expr }
  | { eq: [Operand, Operand] }
  | { ne: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { gte: [Operand, Operand] }
  | { lt: [Operand, Operand] }
  | { lte: [Operand, Operand] }
  | { in: [Operand, Operand] }
  | { nin: [Operand, Operand] }
  | { contains: [Operand, Operand] }
  | { startsWith: [Operand, Operand] }
  | { endsWith: [Operand, Operand] }
  | { matches: [Operand, string] }
  | { exists: Operand }
  | { empty: Operand }
  | { before: [Operand, Operand] }
  | { after: [Operand, Operand] }
  | { withinLast: [Operand, string] }
  | { always: true };

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

export type EvalContext = Record<string, unknown>;

export class ExprError extends Error {}

const MAX_DEPTH = 20;

function isVarRef(o: unknown): o is VarRef {
  return typeof o === 'object' && o !== null && 'var' in o && typeof (o as VarRef).var === 'string';
}

/** Reads a dotted path out of the context. Returns undefined for anything missing. */
export function readPath(ctx: EvalContext, path: string): unknown {
  let cur: unknown = ctx;
  for (const segment of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    // Own properties only: never walk into prototypes.
    if (!Object.prototype.hasOwnProperty.call(cur, segment)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

function resolve(operand: Operand, ctx: EvalContext): unknown {
  return isVarRef(operand) ? readPath(ctx, operand.var) : operand;
}

function toComparable(v: unknown): number | string | boolean | null | undefined {
  if (v === null || v === undefined) return v as null | undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

function toTime(v: unknown): number | undefined {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/** Parses the ISO-8601 duration subset used by the product (P[nD][T[nH][nM][nS]]). */
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) throw new ExprError(`invalid duration: ${iso}`);
  const [, d, h, min, s] = m;
  const ms =
    Number(d ?? 0) * 86_400_000 + Number(h ?? 0) * 3_600_000 + Number(min ?? 0) * 60_000 + Number(s ?? 0) * 1000;
  if (ms === 0 && iso !== 'PT0S') throw new ExprError(`invalid duration: ${iso}`);
  return ms;
}

function compare(a: unknown, b: unknown): number | undefined {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca === undefined || cb === undefined || ca === null || cb === null) return undefined;
  if (typeof ca === 'number' && typeof cb === 'number') return ca - cb;
  if (typeof ca === 'boolean' || typeof cb === 'boolean') return Number(ca) - Number(cb);
  const sa = String(ca);
  const sb = String(cb);
  // Dates written as ISO strings compare correctly as instants, not lexically.
  const ta = toTime(sa);
  const tb = toTime(sb);
  if (ta !== undefined && tb !== undefined && /\d{4}-\d{2}-\d{2}/.test(sa) && /\d{4}-\d{2}-\d{2}/.test(sb)) {
    return ta - tb;
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

/**
 * Evaluates an expression. Never throws for missing context values: a missing
 * value simply fails its comparison, so a rule cannot break a request because
 * an optional field is absent. Malformed expressions do throw.
 */
export function evaluate(expr: Expr, ctx: EvalContext, depth = 0): boolean {
  if (depth > MAX_DEPTH) throw new ExprError('expression nested too deeply');
  const e = expr as Record<string, unknown>;

  if ('always' in e) return true;
  if ('and' in e) return (e.and as Expr[]).every((sub) => evaluate(sub, ctx, depth + 1));
  if ('or' in e) return (e.or as Expr[]).some((sub) => evaluate(sub, ctx, depth + 1));
  if ('not' in e) return !evaluate(e.not as Expr, ctx, depth + 1);

  if ('exists' in e) {
    const v = resolve(e.exists as Operand, ctx);
    return v !== undefined && v !== null;
  }
  if ('empty' in e) {
    const v = resolve(e.empty as Operand, ctx);
    if (v === undefined || v === null || v === '') return true;
    return Array.isArray(v) && v.length === 0;
  }

  const bin = (key: string): [unknown, unknown] => {
    const [l, r] = e[key] as [Operand, Operand];
    return [resolve(l, ctx), resolve(r, ctx)];
  };

  if ('eq' in e) {
    const [l, r] = bin('eq');
    return looseEqual(l, r);
  }
  if ('ne' in e) {
    const [l, r] = bin('ne');
    return !looseEqual(l, r);
  }
  if ('gt' in e) {
    const c = compare(...bin('gt'));
    return c !== undefined && c > 0;
  }
  if ('gte' in e) {
    const c = compare(...bin('gte'));
    return c !== undefined && c >= 0;
  }
  if ('lt' in e) {
    const c = compare(...bin('lt'));
    return c !== undefined && c < 0;
  }
  if ('lte' in e) {
    const c = compare(...bin('lte'));
    return c !== undefined && c <= 0;
  }
  if ('in' in e) {
    const [l, r] = bin('in');
    return asArray(r).some((item) => looseEqual(item, l));
  }
  if ('nin' in e) {
    const [l, r] = bin('nin');
    return !asArray(r).some((item) => looseEqual(item, l));
  }
  if ('contains' in e) {
    const [l, r] = bin('contains');
    if (Array.isArray(l)) return l.some((item) => looseEqual(item, r));
    if (typeof l === 'string' && (typeof r === 'string' || typeof r === 'number')) {
      return l.toLowerCase().includes(String(r).toLowerCase());
    }
    return false;
  }
  if ('startsWith' in e) {
    const [l, r] = bin('startsWith');
    return typeof l === 'string' && typeof r === 'string' && l.toLowerCase().startsWith(r.toLowerCase());
  }
  if ('endsWith' in e) {
    const [l, r] = bin('endsWith');
    return typeof l === 'string' && typeof r === 'string' && l.toLowerCase().endsWith(r.toLowerCase());
  }
  if ('matches' in e) {
    const [l, pattern] = e.matches as [Operand, string];
    const value = resolve(l, ctx);
    if (typeof value !== 'string') return false;
    return safeRegex(pattern).test(value);
  }
  if ('before' in e) {
    const [l, r] = bin('before');
    const tl = toTime(l);
    const tr = toTime(r);
    return tl !== undefined && tr !== undefined && tl < tr;
  }
  if ('after' in e) {
    const [l, r] = bin('after');
    const tl = toTime(l);
    const tr = toTime(r);
    return tl !== undefined && tr !== undefined && tl > tr;
  }
  if ('withinLast' in e) {
    const [l, iso] = e.withinLast as [Operand, string];
    const t = toTime(resolve(l, ctx));
    if (t === undefined) return false;
    const now = toTime(readPath(ctx, 'now')) ?? Date.now();
    return t >= now - parseDuration(iso) && t <= now;
  }

  throw new ExprError(`unknown operator: ${Object.keys(e).join(',')}`);
}

function looseEqual(a: unknown, b: unknown): boolean {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca === undefined || cb === undefined) return false;
  if (ca === null || cb === null) return ca === cb;
  if (typeof ca === 'string' && typeof cb === 'string') return ca === cb;
  if (typeof ca === 'number' && typeof cb === 'number') return ca === cb;
  if (typeof ca === 'boolean' || typeof cb === 'boolean') return Boolean(ca) === Boolean(cb);
  return String(ca) === String(cb);
}

const regexCache = new Map<string, RegExp>();

/**
 * Compiles a user-supplied pattern with a length cap and a cache. Patterns come
 * from administrators through governed builders, never from requesters.
 */
function safeRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
  if (pattern.length > 500) throw new ExprError('pattern too long');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    throw new ExprError(`invalid pattern: ${pattern}`);
  }
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

/** Validates an expression's shape and returns it typed, for storing in a definition. */
export function parseExpr(input: unknown): Expr {
  return exprSchema.parse(input);
}

/** Lists every context path an expression reads, used by builder validation. */
export function referencedVars(expr: Expr): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      if (isVarRef(node)) {
        out.add(node.var);
        return;
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(expr);
  return [...out].sort();
}
