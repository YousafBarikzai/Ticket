import { readPath, type EvalContext } from '@itsm/expr';

/**
 * `{{path}}` substitution against the run context.
 *
 * A deliberately small syntax: a path, and nothing else. No filters, no
 * arithmetic, no conditionals — those belong in the expression language, which
 * is already shared, already tested and already refuses nonsense since
 * ADR-0021. A second half-language inside a string is how template syntaxes
 * turn into programming languages nobody meant to write.
 *
 * An unresolved path is reported rather than rendered as `undefined` or left as
 * `{{…}}`. A workflow that emails somebody "Your undefined is ready" has failed
 * in a way that is embarrassing and hard to trace back.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;

export interface RenderResult {
  value: string;
  /** Paths the context had no value for. Empty means the render is complete. */
  unresolved: string[];
}

export function render(template: string, context: EvalContext): RenderResult {
  const unresolved: string[] = [];
  const value = template.replace(PLACEHOLDER, (_match, path: string) => {
    const resolved = readPath(context, path);
    if (resolved === undefined || resolved === null) {
      unresolved.push(path);
      return '';
    }
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved);
  });
  return { value, unresolved };
}

/** Renders, or throws naming every path that could not be resolved. */
export function renderStrict(template: string, context: EvalContext): string {
  const result = render(template, context);
  if (result.unresolved.length > 0) {
    throw new Error(`this step reads ${[...new Set(result.unresolved)].join(', ')}, which the run has no value for`);
  }
  return result.value;
}

/** Every path a template reads, for validating a definition before publication. */
export function placeholdersIn(template: string): string[] {
  const out = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) out.add(match[1]!);
  return [...out];
}

/** Whether a string contains any placeholder at all. */
export function isTemplated(value: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(value);
}
