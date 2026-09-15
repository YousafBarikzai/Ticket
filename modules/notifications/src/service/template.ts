import { ValidationError } from '@itsm/platform';

/**
 * Template rendering.
 *
 * A deliberately tiny substitution language: `{{path}}` and nothing else. No
 * loops, no conditionals, no expression evaluation — a notification template is
 * authored by administrators and rendered for recipients, so the smaller its
 * surface the less it can be made to leak.
 */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Control characters that would break an email header or forge a log line. */
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, path: string) => {
    const value = readPath(context, path);
    if (value === undefined || value === null) return '';
    return escapeForText(String(value));
  });
}

function readPath(context: Record<string, unknown>, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    // Own properties only: a template must never be able to walk a prototype.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function escapeForText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').slice(0, 5000);
}

export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort();
}

/** Validates that a template only references values the event actually provides. */
export function validateTemplate(template: string, availablePaths: string[]): void {
  const unknown = placeholdersIn(template).filter(
    (placeholder) => !availablePaths.some((available) => placeholder === available || placeholder.startsWith(`${available}.`)),
  );
  if (unknown.length > 0) {
    throw new ValidationError(`template references unknown values: ${unknown.join(', ')}`);
  }
}
