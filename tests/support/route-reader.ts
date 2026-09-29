import ts from 'typescript';

/**
 * Reading the API calls another program makes out of its source, so a test can
 * ask the router whether each one is mounted with the method it is sent with.
 *
 * Two programs in this repository hard-code the API's paths — the SDK and the
 * walking skeleton — and both are checked this way (`sdk-routes.test.ts`,
 * `walking-skeleton-routes.test.ts`). The source is read with the TypeScript
 * parser rather than a regular expression: finding the options object that
 * belongs to a literal means matching brackets across template strings, and a
 * scan that guessed wrong would quietly default to `GET` — the one failure mode
 * a test that reads source code must not have. A call in a shape the reader
 * does not recognise is reported as unreadable, and the suites fail on it,
 * instead of being skipped.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

/**
 * What a `${…}` in a path is replaced with. A UUID because it is shaped like
 * what the variables hold, so a parametric route matches and its parser does
 * not reject the value.
 */
export const UUID = '00000000-0000-4000-8000-000000000000';

/** One call a program makes: a method and a path with its variables filled in. */
export interface RouteCall {
  readonly method: Method;
  readonly path: string;
  /** `file:line`, so a failure names the line to change. */
  readonly where: string;
}

export interface RouteCallScan {
  readonly calls: RouteCall[];
  /** Calls in a shape the reader does not understand; the suites fail on any. */
  readonly unreadable: string[];
}

/**
 * The text of a string or template literal with every `${…}` replaced by a
 * UUID, or null when the node is not a literal.
 */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => UUID + span.literal.text).join('');
  return null;
}

/** The property called `name` in an object literal, if it is written out. */
function property(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(
    (element) => element.name !== undefined && (ts.isIdentifier(element.name) || ts.isStringLiteral(element.name)) && element.name.text === name,
  );
}

/**
 * The methods an options object asks for: `['GET']` when it names none,
 * both branches of a `cond ? 'PUT' : 'DELETE'`, and null when the reader
 * cannot tell (a variable, a shorthand, or a spread that might carry one).
 */
export function methodsIn(object: ts.ObjectLiteralExpression | undefined): Method[] | null {
  if (!object) return ['GET'];
  const found = property(object, 'method');
  if (!found) return object.properties.some(ts.isSpreadAssignment) ? null : ['GET'];
  if (!ts.isPropertyAssignment(found)) return null;
  const literals = (expression: ts.Expression): string[] | null => {
    if (ts.isStringLiteralLike(expression)) return [expression.text];
    if (ts.isParenthesizedExpression(expression)) return literals(expression.expression);
    if (ts.isConditionalExpression(expression)) {
      const [yes, no] = [literals(expression.whenTrue), literals(expression.whenFalse)];
      return yes && no ? [...yes, ...no] : null;
    }
    return null;
  };
  const values = literals(found.initializer);
  if (!values || !values.every((value): value is Method => (METHODS as readonly string[]).includes(value))) return null;
  return [...new Set(values)];
}

/** The methods of a call whose options, if any, are its second argument. */
function methodsOfCall(call: ts.CallExpression): Method[] | null {
  const options = call.arguments[1];
  if (options === undefined) return ['GET'];
  return ts.isObjectLiteralExpression(options) ? methodsIn(options) : null;
}

function where(tree: ts.SourceFile, file: string, node: ts.Node): string {
  return `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
}

/**
 * Every call to `/api/v1/…` in one SDK source file, with its method.
 *
 * Every `/api/v1/` literal in the file is accounted for, wherever it sits, and
 * two shapes are understood, which are the two the SDK uses:
 *
 * - `client.request('/api/v1/x', { method: 'POST', … })` — the literal is the
 *   first argument of a call and the method is in the object after it;
 * - `{ path: '/api/v1/x', method: 'POST', … }` — a queueable request built as
 *   data for the offline outbox, where the method sits beside the path.
 */
export function sdkCallsIn(source: string, file = 'source.ts'): RouteCallScan {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: RouteCall[] = [];
  const unreadable: string[] = [];

  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    const path = text?.startsWith('/api/v1/') ? text : null;
    if (path === null) {
      ts.forEachChild(node, visit);
      return;
    }
    const parent = node.parent;
    let methods: Method[] | null = null;

    if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
      methods = methodsOfCall(parent);
    } else if (
      ts.isPropertyAssignment(parent) &&
      ts.isIdentifier(parent.name) &&
      parent.name.text === 'path' &&
      ts.isObjectLiteralExpression(parent.parent)
    ) {
      methods = methodsIn(parent.parent);
    }

    const at = where(tree, file, node);
    if (methods === null) unreadable.push(`${at} ${path}`);
    else for (const method of methods) calls.push({ method, path, where: at });
  };
  visit(tree);
  return { calls, unreadable };
}

/**
 * Every call to a helper named `callee` — `api(path, { method, … })`, the
 * shape the walking skeleton uses — with its method.
 *
 * Unlike the SDK's reader this starts from the calls rather than the literals,
 * because the skeleton's paths are not all under `/api/v1` (`/status/<slug>`,
 * `/health/ready`) and a file of that size holds other strings that begin with
 * a slash. A call whose first argument is not a literal path, or whose options
 * cannot be read, is unreadable. A query string is left on the path; the
 * router ignores it, as it does for a request.
 */
export function helperCallsIn(source: string, callee: string, file = 'source.ts'): RouteCallScan {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: RouteCall[] = [];
  const unreadable: string[] = [];

  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== callee) return;
    const first = node.arguments[0];
    const path = first === undefined ? null : literalText(first);
    const at = where(tree, file, node);
    if (path === null || !path.startsWith('/')) {
      unreadable.push(`${at} ${first === undefined ? '(no path)' : first.getText(tree)}`);
      return;
    }
    const methods = methodsOfCall(node);
    if (methods === null) unreadable.push(`${at} ${path}`);
    else for (const method of methods) calls.push({ method, path, where: at });
  };
  visit(tree);
  calls.sort((a, b) => a.where.localeCompare(b.where, undefined, { numeric: true }));
  return { calls, unreadable };
}

/** One entry per method and path, first occurrence kept, sorted by path then method. */
export function distinctCalls(calls: Iterable<RouteCall>): RouteCall[] {
  const seen = new Map<string, RouteCall>();
  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (!seen.has(key)) seen.set(key, call);
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
