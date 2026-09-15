/**
 * `@itsm/ui` — the design system (ADR-0005, MOD-16-E1).
 *
 * Four layers, in dependency order:
 *   tokens/ → the values, and their CSS and React Native renderings
 *   a11y/   → focus, keyboard and live-region primitives
 *   web/    → the React components built on both
 *   forms/  → FormRenderer, the one renderer for catalogue forms everywhere
 */
export * from './tokens/index.js';
export * from './a11y/index.js';
export * from './web/index.js';
export * from './forms/index.js';
