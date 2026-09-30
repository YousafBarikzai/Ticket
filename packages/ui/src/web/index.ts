/*
 * The internal "everything in `web/`" entry the tests import; applications
 * import the curated root entry (or a subpath) instead.
 *
 * Most modules here are client modules and say so with `'use client'`: they
 * hold state, manage focus or handle the keyboard, and React Server
 * Components need each such file to declare it. The directive is per file, so
 * a component that reaches for a hook without it becomes a build error in an
 * application, reported against that application's layout.
 *
 * The components the catalogue marks server-safe carry no directive, so a
 * server component renders them with no client JavaScript at all: in this
 * folder `Kbd`, `VisuallyHidden`, `Skeleton`, `Badge`, `Avatar`, `RichText`,
 * `Table` and the `IconSlot` helper (and `Icon`, the skeleton family, `Spinner`,
 * the static charts and others in their own folders). What stops one of them
 * growing a hook is `__tests__/guards.test.ts`, which pins every one of them.
 */

export * from './cx.js';
export * from './stylesheet.js';
export * from './ThemeProvider.js';
export * from './VisuallyHidden.js';
export * from './Kbd.js';

export * from './Button.js';
export * from './IconButton.js';
export * from './Input.js';
export * from './Textarea.js';
export * from './Select.js';
export * from './Combobox.js';
export * from './DatePicker.js';
export * from './Checkbox.js';
export * from './RadioGroup.js';
export * from './Switch.js';
export * from './Badge.js';
export * from './Avatar.js';
export * from './Card.js';
export * from './Table.js';
export * from './InteractiveTable.js';
export * from './Tile.js';
export * from './Metric.js';
export * from './Tabs.js';
export * from './Dialog.js';
export * from './Toast.js';
export * from './Tooltip.js';
export * from './RichText.js';
export * from './Skeleton.js';
export * from './EmptyState.js';
export * from './FormField.js';
export * from './Timeline.js';
export * from './CommandPalette.js';
export * from './AppShell.js';
