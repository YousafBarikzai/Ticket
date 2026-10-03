/**
 * The demo's job handlers — not yet registered.
 *
 * The manifest declares `demo.reset.check`, `demo.reset` and `demo.purge` on
 * queue `demo` (`manifest.ts`), and the orchestrator that runs them is built
 * in the next wave (SPEC §15 WP-58), which replaces this file. Until then no
 * handler is defined, so a worker that schedules the check tick finds nothing
 * registered for it and the job fails loudly rather than doing half a build.
 *
 * Whoever fills this in keeps one rule from A4 §2.2: the two heavy handlers
 * reach the planner, the parts and the content library only through
 * `await import('./orchestrator/build.js')`. The API process registers this
 * module's manifest through `@itsm/runtime`, and must never evaluate the
 * content library to do it.
 */
export {};
