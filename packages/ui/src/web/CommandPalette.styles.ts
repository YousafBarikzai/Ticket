import { css, layer } from '../styles/css.js';

/**
 * `CommandPalette`. The class names here are pinned by `command-palette.test.ts`.
 */
export const commandPaletteStyles = layer(
  'components',
  css`
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
`,
);
