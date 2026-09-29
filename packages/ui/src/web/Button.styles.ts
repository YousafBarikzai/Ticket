import { css, layer } from '../styles/css.js';

/**
 * `Button`. The spinner turns with `itsm-spin` from `styles/motion.styles.ts`.
 */
export const buttonStyles = layer(
  'components',
  css`
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
`,
);
