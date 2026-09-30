/**
 * Types for lucide's per-icon modules.
 *
 * lucide publishes one type file for its root entry and none for the files
 * under `dist/esm/icons/`, which are what `nodes.ts` imports so that a bundle
 * holds only the registry's icons. Each of those files default-exports one
 * icon node; this says so. Referenced from `nodes.ts` with a triple-slash
 * directive, so every program that compiles the design system's source — the
 * applications' as well as this package's — sees it.
 */
declare module 'lucide/dist/esm/icons/*.mjs' {
  const node: import('lucide').IconNode;
  export default node;
}
