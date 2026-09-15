/**
 * The workspace's base tsconfig targets Node (`lib: ES2023`, `types: node`)
 * because every other package runs on the server. This package is the one that
 * runs in a browser, so it pulls the DOM library in per-file rather than
 * widening the shared base config for packages that must never see `window`.
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
