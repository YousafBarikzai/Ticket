/**
 * `@itsm/contracts/forms` — the form definition and its logic, and nothing else.
 *
 * A subpath of its own because the form renderer is the only part of the
 * contracts a browser page needs, and the package root is everything: the
 * ticket models, the event catalogue and the route table, with the schemas
 * that validate them. A page that rendered a catalogue form imported all of
 * that through the root. This entry reaches only `schema.ts` and `logic.ts`,
 * and through them `@itsm/expr`, which the conditions are written in.
 *
 * The root still re-exports both files, so server code that imports a form
 * type from `@itsm/contracts` keeps working and sees the same declarations.
 */
export * from './schema.js';
export * from './logic.js';
