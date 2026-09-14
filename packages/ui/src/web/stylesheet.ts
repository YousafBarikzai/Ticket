/**
 * The component stylesheet.
 *
 * Every declaration resolves to a token variable produced by
 * `tokens/css.ts` — there are no literal colours, sizes or durations here, so
 * a theme change or a density change needs no edit in this file.
 *
 * Why a stylesheet at all, rather than inline styles: `:hover`, `:focus-visible`,
 * `::placeholder`, `@media` and `[aria-*]` selectors cannot be expressed inline,
 * and focus rings and reduced motion depend on exactly those. Layout uses
 * logical properties (`inline`/`block`, `start`/`end`) so that the Arabic and
 * Hebrew locales mirror without a second stylesheet.
 */

export const componentStylesheet = `
.itsm-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

[class^="itsm-"], [class*=" itsm-"] {
  box-sizing: border-box;
  font-family: var(--itsm-font-family-sans);
}

[class^="itsm-"]:focus-visible, [class*=" itsm-"]:focus-visible {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  border-radius: var(--itsm-radius-sm);
}

/* ---------------------------------------------------------------- Button */

.itsm-Button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs);
  min-height: var(--itsm-control-height-md);
  padding-inline: var(--itsm-space-md);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  font-size: var(--itsm-font-size-md);
  font-weight: var(--itsm-font-weight-medium);
  line-height: var(--itsm-line-height-snug);
  cursor: pointer;
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Button--sm { min-height: var(--itsm-control-height-sm); padding-inline: var(--itsm-space-sm); font-size: var(--itsm-font-size-sm); }
.itsm-Button--lg { min-height: var(--itsm-control-height-lg); padding-inline: var(--itsm-space-lg); font-size: var(--itsm-font-size-lg); }
.itsm-Button--primary { background: var(--itsm-colour-brand-solid); color: var(--itsm-colour-brand-solidText); }
.itsm-Button--primary:hover:not(:disabled) { background: var(--itsm-colour-brand-solidHover); }
.itsm-Button--danger { background: var(--itsm-colour-danger-solid); color: var(--itsm-colour-danger-solidText); }
.itsm-Button--danger:hover:not(:disabled) { background: var(--itsm-colour-danger-solidHover); }
.itsm-Button--secondary {
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  border-color: var(--itsm-colour-border-interactive);
}
.itsm-Button--secondary:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); }
.itsm-Button--subtle { background: var(--itsm-colour-brand-subtle); color: var(--itsm-colour-brand-subtleText); }
.itsm-Button--subtle:hover:not(:disabled) { border-color: var(--itsm-colour-brand-border); }
.itsm-Button--ghost { background: transparent; color: var(--itsm-colour-text-primary); }
.itsm-Button--ghost:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); }
.itsm-Button:disabled, .itsm-Button[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }
.itsm-Button[aria-busy="true"] { cursor: progress; }
.itsm-Button__spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-block-start-color: transparent;
  border-radius: var(--itsm-radius-pill);
  animation: itsm-spin var(--itsm-duration-deliberate) linear infinite;
}
@keyframes itsm-spin { to { transform: rotate(360deg); } }

.itsm-IconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  block-size: var(--itsm-control-height-md);
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
}
.itsm-IconButton--sm { inline-size: var(--itsm-control-height-sm); block-size: var(--itsm-control-height-sm); }
.itsm-IconButton--lg { inline-size: var(--itsm-control-height-lg); block-size: var(--itsm-control-height-lg); }
.itsm-IconButton:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); color: var(--itsm-colour-text-primary); }
.itsm-IconButton:disabled { cursor: not-allowed; color: var(--itsm-colour-text-disabled); }

/* ------------------------------------------------------- Fields and inputs */

.itsm-Field { display: flex; flex-direction: column; gap: var(--itsm-space-2xs); margin-block-end: var(--itsm-space-md); }
.itsm-Field__label {
  font-size: var(--itsm-font-size-sm);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-primary);
}
.itsm-Field__required { color: var(--itsm-colour-danger-subtleText); margin-inline-start: var(--itsm-space-3xs); }
.itsm-Field__hint { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Field__error {
  display: flex;
  gap: var(--itsm-space-3xs);
  font-size: var(--itsm-font-size-xs);
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-Input, .itsm-Textarea, .itsm-Select {
  inline-size: 100%;
  min-height: var(--itsm-control-height-md);
  padding: var(--itsm-space-2xs) var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-font-size-md);
  font-family: inherit;
}
.itsm-Textarea { min-height: calc(var(--itsm-control-height-lg) * 2); resize: vertical; line-height: var(--itsm-line-height-normal); }
.itsm-Input::placeholder, .itsm-Textarea::placeholder { color: var(--itsm-colour-text-muted); }
.itsm-Input[aria-invalid="true"], .itsm-Textarea[aria-invalid="true"], .itsm-Select[aria-invalid="true"] {
  border-color: var(--itsm-colour-danger-solid);
  border-width: var(--itsm-border-thick);
}
.itsm-Input:disabled, .itsm-Textarea:disabled, .itsm-Select:disabled {
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}
.itsm-Input[readonly] { background: var(--itsm-colour-surface-sunken); }

.itsm-Choice { display: flex; align-items: flex-start; gap: var(--itsm-space-xs); cursor: pointer; padding-block: var(--itsm-space-3xs); }
.itsm-Choice__control { flex: none; margin-block-start: 2px; }
.itsm-Choice__label { font-size: var(--itsm-font-size-md); color: var(--itsm-colour-text-primary); }
.itsm-Choice__description { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Choice[aria-disabled="true"] { cursor: not-allowed; }
.itsm-Choice[aria-disabled="true"] .itsm-Choice__label { color: var(--itsm-colour-text-disabled); }

.itsm-Radio {
  inline-size: 20px;
  block-size: 20px;
  border: var(--itsm-border-thick) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--itsm-colour-surface-raised);
}
.itsm-Radio[data-checked="true"] { border-color: var(--itsm-colour-brand-solid); }
.itsm-Radio[data-checked="true"]::after {
  content: "";
  inline-size: 10px;
  block-size: 10px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-solid);
}

.itsm-Switch {
  inline-size: 44px;
  block-size: 24px;
  padding: 2px;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-sunken);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.itsm-Switch[aria-checked="true"] { background: var(--itsm-colour-brand-solid); border-color: var(--itsm-colour-brand-solid); justify-content: flex-end; }
.itsm-Switch[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }
.itsm-Switch__thumb {
  inline-size: 18px;
  block-size: 18px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

/* ------------------------------------------------- Combobox and date picker */

.itsm-Combobox { position: relative; }
.itsm-Combobox__list {
  position: absolute;
  inset-inline: 0;
  inset-block-start: calc(100% + var(--itsm-space-3xs));
  z-index: var(--itsm-z-dropdown);
  max-block-size: 16rem;
  overflow-y: auto;
  margin: 0;
  padding: var(--itsm-space-3xs);
  list-style: none;
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
}
.itsm-Combobox__option {
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-sm);
  font-size: var(--itsm-font-size-md);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
}
.itsm-Combobox__option[data-active="true"] { background: var(--itsm-colour-surface-selected); }
.itsm-Combobox__option[aria-selected="true"] { font-weight: var(--itsm-font-weight-semibold); }
.itsm-Combobox__meta { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Combobox__status { padding: var(--itsm-space-xs); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }

.itsm-DatePicker { position: relative; display: flex; gap: var(--itsm-space-2xs); align-items: center; }
.itsm-DatePicker__panel {
  position: absolute;
  inset-block-start: calc(100% + var(--itsm-space-3xs));
  inset-inline-start: 0;
  z-index: var(--itsm-z-dropdown);
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
}
.itsm-DatePicker__header { display: flex; align-items: center; justify-content: space-between; gap: var(--itsm-space-xs); margin-block-end: var(--itsm-space-xs); }
.itsm-DatePicker__month { font-weight: var(--itsm-font-weight-semibold); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-primary); }
.itsm-DatePicker__grid { border-collapse: collapse; }
.itsm-DatePicker__grid th {
  font-size: var(--itsm-font-size-2xs);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-muted);
  padding: var(--itsm-space-3xs);
}
.itsm-DatePicker__day {
  inline-size: 2rem;
  block-size: 2rem;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-sm);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-font-size-sm);
  cursor: pointer;
}
.itsm-DatePicker__day:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); }
.itsm-DatePicker__day[aria-selected="true"] { background: var(--itsm-colour-brand-solid); color: var(--itsm-colour-brand-solidText); }
.itsm-DatePicker__day[data-today="true"] { border-color: var(--itsm-colour-brand-border); font-weight: var(--itsm-font-weight-semibold); }
.itsm-DatePicker__day:disabled { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-DatePicker__day[data-outside="true"] { color: var(--itsm-colour-text-muted); }

/* ------------------------------------------------------ Display components */

.itsm-Badge {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  padding: 2px var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
  font-size: var(--itsm-font-size-xs);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
}
.itsm-Badge__dot { inline-size: 6px; block-size: 6px; border-radius: var(--itsm-radius-pill); background: currentColor; }

.itsm-Avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: visible;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
  flex: none;
}
.itsm-Avatar__image { inline-size: 100%; block-size: 100%; border-radius: var(--itsm-radius-pill); object-fit: cover; }
.itsm-Avatar__status {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  inline-size: 30%;
  block-size: 30%;
  min-inline-size: 8px;
  min-block-size: 8px;
  border-radius: var(--itsm-radius-pill);
  border: var(--itsm-border-thick) solid var(--itsm-colour-surface-raised);
}

.itsm-Card {
  display: block;
  background: var(--itsm-colour-surface-raised);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  box-shadow: var(--itsm-elevation-sm);
  color: var(--itsm-colour-text-primary);
  overflow: hidden;
}
.itsm-Card--interactive { cursor: pointer; text-align: start; inline-size: 100%; }
.itsm-Card--interactive:hover { box-shadow: var(--itsm-elevation-md); border-color: var(--itsm-colour-border-interactive); }
.itsm-Card__header { padding: var(--itsm-space-md); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Card__title { margin: 0; font-size: var(--itsm-font-size-lg); font-weight: var(--itsm-font-weight-semibold); }
.itsm-Card__subtitle { margin: 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Card__body { padding: var(--itsm-space-md); }
.itsm-Card__footer { padding: var(--itsm-space-md); border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); background: var(--itsm-colour-surface-sunken); }

.itsm-Table__scroll { overflow-x: auto; }
.itsm-Table { inline-size: 100%; border-collapse: collapse; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-primary); }
.itsm-Table caption { text-align: start; padding-block-end: var(--itsm-space-xs); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Table th, .itsm-Table td { padding: var(--itsm-space-xs) var(--itsm-space-sm); text-align: start; border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Table thead th { font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-secondary); background: var(--itsm-colour-surface-sunken); position: sticky; inset-block-start: 0; z-index: var(--itsm-z-sticky); }
.itsm-Table tbody tr:hover { background: var(--itsm-colour-surface-hover); }
.itsm-Table tbody tr[aria-selected="true"] { background: var(--itsm-colour-surface-selected); }
.itsm-Table__sort { display: inline-flex; align-items: center; gap: var(--itsm-space-3xs); background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.itsm-Table__sortIndicator { font-size: var(--itsm-font-size-2xs); color: var(--itsm-colour-text-muted); }

.itsm-Skeleton {
  display: block;
  border-radius: var(--itsm-radius-sm);
  background: linear-gradient(90deg, var(--itsm-colour-surface-sunken) 25%, var(--itsm-colour-surface-hover) 37%, var(--itsm-colour-surface-sunken) 63%);
  background-size: 400% 100%;
  animation: itsm-shimmer 1400ms linear infinite;
}
@keyframes itsm-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .itsm-Skeleton { animation: none; } }

.itsm-EmptyState { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--itsm-space-xs); padding: var(--itsm-space-2xl) var(--itsm-space-md); color: var(--itsm-colour-text-secondary); }
.itsm-EmptyState__title { margin: 0; font-size: var(--itsm-font-size-lg); font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-primary); }
.itsm-EmptyState__body { margin: 0; max-inline-size: 42ch; font-size: var(--itsm-font-size-md); }
.itsm-EmptyState__icon { color: var(--itsm-colour-text-muted); }

/* ------------------------------------------------------------------- Tabs */

.itsm-Tabs__list { display: flex; gap: var(--itsm-space-3xs); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); overflow-x: auto; }
.itsm-Tabs__tab {
  appearance: none;
  background: none;
  border: 0;
  border-block-end: var(--itsm-border-thick) solid transparent;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  font-size: var(--itsm-font-size-md);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.itsm-Tabs__tab[aria-selected="true"] { color: var(--itsm-colour-brand-subtleText); border-block-end-color: var(--itsm-colour-brand-solid); }
.itsm-Tabs__tab:disabled { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-Tabs__panel { padding-block: var(--itsm-space-md); }

/* -------------------------------------------------- Dialog, toast, tooltip */

.itsm-Dialog__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  background: var(--itsm-colour-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--itsm-space-md);
  overflow-y: auto;
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Dialog {
  inline-size: min(100%, 34rem);
  max-block-size: calc(100dvh - var(--itsm-space-2xl));
  display: flex;
  flex-direction: column;
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  box-shadow: var(--itsm-elevation-xl);
  color: var(--itsm-colour-text-primary);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Dialog--sm { inline-size: min(100%, 24rem); }
.itsm-Dialog--lg { inline-size: min(100%, 52rem); }
.itsm-Dialog__header { display: flex; align-items: flex-start; gap: var(--itsm-space-sm); padding: var(--itsm-space-md); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Dialog__title { margin: 0; flex: 1; font-size: var(--itsm-font-size-xl); font-weight: var(--itsm-font-weight-semibold); }
.itsm-Dialog__description { margin: var(--itsm-space-3xs) 0 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Dialog__body { padding: var(--itsm-space-md); overflow-y: auto; }
.itsm-Dialog__footer { display: flex; justify-content: flex-end; gap: var(--itsm-space-xs); padding: var(--itsm-space-md); border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
@keyframes itsm-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes itsm-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .itsm-Dialog, .itsm-Dialog__scrim, .itsm-Toast { animation: none; }
}

.itsm-Toast__region {
  position: fixed;
  inset-block-end: var(--itsm-space-md);
  inset-inline-end: var(--itsm-space-md);
  z-index: var(--itsm-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  inline-size: min(100%, 24rem);
}
.itsm-Toast {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-inline-start: var(--itsm-space-3xs) solid var(--itsm-colour-neutral-solid);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
  color: var(--itsm-colour-text-primary);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Toast--success { border-inline-start-color: var(--itsm-colour-success-solid); }
.itsm-Toast--danger { border-inline-start-color: var(--itsm-colour-danger-solid); }
.itsm-Toast--warning { border-inline-start-color: var(--itsm-colour-warning-solid); }
.itsm-Toast--info { border-inline-start-color: var(--itsm-colour-info-solid); }
.itsm-Toast__body { flex: 1; }
.itsm-Toast__title { font-weight: var(--itsm-font-weight-semibold); font-size: var(--itsm-font-size-md); }
.itsm-Toast__description { font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-secondary); }

.itsm-Tooltip { position: relative; display: inline-flex; }
.itsm-Tooltip__bubble {
  position: absolute;
  z-index: var(--itsm-z-tooltip);
  inset-block-end: calc(100% + var(--itsm-space-3xs));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  max-inline-size: 18rem;
  padding: var(--itsm-space-3xs) var(--itsm-space-xs);
  background: var(--itsm-colour-surface-inverse);
  color: var(--itsm-colour-text-inverse);
  border-radius: var(--itsm-radius-sm);
  font-size: var(--itsm-font-size-xs);
  line-height: var(--itsm-line-height-snug);
  width: max-content;
}

/* --------------------------------------------------------------- Timeline */

.itsm-Timeline { list-style: none; margin: 0; padding: 0; }
.itsm-Timeline__item { position: relative; display: flex; gap: var(--itsm-space-sm); padding-block-end: var(--itsm-space-md); }
.itsm-Timeline__rail { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; }
.itsm-Timeline__marker {
  inline-size: 12px;
  block-size: 12px;
  margin-block-start: 6px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-solid);
}
.itsm-Timeline__line { flex: 1; inline-size: var(--itsm-border-thick); background: var(--itsm-colour-border-subtle); margin-block-start: var(--itsm-space-3xs); }
.itsm-Timeline__content { flex: 1; min-inline-size: 0; }
.itsm-Timeline__meta { display: flex; flex-wrap: wrap; gap: var(--itsm-space-2xs); align-items: baseline; font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Timeline__actor { font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-secondary); }
.itsm-Timeline__body { font-size: var(--itsm-font-size-md); color: var(--itsm-colour-text-primary); }
.itsm-Timeline__body--internal { background: var(--itsm-colour-warning-subtle); color: var(--itsm-colour-warning-subtleText); padding: var(--itsm-space-xs); border-radius: var(--itsm-radius-md); }

/* --------------------------------------------------------- CommandPalette */

.itsm-CommandPalette__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  background: var(--itsm-colour-scrim);
  display: flex;
  justify-content: center;
  padding-block-start: 12vh;
  padding-inline: var(--itsm-space-md);
}
.itsm-CommandPalette {
  inline-size: min(100%, 36rem);
  max-block-size: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  box-shadow: var(--itsm-elevation-xl);
  overflow: hidden;
}
.itsm-CommandPalette__input {
  inline-size: 100%;
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border: 0;
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-font-size-lg);
}
.itsm-CommandPalette__list { margin: 0; padding: var(--itsm-space-2xs); list-style: none; overflow-y: auto; }
.itsm-CommandPalette__group { padding: var(--itsm-space-2xs) var(--itsm-space-xs) var(--itsm-space-3xs); font-size: var(--itsm-font-size-2xs); font-weight: var(--itsm-font-weight-semibold); letter-spacing: var(--itsm-letter-spacing-wide); text-transform: uppercase; color: var(--itsm-colour-text-muted); }
.itsm-CommandPalette__option {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-sm);
  font-size: var(--itsm-font-size-md);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
}
.itsm-CommandPalette__option[data-active="true"] { background: var(--itsm-colour-surface-selected); }
.itsm-CommandPalette__option[aria-disabled="true"] { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-CommandPalette__hint { margin-inline-start: auto; font-size: var(--itsm-font-size-2xs); color: var(--itsm-colour-text-muted); }
.itsm-CommandPalette__empty { padding: var(--itsm-space-lg); text-align: center; color: var(--itsm-colour-text-muted); font-size: var(--itsm-font-size-sm); }

/* --------------------------------------------------------------- AppShell */

.itsm-AppShell { min-block-size: 100dvh; display: flex; flex-direction: column; background: var(--itsm-colour-surface-canvas); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__skipLink {
  position: absolute;
  inset-inline-start: var(--itsm-space-xs);
  inset-block-start: var(--itsm-space-xs);
  z-index: var(--itsm-z-tooltip);
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  border-radius: var(--itsm-radius-md);
  transform: translateY(-200%);
}
.itsm-AppShell__skipLink:focus { transform: none; }
.itsm-AppShell__header {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  min-block-size: var(--itsm-control-height-lg);
  background: var(--itsm-colour-surface-raised);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  position: sticky;
  inset-block-start: 0;
  z-index: var(--itsm-z-sticky);
}
.itsm-AppShell__brand { display: flex; align-items: center; gap: var(--itsm-space-xs); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__headerEnd { margin-inline-start: auto; display: flex; align-items: center; gap: var(--itsm-space-xs); }
.itsm-AppShell__main { display: flex; flex: 1; min-block-size: 0; }
.itsm-AppShell__nav {
  inline-size: 15rem;
  flex: none;
  padding: var(--itsm-space-sm);
  border-inline-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
  overflow-y: auto;
}
.itsm-AppShell__navList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--itsm-space-3xs); }
.itsm-AppShell__navLink {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-secondary);
  text-decoration: none;
  font-size: var(--itsm-font-size-md);
}
.itsm-AppShell__navLink:hover { background: var(--itsm-colour-surface-hover); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__navLink[aria-current="page"] { background: var(--itsm-colour-surface-selected); color: var(--itsm-colour-brand-subtleText); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__navBadge { margin-inline-start: auto; }
.itsm-AppShell__content { flex: 1; min-inline-size: 0; padding: var(--itsm-space-lg); }
.itsm-AppShell__aside { inline-size: 20rem; flex: none; padding: var(--itsm-space-md); border-inline-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); background: var(--itsm-colour-surface-raised); overflow-y: auto; }
.itsm-AppShell__navToggle { display: none; }

@media (max-width: 767px) {
  .itsm-AppShell__main { flex-direction: column; }
  .itsm-AppShell__nav { inline-size: 100%; border-inline-end: 0; border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
  .itsm-AppShell__nav[data-open="false"] { display: none; }
  .itsm-AppShell__aside { inline-size: 100%; border-inline-start: 0; }
  .itsm-AppShell__navToggle { display: inline-flex; }
  .itsm-AppShell__content { padding: var(--itsm-space-md); }
  .itsm-Toast__region { inset-inline: var(--itsm-space-xs); inline-size: auto; }
}
`;
